use crate::state::AppState;
use std::sync::Arc;
use tauri::State;

// NOTE: must be `async` so Tauri runs it on the async (Tokio) runtime. As a sync
// command it executes on the main thread with no reactor entered, and the
// `tokio::spawn` inside `MetricsManager::start` panics ("there is no reactor
// running"), aborting the whole app the moment the Server panel opens on an SSH tab.
#[tauri::command]
pub async fn start_server_metrics(
    session_id: String,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    state
        .metrics
        .start_with_state(session_id, state.inner().clone(), app_handle);
    Ok(())
}

#[tauri::command]
pub fn stop_server_metrics(session_id: String, state: State<'_, Arc<AppState>>) {
    state.metrics.stop(&session_id);
}

#[tauri::command]
pub async fn kill_remote_process(
    session_id: String,
    pid: u32,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let cmd = format!("kill {}", pid);
    state
        .ssh_manager
        .ssh_exec(&session_id, &cmd)
        .await
        .map(|_| ())
}

#[tauri::command]
pub async fn detect_remote_os(
    session_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    state.ssh_manager.detect_command_table(&session_id).await
}

// ---- Ping Command ----

#[tauri::command]
pub async fn ping_host(host: String, port: u16, timeout_secs: Option<u64>) -> Result<f64, String> {
    use std::time::Instant;
    use tokio::net::TcpStream;
    use tokio::time::{timeout, Duration};

    let addr = format!("{}:{}", host, port);
    // Default 5s. Honor the session's configured connection timeout when given,
    // clamped to a sane probe range so a slow host can't be reported as "down"
    // on a 3s hair-trigger, nor hang the poller on a huge configured value.
    let secs = timeout_secs.unwrap_or(5).clamp(2, 10);
    let start = Instant::now();
    match timeout(Duration::from_secs(secs), TcpStream::connect(&addr)).await {
        Ok(Ok(_)) => {
            let elapsed = start.elapsed().as_secs_f64() * 1000.0;
            Ok((elapsed * 10.0).round() / 10.0) // round to 0.1ms
        }
        Ok(Err(e)) => Err(format!("Connect failed: {}", e)),
        Err(_) => Err("Timeout".to_string()),
    }
}
