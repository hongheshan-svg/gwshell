//! Async SSH backend on russh.
#![allow(dead_code)] // until cutover (Task 12)

mod auth;
mod connect;
mod exec;
mod handler;
mod known_hosts;
mod params;
mod session;
mod transport;

pub use known_hosts::trust_host;
pub use params::ConnectParams;

use crate::ssh_next::handler::Client;
use russh::client::Handle;
use session::ShellCmd;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::{mpsc, Mutex};

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
        if let Some(s) = self.sessions.lock().await.remove(session_id) {
            let _ = s.shell.send(ShellCmd::Close).await;
        }
    }

    pub async fn close_all(&self) {
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
}
