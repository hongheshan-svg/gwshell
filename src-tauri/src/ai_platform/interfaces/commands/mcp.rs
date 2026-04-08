use crate::ai_platform::application::mcp::service;
use crate::ai_platform::domain::mcp::McpServerRecord;
use crate::ai_platform::interfaces::dto::mcp::{McpSnapshotDto, McpSyncResultDto};

#[tauri::command]
pub async fn ai_platform_get_mcp_snapshot() -> Result<McpSnapshotDto, String> {
    tokio::task::spawn_blocking(service::get_mcp_snapshot)
        .await
        .map_err(|error| format!("task join: {error}"))?
}

#[tauri::command]
pub async fn ai_platform_save_mcp_server(server: McpServerRecord) -> Result<McpSnapshotDto, String> {
    tokio::task::spawn_blocking(move || service::save_mcp_server(server))
        .await
        .map_err(|error| format!("task join: {error}"))?
}

#[tauri::command]
pub async fn ai_platform_delete_mcp_server(server_id: String) -> Result<McpSnapshotDto, String> {
    tokio::task::spawn_blocking(move || service::delete_mcp_server(server_id))
        .await
        .map_err(|error| format!("task join: {error}"))?
}

#[tauri::command]
pub async fn ai_platform_sync_mcp_servers() -> Result<McpSyncResultDto, String> {
    tokio::task::spawn_blocking(service::sync_mcp_servers)
        .await
        .map_err(|error| format!("task join: {error}"))?
}