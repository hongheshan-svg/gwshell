use crate::ai_platform::application::providers::service;
use crate::ai_platform::domain::provider::ProviderRecord;
use crate::ai_platform::interfaces::dto::providers::{ProviderHealthDto, ProviderSnapshotDto};

#[tauri::command]
pub async fn ai_platform_list_providers() -> Result<ProviderSnapshotDto, String> {
    tokio::task::spawn_blocking(service::list_provider_snapshot)
        .await
        .map_err(|error| format!("task join: {error}"))?
}

#[tauri::command]
pub async fn ai_platform_save_provider(
    provider: ProviderRecord,
) -> Result<ProviderSnapshotDto, String> {
    tokio::task::spawn_blocking(move || service::save_provider(provider))
        .await
        .map_err(|error| format!("task join: {error}"))?
}

#[tauri::command]
pub async fn ai_platform_delete_provider(
    provider_id: String,
) -> Result<ProviderSnapshotDto, String> {
    tokio::task::spawn_blocking(move || service::delete_provider(provider_id))
        .await
        .map_err(|error| format!("task join: {error}"))?
}

#[tauri::command]
pub async fn ai_platform_switch_provider(
    provider_id: String,
    app: String,
) -> Result<ProviderSnapshotDto, String> {
    tokio::task::spawn_blocking(move || service::switch_provider(provider_id, app))
        .await
        .map_err(|error| format!("task join: {error}"))?
}

#[tauri::command]
pub async fn ai_platform_check_provider_health(
    provider_id: String,
) -> Result<ProviderHealthDto, String> {
    tokio::task::spawn_blocking(move || service::check_provider_health(provider_id))
        .await
        .map_err(|error| format!("task join: {error}"))?
}