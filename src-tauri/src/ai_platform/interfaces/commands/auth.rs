use crate::ai_platform::application::auth::service;
use crate::ai_platform::interfaces::dto::auth::AuthSnapshotDto;

#[tauri::command]
pub async fn ai_platform_get_auth_snapshot() -> Result<AuthSnapshotDto, String> {
    tokio::task::spawn_blocking(service::get_auth_snapshot)
        .await
        .map_err(|error| format!("task join: {error}"))?
}