use crate::ai_platform::application::prompts::service;
use crate::ai_platform::interfaces::dto::prompts::{PromptSnapshotDto, PromptSyncResultDto};

#[tauri::command]
pub async fn ai_platform_get_prompt_snapshot(project_dir: String) -> Result<PromptSnapshotDto, String> {
    tokio::task::spawn_blocking(move || service::get_prompt_snapshot(project_dir))
        .await
        .map_err(|error| format!("task join: {error}"))?
}

#[tauri::command]
pub async fn ai_platform_write_prompt_file(file_path: String, content: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || service::write_prompt_file(file_path, content))
        .await
        .map_err(|error| format!("task join: {error}"))?
}

#[tauri::command]
pub async fn ai_platform_sync_prompt_files(
    project_dir: String,
    source_tool: String,
    target_tools: Vec<String>,
    content: String,
) -> Result<PromptSyncResultDto, String> {
    tokio::task::spawn_blocking(move || {
        service::sync_prompt_files(project_dir, source_tool, target_tools, content)
    })
    .await
    .map_err(|error| format!("task join: {error}"))?
}