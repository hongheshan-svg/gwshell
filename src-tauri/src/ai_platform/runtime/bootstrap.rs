use crate::ai_platform::infrastructure::fs::proxy_store::load_store;
use crate::ai_platform::infrastructure::proxy;
use crate::ai_platform::runtime::state;

/// Called once during Tauri app setup.
/// Starts the local proxy if the saved config has `server.running = true`.
pub fn start_if_configured() {
    let config = match load_store() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[ai-platform] Failed to load proxy config at startup: {e}");
            return;
        }
    };

    if !config.server.running {
        return;
    }

    let host = config.server.listen_host.clone();
    let port = config.server.listen_port;
    let connect_timeout = config.server.connect_timeout_seconds;
    let request_timeout = config.server.request_timeout_seconds;
    let log = config.server.log_requests;

    tokio::spawn(async move {
        match proxy::start(&host, port, connect_timeout, request_timeout, log).await {
            Ok(handle) => {
                eprintln!("[ai-platform] Proxy started on {host}:{port}");
                state::set_proxy_handle(handle);
            }
            Err(e) => {
                eprintln!("[ai-platform] Proxy failed to start: {e}");
            }
        }
    });
}
