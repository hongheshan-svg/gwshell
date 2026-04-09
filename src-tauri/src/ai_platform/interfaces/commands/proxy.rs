use crate::ai_platform::application::proxy::service;
use crate::ai_platform::domain::proxy::ProxyControlPlaneRecord;
use crate::ai_platform::infrastructure::fs::proxy_store::{load_store, save_store};
use crate::ai_platform::infrastructure::proxy;
use crate::ai_platform::interfaces::dto::proxy::{ProxyRuntimeStatusDto, ProxySnapshotDto};
use crate::ai_platform::runtime::state;

#[tauri::command]
pub async fn ai_platform_get_proxy_snapshot() -> Result<ProxySnapshotDto, String> {
    let mut snapshot = tokio::task::spawn_blocking(service::get_proxy_snapshot)
        .await
        .map_err(|e| format!("task join: {e}"))??;

    // Overlay the live runtime running state
    let running = state::is_proxy_running();
    snapshot.config.server.running = running;
    if let Some((host, port)) = state::proxy_addr() {
        snapshot.config.server.listen_host = host;
        snapshot.config.server.listen_port = port;
    }
    Ok(snapshot)
}

#[tauri::command]
pub async fn ai_platform_save_proxy_config(
    config: ProxyControlPlaneRecord,
) -> Result<ProxySnapshotDto, String> {
    tokio::task::spawn_blocking(move || service::save_proxy_config(config))
        .await
        .map_err(|e| format!("task join: {e}"))?
}

#[tauri::command]
pub async fn ai_platform_start_proxy() -> Result<ProxyRuntimeStatusDto, String> {
    if state::is_proxy_running() {
        let (host, port) = state::proxy_addr().unwrap_or_default();
        return Ok(ProxyRuntimeStatusDto {
            running: true,
            host,
            port,
            message: "Proxy is already running.".to_string(),
        });
    }

    let config = tokio::task::spawn_blocking(load_store)
        .await
        .map_err(|e| format!("task join: {e}"))??;

    let host = config.server.listen_host.clone();
    let port = config.server.listen_port;

    let handle = proxy::start(
        &host,
        port,
        config.server.connect_timeout_seconds,
        config.server.request_timeout_seconds,
        config.server.log_requests,
    )
    .await?;

    state::set_proxy_handle(handle);

    // Persist running=true so next app start auto-launches
    let mut updated = config;
    updated.server.running = true;
    tokio::task::spawn_blocking(move || save_store(&updated))
        .await
        .map_err(|e| format!("task join: {e}"))??;

    Ok(ProxyRuntimeStatusDto {
        running: true,
        message: format!("Proxy started on {host}:{port}"),
        host,
        port,
    })
}

#[tauri::command]
pub async fn ai_platform_stop_proxy() -> Result<ProxyRuntimeStatusDto, String> {
    state::stop_proxy();

    // Persist running=false
    let config = tokio::task::spawn_blocking(load_store)
        .await
        .map_err(|e| format!("task join: {e}"))??;
    let mut updated = config;
    updated.server.running = false;
    tokio::task::spawn_blocking(move || save_store(&updated))
        .await
        .map_err(|e| format!("task join: {e}"))??;

    Ok(ProxyRuntimeStatusDto {
        running: false,
        host: String::new(),
        port: 0,
        message: "Proxy stopped.".to_string(),
    })
}
