//! Async SSH backend on russh.

mod auth;
pub(crate) mod connect;
pub(crate) mod exec;
mod forward;
mod handler;
mod known_hosts;
pub(crate) mod params;
mod probe;
mod session;
mod sftp;
mod transport;

pub use known_hosts::trust_host;
pub use params::ConnectParams;
pub use sftp::{ProgressFn, SftpEntry};

use crate::ssh::handler::{Client, ForwardTargets};
use russh::client::Handle;
use russh_sftp::client::SftpSession;
use session::ShellCmd;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::{mpsc, Mutex, Notify};

/// One live SSH connection plus the channel that drives its interactive shell.
/// `conn` is shared (`Arc`) so exec/metrics/sftp/forward can open their own
/// channels on the same connection — russh 0.61's `Handle` is not `Clone`, but
/// every channel-opening method takes `&self`, so an `Arc` is sufficient.
struct SessionHandle {
    shell: mpsc::Sender<ShellCmd>,
    conn: Arc<Handle<Client>>,
    /// Shared with this session's `Client` handler: remote-forward targets keyed
    /// by the server-side listen port. `start_remote_forward` registers here.
    forwarded: ForwardTargets,
    /// Lazily-opened SFTP subsystem, reused across every SFTP operation so each
    /// call avoids the ~3-round-trip channel-open + subsystem + INIT handshake.
    /// Cleared (set to `None`) when an operation fails, so the next call reopens
    /// it on the same connection. Dropped with the session, which closes it.
    sftp: Arc<Mutex<Option<Arc<SftpSession>>>>,
}

#[derive(Default)]
pub struct SshManager {
    sessions: Mutex<HashMap<String, SessionHandle>>,
    /// Active local port-forward stop signals, keyed by session id.
    forwards: Mutex<HashMap<String, Arc<Notify>>>,
    /// Active dynamic SOCKS5 proxy stop signals, keyed by session id.
    socks: Mutex<HashMap<String, Arc<Notify>>>,
}

impl SshManager {
    pub fn new() -> Self {
        Self::default()
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn connect(
        &self,
        session_id: &str,
        params: ConnectParams,
        rows: u32,
        cols: u32,
        app: AppHandle,
    ) -> Result<(), String> {
        // If a session with this id already exists (e.g. a reconnect that
        // didn't go through close_ssh first), close it before overwriting —
        // otherwise the old Handle + reader/writer tasks leak. This mirrors
        // PtyManager's close-before-create pattern.
        self.close_existing(session_id).await;
        let (shell, conn, forwarded) =
            session::spawn(session_id.to_string(), params, cols, rows, app).await?;
        self.sessions.lock().await.insert(
            session_id.to_string(),
            SessionHandle {
                shell,
                conn,
                forwarded,
                sftp: Arc::new(Mutex::new(None)),
            },
        );
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn connect_and_exec_interactive(
        &self,
        session_id: &str,
        params: ConnectParams,
        command: String,
        rows: u32,
        cols: u32,
        app: AppHandle,
    ) -> Result<(), String> {
        // Same leak guard as `connect`: close any pre-existing session first.
        self.close_existing(session_id).await;
        let (shell, conn, forwarded) =
            session::spawn_exec(session_id.to_string(), params, cols, rows, app, command).await?;
        self.sessions.lock().await.insert(
            session_id.to_string(),
            SessionHandle {
                shell,
                conn,
                forwarded,
                sftp: Arc::new(Mutex::new(None)),
            },
        );
        Ok(())
    }

    /// Remove and gracefully close a session already in the map (if any).
    /// Used before inserting a replacement so the old connection/tasks don't leak.
    async fn close_existing(&self, session_id: &str) {
        if let Some(old) = self.sessions.lock().await.remove(session_id) {
            let _ = old.shell.send(ShellCmd::Close).await;
        }
    }

    pub async fn write_to_ssh(&self, session_id: &str, data: &[u8]) -> Result<(), String> {
        let tx = self
            .sessions
            .lock()
            .await
            .get(session_id)
            .map(|s| s.shell.clone());
        match tx {
            Some(tx) => tx
                .send(ShellCmd::Data(data.to_vec()))
                .await
                .map_err(|_| "Session closed".into()),
            None => Err("Session not found".into()),
        }
    }

    pub async fn resize_ssh(&self, session_id: &str, cols: u32, rows: u32) -> Result<(), String> {
        let tx = self
            .sessions
            .lock()
            .await
            .get(session_id)
            .map(|s| s.shell.clone());
        match tx {
            Some(tx) => tx
                .send(ShellCmd::Resize { cols, rows })
                .await
                .map_err(|_| "Session closed".into()),
            None => Err("Session not found".into()),
        }
    }

    pub async fn close_ssh(&self, session_id: &str) {
        self.close_local_forward(session_id).await;
        self.close_socks_forward(session_id).await;
        if let Some(s) = self.sessions.lock().await.remove(session_id) {
            let _ = s.shell.send(ShellCmd::Close).await;
        }
    }

    pub async fn close_all(&self) {
        let mut stops: Vec<_> = self.forwards.lock().await.drain().map(|(_, v)| v).collect();
        stops.extend(self.socks.lock().await.drain().map(|(_, v)| v));
        for stop in stops {
            stop.notify_waiters();
        }
        let sessions: Vec<_> = self.sessions.lock().await.drain().map(|(_, v)| v).collect();
        for s in sessions {
            let _ = s.shell.send(ShellCmd::Close).await;
        }
    }

    pub async fn ssh_exec(&self, session_id: &str, command: &str) -> Result<String, String> {
        let conn = self
            .sessions
            .lock()
            .await
            .get(session_id)
            .map(|s| s.conn.clone());
        match conn {
            Some(conn) => exec::exec(&conn, command).await,
            None => Err("Session not found".into()),
        }
    }

    pub async fn ssh_exec_stream<F>(
        &self,
        session_id: &str,
        command: &str,
        on_chunk: F,
        stop: Arc<Notify>,
    ) -> Result<(), String>
    where
        F: FnMut(Vec<u8>) + Send + 'static,
    {
        let conn = self
            .sessions
            .lock()
            .await
            .get(session_id)
            .map(|s| s.conn.clone())
            .ok_or("Session not found")?;
        exec::exec_stream(&conn, command, on_chunk, stop).await
    }

    pub async fn metrics_exec(&self, session_id: &str, command: &str) -> Result<String, String> {
        self.ssh_exec(session_id, command).await
    }

    /// Probe the remote shell and return the completion table identifier
    /// ("unix" | "cmd" | "powershell"). Best-effort: any failure yields "unix".
    pub async fn detect_command_table(&self, session_id: &str) -> Result<String, String> {
        let uname = self
            .ssh_exec(session_id, "uname -s")
            .await
            .unwrap_or_default();
        // Short-circuit: a clear POSIX kernel needs no second probe.
        if !uname.trim().is_empty() && probe::classify_command_table(&uname, "") == "unix" {
            return Ok("unix".to_string());
        }
        let comspec = self
            .ssh_exec(session_id, "echo %COMSPEC%")
            .await
            .unwrap_or_default();
        Ok(probe::classify_command_table(&uname, &comspec).to_string())
    }

    // --- Local port forwarding ---

    pub async fn start_local_forward(
        &self,
        session_id: &str,
        local_port: u16,
        remote_host: &str,
        remote_port: u16,
    ) -> Result<u16, String> {
        let conn = self
            .sessions
            .lock()
            .await
            .get(session_id)
            .map(|s| s.conn.clone())
            .ok_or("Session not found")?;
        self.close_local_forward(session_id).await;
        let stop = Arc::new(Notify::new());
        let port = forward::start_local(
            conn,
            local_port,
            remote_host.to_string(),
            remote_port,
            stop.clone(),
        )
        .await?;
        self.forwards
            .lock()
            .await
            .insert(session_id.to_string(), stop);
        Ok(port)
    }

    pub async fn close_local_forward(&self, session_id: &str) {
        if let Some(stop) = self.forwards.lock().await.remove(session_id) {
            stop.notify_waiters();
        }
    }

    // --- Dynamic SOCKS5 forwarding ---

    pub async fn start_socks_forward(
        &self,
        session_id: &str,
        local_port: u16,
    ) -> Result<u16, String> {
        let conn = self
            .sessions
            .lock()
            .await
            .get(session_id)
            .map(|s| s.conn.clone())
            .ok_or("Session not found")?;
        self.close_socks_forward(session_id).await;
        let stop = Arc::new(Notify::new());
        let port = forward::start_socks(conn, local_port, stop.clone()).await?;
        self.socks.lock().await.insert(session_id.to_string(), stop);
        Ok(port)
    }

    pub async fn close_socks_forward(&self, session_id: &str) {
        if let Some(stop) = self.socks.lock().await.remove(session_id) {
            stop.notify_waiters();
        }
    }

    // --- Remote port forwarding (tcpip_forward) ---

    /// Ask the server to listen on `remote_port` (0 = server-chosen) and bridge
    /// each inbound connection back to local `local_host:local_port`. The bridge
    /// itself runs in the session's `Client` handler
    /// (`server_channel_open_forwarded_tcpip`); here we register the target and
    /// issue the global `tcpip_forward` request. Returns the actual listen port.
    ///
    /// Note: in the existing IPC contract `remote_host`/`remote_port` name the
    /// local target to forward back to, while `local_port` is the server listen
    /// port — start_tunnel passes them straight through, so the call site reads
    /// (session_id, local_port = server listen port, remote_host/remote_port =
    /// local target).
    pub async fn start_remote_forward(
        &self,
        session_id: &str,
        remote_port: u16,
        local_host: &str,
        local_port: u16,
    ) -> Result<u16, String> {
        let (conn, forwarded) = {
            let sessions = self.sessions.lock().await;
            let s = sessions.get(session_id).ok_or("Session not found")?;
            (s.conn.clone(), s.forwarded.clone())
        };

        // Request the server-side listener. Bind to loopback-only (127.0.0.1)
        // so the port is not exposed on the server's external interfaces
        // (avoids GatewayPorts exposure when the server has it disabled or
        // unset). Use "0.0.0.0" explicitly only when external exposure is
        // intentional.
        let bound = conn
            .tcpip_forward("127.0.0.1", remote_port as u32)
            .await
            .map_err(|e| format!("Remote forward request failed: {}", e))?;
        // russh returns the chosen port when remote_port == 0, else 0.
        let actual = if remote_port == 0 {
            bound as u16
        } else {
            remote_port
        };

        // Register the local target so the handler can bridge inbound channels.
        // Key under the actual listen port; also under 0 as a wildcard fallback
        // so the forwarded-tcpip callback can always find the target even when
        // the server reports a different connected port.
        let target = (local_host.to_string(), local_port);
        let mut map = forwarded.lock().unwrap();
        map.insert(actual as u32, target.clone());
        map.insert(0, target);
        Ok(actual)
    }

    // --- SFTP ---
    // Each op opens a fresh SFTP subsystem channel on the session's shared
    // connection. They are deliberately repeated (one method per op) so the
    // command layer can call them directly; the shape is identical.

    /// Return this session's SFTP subsystem, opening + caching it on first use.
    /// Subsequent calls reuse the same channel, skipping the channel-open +
    /// subsystem + INIT handshake. The cache lock is held only across the open,
    /// so operations themselves run concurrently on the shared session.
    async fn sftp_session(&self, session_id: &str) -> Result<Arc<SftpSession>, String> {
        let (conn, cache) = {
            let sessions = self.sessions.lock().await;
            let s = sessions.get(session_id).ok_or("Session not found")?;
            (s.conn.clone(), s.sftp.clone())
        };
        let mut guard = cache.lock().await;
        if let Some(existing) = guard.as_ref() {
            return Ok(existing.clone());
        }
        let fresh = Arc::new(sftp::open_sftp(&conn).await?);
        *guard = Some(fresh.clone());
        Ok(fresh)
    }

    /// Drop the cached SFTP session so the next call reopens it. Called after an
    /// operation fails, since the failure may mean the channel died.
    async fn invalidate_sftp(&self, session_id: &str) {
        let cache = self
            .sessions
            .lock()
            .await
            .get(session_id)
            .map(|s| s.sftp.clone());
        if let Some(cache) = cache {
            *cache.lock().await = None;
        }
    }

    /// Run an SFTP operation on the cached session; if it fails with a
    /// *channel-died* error, drop the cache, reopen once, and retry. This
    /// recovers transparently when the cached channel has died (e.g. server-side
    /// idle timeout). The retry is safe because every wrapped op is idempotent or
    /// self-correcting.
    ///
    /// Expected failures (permission denied, not found, etc.) are NOT retried:
    /// reopening the channel for them would just pay the handshake twice for an
    /// error that will recur. This matters during home-path probing where several
    /// unreadable candidates each fail.
    async fn with_sftp<T, F, Fut>(&self, session_id: &str, op: F) -> Result<T, String>
    where
        F: Fn(Arc<SftpSession>) -> Fut,
        Fut: std::future::Future<Output = Result<T, String>>,
    {
        let sftp = self.sftp_session(session_id).await?;
        match op(sftp).await {
            Ok(v) => Ok(v),
            Err(first) => {
                // Only retry on errors that suggest the channel itself is dead
                // (IO / closed / eof), not on expected SFTP status errors.
                let lower = first.to_lowercase();
                let channel_died = lower.contains("channel")
                    || lower.contains("closed")
                    || lower.contains("eof")
                    || lower.contains("broken pipe")
                    || lower.contains("connection reset");
                if !channel_died {
                    return Err(first);
                }
                self.invalidate_sftp(session_id).await;
                match self.sftp_session(session_id).await {
                    Ok(fresh) => op(fresh).await,
                    Err(_) => Err(first),
                }
            }
        }
    }

    pub async fn sftp_list_dir(
        &self,
        session_id: &str,
        path: &str,
    ) -> Result<Vec<SftpEntry>, String> {
        self.with_sftp(session_id, |sftp| async move {
            sftp::list_dir(&sftp, path).await
        })
        .await
    }

    pub async fn sftp_realpath(&self, session_id: &str, path: &str) -> Result<String, String> {
        // No retry wrapper: realpath legitimately fails on servers that don't
        // support it (the frontend falls back), so a reopen-and-retry would just
        // pay the handshake twice for an expected failure.
        let sftp = self.sftp_session(session_id).await?;
        sftp::realpath(&sftp, path).await
    }

    pub async fn sftp_mkdir(&self, session_id: &str, path: &str) -> Result<(), String> {
        self.with_sftp(
            session_id,
            |sftp| async move { sftp::mkdir(&sftp, path).await },
        )
        .await
    }

    pub async fn sftp_rmdir(&self, session_id: &str, path: &str) -> Result<(), String> {
        self.with_sftp(
            session_id,
            |sftp| async move { sftp::rmdir(&sftp, path).await },
        )
        .await
    }

    pub async fn sftp_delete_file(&self, session_id: &str, path: &str) -> Result<(), String> {
        self.with_sftp(session_id, |sftp| async move {
            sftp::delete_file(&sftp, path).await
        })
        .await
    }

    pub async fn sftp_rename(&self, session_id: &str, old: &str, new: &str) -> Result<(), String> {
        self.with_sftp(session_id, |sftp| async move {
            sftp::rename(&sftp, old, new).await
        })
        .await
    }

    pub async fn sftp_read_text(&self, session_id: &str, path: &str) -> Result<String, String> {
        self.with_sftp(session_id, |sftp| async move {
            sftp::read_text(&sftp, path).await
        })
        .await
    }

    pub async fn sftp_write_text(
        &self,
        session_id: &str,
        path: &str,
        content: &str,
    ) -> Result<(), String> {
        self.with_sftp(session_id, |sftp| async move {
            sftp::write_text(&sftp, path, content).await
        })
        .await
    }

    pub async fn sftp_download(
        &self,
        session_id: &str,
        remote: &str,
        local: &str,
        progress: Option<ProgressFn>,
    ) -> Result<(), String> {
        // Reuse the cached SFTP session instead of opening a fresh channel
        // (a new subsystem handshake is ~3 round-trips). We use sftp_session
        // directly rather than with_sftp because with_sftp retries the op on
        // failure — but progress (Box<dyn FnMut>) can't be called twice, and a
        // partial transfer retry would need resume logic. On error we still
        // invalidate the cached channel so the user's next retry starts fresh.
        let sftp = self.sftp_session(session_id).await?;
        let result = sftp::download(&sftp, remote, local, progress).await;
        if result.is_err() {
            self.invalidate_sftp(session_id).await;
        }
        result
    }

    pub async fn sftp_upload(
        &self,
        session_id: &str,
        remote: &str,
        local: &str,
        progress: Option<ProgressFn>,
    ) -> Result<(), String> {
        let sftp = self.sftp_session(session_id).await?;
        let result = sftp::upload(&sftp, remote, local, progress).await;
        if result.is_err() {
            self.invalidate_sftp(session_id).await;
        }
        result
    }

    pub async fn sftp_download_dir(
        &self,
        session_id: &str,
        remote_dir: &str,
        local_parent: &str,
        progress: Option<ProgressFn>,
    ) -> Result<usize, String> {
        let sftp = self.sftp_session(session_id).await?;
        let result = sftp::download_dir(&sftp, remote_dir, local_parent, progress).await;
        if result.is_err() {
            self.invalidate_sftp(session_id).await;
        }
        result
    }

    pub async fn sftp_upload_dir(
        &self,
        session_id: &str,
        remote_parent: &str,
        local_dir: &str,
        progress: Option<ProgressFn>,
    ) -> Result<usize, String> {
        let sftp = self.sftp_session(session_id).await?;
        let result = sftp::upload_dir(&sftp, remote_parent, local_dir, progress).await;
        if result.is_err() {
            self.invalidate_sftp(session_id).await;
        }
        result
    }

    pub async fn sftp_chmod(&self, session_id: &str, path: &str, mode: u32) -> Result<(), String> {
        self.with_sftp(session_id, |sftp| async move {
            sftp::chmod(&sftp, path, mode).await
        })
        .await
    }

    pub async fn sftp_create_file(&self, session_id: &str, path: &str) -> Result<(), String> {
        self.with_sftp(session_id, |sftp| async move {
            sftp::create_file(&sftp, path).await
        })
        .await
    }
}
