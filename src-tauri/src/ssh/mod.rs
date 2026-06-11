//! Async SSH backend on russh.

mod auth;
pub(crate) mod connect;
pub(crate) mod exec;
mod forward;
mod handler;
mod known_hosts;
pub(crate) mod params;
mod session;
mod sftp;
mod transport;

pub use known_hosts::trust_host;
pub use params::ConnectParams;
pub use sftp::{ProgressFn, SftpEntry};

use crate::ssh::handler::{Client, ForwardTargets};
use russh::client::Handle;
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
        let (shell, conn, forwarded) =
            session::spawn(session_id.to_string(), params, cols, rows, app).await?;
        self.sessions.lock().await.insert(
            session_id.to_string(),
            SessionHandle {
                shell,
                conn,
                forwarded,
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
        let (shell, conn, forwarded) =
            session::spawn_exec(session_id.to_string(), params, cols, rows, app, command).await?;
        self.sessions.lock().await.insert(
            session_id.to_string(),
            SessionHandle {
                shell,
                conn,
                forwarded,
            },
        );
        Ok(())
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
        let mut stops: Vec<_> = self
            .forwards
            .lock()
            .await
            .drain()
            .map(|(_, v)| v)
            .collect();
        stops.extend(self.socks.lock().await.drain().map(|(_, v)| v));
        for stop in stops {
            stop.notify_waiters();
        }
        let sessions: Vec<_> = self
            .sessions
            .lock()
            .await
            .drain()
            .map(|(_, v)| v)
            .collect();
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

    pub async fn metrics_exec(&self, session_id: &str, command: &str) -> Result<String, String> {
        self.ssh_exec(session_id, command).await
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

    pub async fn sftp_list_dir(
        &self,
        session_id: &str,
        path: &str,
    ) -> Result<Vec<SftpEntry>, String> {
        let conn = self
            .sessions
            .lock()
            .await
            .get(session_id)
            .map(|s| s.conn.clone());
        match conn {
            Some(c) => sftp::list_dir(&c, path).await,
            None => Err("Session not found".into()),
        }
    }

    pub async fn sftp_realpath(&self, session_id: &str, path: &str) -> Result<String, String> {
        let conn = self
            .sessions
            .lock()
            .await
            .get(session_id)
            .map(|s| s.conn.clone());
        match conn {
            Some(c) => sftp::realpath(&c, path).await,
            None => Err("Session not found".into()),
        }
    }

    pub async fn sftp_mkdir(&self, session_id: &str, path: &str) -> Result<(), String> {
        let conn = self
            .sessions
            .lock()
            .await
            .get(session_id)
            .map(|s| s.conn.clone());
        match conn {
            Some(c) => sftp::mkdir(&c, path).await,
            None => Err("Session not found".into()),
        }
    }

    pub async fn sftp_rmdir(&self, session_id: &str, path: &str) -> Result<(), String> {
        let conn = self
            .sessions
            .lock()
            .await
            .get(session_id)
            .map(|s| s.conn.clone());
        match conn {
            Some(c) => sftp::rmdir(&c, path).await,
            None => Err("Session not found".into()),
        }
    }

    pub async fn sftp_delete_file(&self, session_id: &str, path: &str) -> Result<(), String> {
        let conn = self
            .sessions
            .lock()
            .await
            .get(session_id)
            .map(|s| s.conn.clone());
        match conn {
            Some(c) => sftp::delete_file(&c, path).await,
            None => Err("Session not found".into()),
        }
    }

    pub async fn sftp_rename(
        &self,
        session_id: &str,
        old: &str,
        new: &str,
    ) -> Result<(), String> {
        let conn = self
            .sessions
            .lock()
            .await
            .get(session_id)
            .map(|s| s.conn.clone());
        match conn {
            Some(c) => sftp::rename(&c, old, new).await,
            None => Err("Session not found".into()),
        }
    }

    pub async fn sftp_read_text(&self, session_id: &str, path: &str) -> Result<String, String> {
        let conn = self
            .sessions
            .lock()
            .await
            .get(session_id)
            .map(|s| s.conn.clone());
        match conn {
            Some(c) => sftp::read_text(&c, path).await,
            None => Err("Session not found".into()),
        }
    }

    pub async fn sftp_write_text(
        &self,
        session_id: &str,
        path: &str,
        content: &str,
    ) -> Result<(), String> {
        let conn = self
            .sessions
            .lock()
            .await
            .get(session_id)
            .map(|s| s.conn.clone());
        match conn {
            Some(c) => sftp::write_text(&c, path, content).await,
            None => Err("Session not found".into()),
        }
    }

    pub async fn sftp_download(
        &self,
        session_id: &str,
        remote: &str,
        local: &str,
        progress: Option<ProgressFn>,
    ) -> Result<(), String> {
        let conn = self
            .sessions
            .lock()
            .await
            .get(session_id)
            .map(|s| s.conn.clone());
        match conn {
            Some(c) => sftp::download(&c, remote, local, progress).await,
            None => Err("Session not found".into()),
        }
    }

    pub async fn sftp_upload(
        &self,
        session_id: &str,
        remote: &str,
        local: &str,
        progress: Option<ProgressFn>,
    ) -> Result<(), String> {
        let conn = self
            .sessions
            .lock()
            .await
            .get(session_id)
            .map(|s| s.conn.clone());
        match conn {
            Some(c) => sftp::upload(&c, remote, local, progress).await,
            None => Err("Session not found".into()),
        }
    }

    pub async fn sftp_download_dir(
        &self,
        session_id: &str,
        remote_dir: &str,
        local_parent: &str,
        progress: Option<ProgressFn>,
    ) -> Result<usize, String> {
        let conn = self
            .sessions
            .lock()
            .await
            .get(session_id)
            .map(|s| s.conn.clone());
        match conn {
            Some(c) => sftp::download_dir(&c, remote_dir, local_parent, progress).await,
            None => Err("Session not found".into()),
        }
    }

    pub async fn sftp_upload_dir(
        &self,
        session_id: &str,
        remote_parent: &str,
        local_dir: &str,
        progress: Option<ProgressFn>,
    ) -> Result<usize, String> {
        let conn = self
            .sessions
            .lock()
            .await
            .get(session_id)
            .map(|s| s.conn.clone());
        match conn {
            Some(c) => sftp::upload_dir(&c, remote_parent, local_dir, progress).await,
            None => Err("Session not found".into()),
        }
    }

    pub async fn sftp_chmod(
        &self,
        session_id: &str,
        path: &str,
        mode: u32,
    ) -> Result<(), String> {
        let conn = self
            .sessions
            .lock()
            .await
            .get(session_id)
            .map(|s| s.conn.clone());
        match conn {
            Some(c) => sftp::chmod(&c, path, mode).await,
            None => Err("Session not found".into()),
        }
    }

    pub async fn sftp_create_file(&self, session_id: &str, path: &str) -> Result<(), String> {
        let conn = self
            .sessions
            .lock()
            .await
            .get(session_id)
            .map(|s| s.conn.clone());
        match conn {
            Some(c) => sftp::create_file(&c, path).await,
            None => Err("Session not found".into()),
        }
    }
}
