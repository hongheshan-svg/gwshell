use crate::ai_platform::application::sessions::service;
use crate::ai_platform::interfaces::dto::sessions::SessionsSnapshotDto;

#[tauri::command]
pub async fn ai_platform_get_sessions_snapshot() -> Result<SessionsSnapshotDto, String> {
    tokio::task::spawn_blocking(service::get_sessions_snapshot)
        .await
        .map_err(|error| format!("task join: {error}"))?
}

#[tauri::command]
pub async fn ai_platform_delete_session_record(
    session_id: String,
) -> Result<SessionsSnapshotDto, String> {
    tokio::task::spawn_blocking(move || service::delete_session_record(session_id))
        .await
        .map_err(|error| format!("task join: {error}"))?
}