use crate::ai_platform::application::openclaw::service;
use crate::ai_platform::domain::openclaw::OpenClawEditableConfigRecord;
use crate::ai_platform::interfaces::dto::openclaw::OpenClawSnapshotDto;

#[tauri::command]
pub async fn ai_platform_get_openclaw_snapshot() -> Result<OpenClawSnapshotDto, String> {
    tokio::task::spawn_blocking(service::get_openclaw_snapshot)
        .await
        .map_err(|error| format!("task join: {error}"))?
}

#[tauri::command]
pub async fn ai_platform_save_openclaw_config(
    config: OpenClawEditableConfigRecord,
) -> Result<OpenClawSnapshotDto, String> {
    tokio::task::spawn_blocking(move || service::save_openclaw_config(config))
        .await
        .map_err(|error| format!("task join: {error}"))?
}