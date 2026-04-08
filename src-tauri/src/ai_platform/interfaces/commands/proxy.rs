use crate::ai_platform::application::proxy::service;
use crate::ai_platform::domain::proxy::ProxyControlPlaneRecord;
use crate::ai_platform::interfaces::dto::proxy::ProxySnapshotDto;

#[tauri::command]
pub async fn ai_platform_get_proxy_snapshot() -> Result<ProxySnapshotDto, String> {
    tokio::task::spawn_blocking(service::get_proxy_snapshot)
        .await
        .map_err(|error| format!("task join: {error}"))?
}

#[tauri::command]
pub async fn ai_platform_save_proxy_config(
    config: ProxyControlPlaneRecord,
) -> Result<ProxySnapshotDto, String> {
    tokio::task::spawn_blocking(move || service::save_proxy_config(config))
        .await
        .map_err(|error| format!("task join: {error}"))?
}