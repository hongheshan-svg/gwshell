use crate::serial;
use crate::state::AppState;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
#[allow(clippy::too_many_arguments)] // Tauri command — args map to frontend IPC params
pub async fn serial_open(
    session_id: String,
    port_name: String,
    baud_rate: u32,
    data_bits: String,
    stop_bits: String,
    parity: String,
    flow_control: Option<String>,
    serial_encoding: Option<String>,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        state.serial_manager.open(
            &session_id,
            &port_name,
            baud_rate,
            &data_bits,
            &stop_bits,
            &parity,
            flow_control.as_deref().unwrap_or("none"),
            serial_encoding.as_deref(),
            app_handle,
        )
    })
    .await
    .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
pub async fn write_to_serial(
    session_id: String,
    data: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .serial_manager
        .write_to_serial(&session_id, data.as_bytes())
}

#[tauri::command]
pub async fn close_serial(
    session_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state.serial_manager.close_serial(&session_id);
    Ok(())
}

#[tauri::command]
pub async fn list_serial_ports() -> Vec<String> {
    tokio::task::spawn_blocking(serial::list_serial_ports)
        .await
        .unwrap_or_default()
}
