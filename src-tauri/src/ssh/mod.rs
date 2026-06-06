//! Async SSH backend on russh.

mod auth;
mod connect;
mod exec;
mod forward;
mod handler;
mod known_hosts;
mod params;
mod session;
mod sftp;
mod transport;

pub use known_hosts::trust_host;
pub use params::ConnectParams;
pub use sftp::SftpEntry;

use crate::ssh::handler::Client;
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
        let (shell, conn) = session::spawn(session_id.to_string(), params, cols, rows, app).await?;
        self.sessions
            .lock()
            .await
            .insert(session_id.to_string(), SessionHandle { shell, conn });
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
    ) -> Result<(), String> {
        let conn = self
            .sessions
            .lock()
            .await
            .get(session_id)
            .map(|s| s.conn.clone());
        match conn {
            Some(c) => sftp::download(&c, remote, local).await,
            None => Err("Session not found".into()),
        }
    }

    pub async fn sftp_upload(
        &self,
        session_id: &str,
        remote: &str,
        local: &str,
    ) -> Result<(), String> {
        let conn = self
            .sessions
            .lock()
            .await
            .get(session_id)
            .map(|s| s.conn.clone());
        match conn {
            Some(c) => sftp::upload(&c, remote, local).await,
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
