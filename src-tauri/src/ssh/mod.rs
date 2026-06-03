//! Async SSH backend on russh.
#![allow(dead_code)] // until cutover (Task 12)

mod auth;
mod connect;
mod handler;
mod known_hosts;
mod params;
mod session;
mod transport;

pub use known_hosts::trust_host;
pub use params::ConnectParams;

use session::ShellCmd;
use std::collections::HashMap;
use tauri::AppHandle;
use tokio::sync::{mpsc, Mutex};

#[derive(Default)]
pub struct SshManager {
    shells: Mutex<HashMap<String, mpsc::Sender<ShellCmd>>>,
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
        let tx = session::spawn(session_id.to_string(), params, cols, rows, app).await?;
        self.shells.lock().await.insert(session_id.to_string(), tx);
        Ok(())
    }

    pub async fn write_to_ssh(&self, session_id: &str, data: &[u8]) -> Result<(), String> {
        let tx = self.shells.lock().await.get(session_id).cloned();
        match tx {
            Some(tx) => tx
                .send(ShellCmd::Data(data.to_vec()))
                .await
                .map_err(|_| "Session closed".into()),
            None => Err("Session not found".into()),
        }
    }

    pub async fn resize_ssh(&self, session_id: &str, cols: u32, rows: u32) -> Result<(), String> {
        let tx = self.shells.lock().await.get(session_id).cloned();
        match tx {
            Some(tx) => tx
                .send(ShellCmd::Resize { cols, rows })
                .await
                .map_err(|_| "Session closed".into()),
            None => Err("Session not found".into()),
        }
    }

    pub async fn close_ssh(&self, session_id: &str) {
        if let Some(tx) = self.shells.lock().await.remove(session_id) {
            let _ = tx.send(ShellCmd::Close).await;
        }
    }

    pub async fn close_all(&self) {
        let txs: Vec<_> = self
            .shells
            .lock()
            .await
            .drain()
            .map(|(_, v)| v)
            .collect();
        for tx in txs {
            let _ = tx.send(ShellCmd::Close).await;
        }
    }
}
