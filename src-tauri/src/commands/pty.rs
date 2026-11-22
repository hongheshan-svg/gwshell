use crate::pty;
use crate::state::AppState;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
#[allow(clippy::too_many_arguments)] // Tauri command — args map to frontend IPC params
pub async fn create_local_shell(
    session_id: String,
    rows: u16,
    cols: u16,
    shell_name: Option<String>,
    working_dir: Option<String>,
    charset: Option<String>,
    env_vars: Option<String>,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        state.pty_manager.create_shell(
            &session_id,
            app_handle,
            rows,
            cols,
            shell_name,
            working_dir,
            charset,
            env_vars,
        )
    })
    .await
    .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
pub async fn list_shells() -> Vec<pty::ShellEntry> {
    tokio::task::spawn_blocking(pty::list_available_shells)
        .await
        .unwrap_or_default()
}

// Terminal input commands only enqueue data/control messages to per-session
// owner threads. The owner threads perform the actual PTY/SSH/serial I/O, so
// these IPC calls return quickly and never wait on a congested socket/device.
#[tauri::command]
pub async fn write_to_pty(
    session_id: String,
    data: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state.pty_manager.write_to_pty(&session_id, data.as_bytes())
}

#[tauri::command]
pub async fn resize_pty(
    session_id: String,
    rows: u16,
    cols: u16,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state.pty_manager.resize_pty(&session_id, rows, cols)
}

#[tauri::command]
pub async fn close_pty(session_id: String, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state.pty_manager.close_pty(&session_id);
    })
    .await
    .map_err(|e| format!("task join: {}", e))?;
    Ok(())
}
