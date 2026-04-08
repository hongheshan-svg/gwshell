use crate::ai_platform::application::workspace::service;
use crate::ai_platform::interfaces::dto::workspace::WorkspaceSnapshotDto;

#[tauri::command]
pub async fn ai_platform_get_workspace_snapshot(
    workspace_root: String,
) -> Result<WorkspaceSnapshotDto, String> {
    tokio::task::spawn_blocking(move || service::get_workspace_snapshot(workspace_root))
        .await
        .map_err(|error| format!("task join: {error}"))?
}

#[tauri::command]
pub async fn ai_platform_write_workspace_file(file_path: String, content: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || service::write_workspace_file(file_path, content))
        .await
        .map_err(|error| format!("task join: {error}"))?
}

#[tauri::command]
pub async fn ai_platform_create_daily_memory(
    workspace_root: String,
) -> Result<WorkspaceSnapshotDto, String> {
    tokio::task::spawn_blocking(move || service::create_daily_memory(workspace_root))
        .await
        .map_err(|error| format!("task join: {error}"))?
}

#[tauri::command]
pub async fn ai_platform_delete_workspace_file(
    workspace_root: String,
    file_path: String,
) -> Result<WorkspaceSnapshotDto, String> {
    tokio::task::spawn_blocking(move || service::delete_workspace_file(workspace_root, file_path))
        .await
        .map_err(|error| format!("task join: {error}"))?
}