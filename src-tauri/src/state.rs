use crate::agent;
use crate::database::Database;
use crate::metrics;
use crate::pty::PtyManager;
use crate::serial::SerialManager;
use crate::session::SessionConfig;
use crate::ssh::SshManager;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Notify;

pub struct AppState {
    pub pty_manager: PtyManager,
    pub ssh_manager: Arc<SshManager>,
    pub agent_manager: Arc<agent::manager::AgentManager>,
    pub agent_log_streams: Mutex<HashMap<String, Arc<Notify>>>,
    pub serial_manager: SerialManager,
    pub sessions: Mutex<Vec<SessionConfig>>,
    pub db: Database,
    pub metrics: metrics::MetricsManager,
}

pub fn redacted_session_for_frontend(session: &SessionConfig) -> SessionConfig {
    let mut redacted = session.clone();
    redacted.password = None;
    redacted.totp_code = None;
    redacted.jump_password = None;
    redacted.proxy_password = None;
    redacted
}

pub fn redacted_sessions_for_frontend(sessions: &[SessionConfig]) -> Vec<SessionConfig> {
    sessions.iter().map(redacted_session_for_frontend).collect()
}

/// Cancellation flags of the terminal AI requests in flight, by request id, so
/// the dock's Stop button ends the provider stream instead of leaving it to
/// run (and bill) to completion in the background.
pub fn terminal_ai_requests() -> &'static Mutex<HashMap<String, Arc<std::sync::atomic::AtomicBool>>>
{
    static REQUESTS: std::sync::OnceLock<
        Mutex<HashMap<String, Arc<std::sync::atomic::AtomicBool>>>,
    > = std::sync::OnceLock::new();
    REQUESTS.get_or_init(Default::default)
}

/// Registers a request's cancellation flag; unregisters it when dropped.
pub struct TerminalAiRequestGuard {
    request_id: String,
    pub cancelled: Arc<std::sync::atomic::AtomicBool>,
}

impl TerminalAiRequestGuard {
    pub fn register(request_id: &str) -> Self {
        let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
        terminal_ai_requests()
            .lock()
            .insert(request_id.to_string(), cancelled.clone());
        Self {
            request_id: request_id.to_string(),
            cancelled,
        }
    }
}

impl Drop for TerminalAiRequestGuard {
    fn drop(&mut self) {
        terminal_ai_requests().lock().remove(&self.request_id);
    }
}

/// Look up a saved session (with decrypted secrets) without parking an async
/// runtime worker: `sessions` is a sync lock that `save_session` holds across
/// SQLite + OS-keyring I/O, which can wait on a keychain prompt.
pub async fn find_session(state: &Arc<AppState>, id: &str) -> Option<SessionConfig> {
    let state = state.clone();
    let id = id.to_string();
    tokio::task::spawn_blocking(move || state.sessions.lock().iter().find(|s| s.id == id).cloned())
        .await
        .ok()
        .flatten()
}

/// Best-effort cleanup on shutdown: stop metric pollers and kill local-shell
/// child processes so they are not orphaned. SSH/serial sockets are reclaimed by
/// the OS on process exit, but we still tell live SSH sessions to close so their
/// reader/writer tasks exit promptly and don't leave a half-open shell on the
/// server. `close_all` only enqueues `ShellCmd::Close` (non-blocking) — it does
/// not `await` the connection's `wait_close`, so it can't hang shutdown.
pub fn shutdown_cleanup(state: &Arc<AppState>) {
    state.metrics.stop_all();
    for (_, flag) in terminal_ai_requests().lock().drain() {
        flag.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    for (_, stop) in state.agent_log_streams.lock().drain() {
        stop.notify_waiters();
    }
    state.pty_manager.close_all();
    state.serial_manager.close_all();
    // Gracefully signal SSH sessions + port/SOCKS forwards to stop. Best-effort:
    // if block_on can't run (runtime already torn down) we fall back to OS
    // reclamation, matching the previous behavior.
    tauri::async_runtime::block_on(async {
        state.ssh_manager.close_all().await;
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::{AuthMethod, SessionType};

    #[test]
    fn redacted_session_for_frontend_removes_all_inline_secrets() {
        let session = SessionConfig {
            id: "s1".to_string(),
            name: "server".to_string(),
            session_type: SessionType::Ssh,
            host: Some("example.com".to_string()),
            auth_method: AuthMethod::KeyboardInteractive,
            password: Some("password".to_string()),
            totp_code: Some("123456".to_string()),
            jump_password: Some("jump".to_string()),
            proxy_password: Some("proxy".to_string()),
            private_key_path: Some("~/.ssh/id_ed25519".to_string()),
            jump_private_key_path: Some("~/.ssh/jump".to_string()),
            ..Default::default()
        };

        let redacted = redacted_session_for_frontend(&session);

        assert_eq!(redacted.id, "s1");
        assert_eq!(redacted.host.as_deref(), Some("example.com"));
        assert_eq!(
            redacted.private_key_path.as_deref(),
            Some("~/.ssh/id_ed25519")
        );
        assert_eq!(
            redacted.jump_private_key_path.as_deref(),
            Some("~/.ssh/jump")
        );
        assert!(redacted.password.is_none());
        assert!(redacted.totp_code.is_none());
        assert!(redacted.jump_password.is_none());
        assert!(redacted.proxy_password.is_none());
    }
}
