use crate::ai_platform::application::skills::service;
use crate::ai_platform::interfaces::dto::skills::SkillsSnapshotDto;

#[tauri::command]
pub async fn ai_platform_get_skills_snapshot() -> Result<SkillsSnapshotDto, String> {
    tokio::task::spawn_blocking(service::get_skills_snapshot)
        .await
        .map_err(|error| format!("task join: {error}"))?
}

#[tauri::command]
pub async fn ai_platform_add_skill_root(path: String) -> Result<SkillsSnapshotDto, String> {
    tokio::task::spawn_blocking(move || service::add_skill_root(path))
        .await
        .map_err(|error| format!("task join: {error}"))?
}

#[tauri::command]
pub async fn ai_platform_remove_skill_root(root_id: String) -> Result<SkillsSnapshotDto, String> {
    tokio::task::spawn_blocking(move || service::remove_skill_root(root_id))
        .await
        .map_err(|error| format!("task join: {error}"))?
}

#[tauri::command]
pub async fn ai_platform_set_skill_enabled(
    skill_id: String,
    enabled: bool,
) -> Result<SkillsSnapshotDto, String> {
    tokio::task::spawn_blocking(move || service::set_skill_enabled(skill_id, enabled))
        .await
        .map_err(|error| format!("task join: {error}"))?
}