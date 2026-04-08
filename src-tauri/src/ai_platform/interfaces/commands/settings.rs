use crate::ai_platform::application::settings::service;
use crate::ai_platform::domain::settings::AiPlatformSettingsRecord;
use crate::ai_platform::interfaces::dto::settings::SettingsSnapshotDto;

#[tauri::command]
pub async fn ai_platform_get_settings_snapshot() -> Result<SettingsSnapshotDto, String> {
    tokio::task::spawn_blocking(service::get_settings_snapshot)
        .await
        .map_err(|error| format!("task join: {error}"))?
}

#[tauri::command]
pub async fn ai_platform_save_settings(
    settings: AiPlatformSettingsRecord,
) -> Result<SettingsSnapshotDto, String> {
    tokio::task::spawn_blocking(move || service::save_settings(settings))
        .await
        .map_err(|error| format!("task join: {error}"))?
}