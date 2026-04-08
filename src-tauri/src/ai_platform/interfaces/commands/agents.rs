use crate::ai_platform::application::agents::service;
use crate::ai_platform::domain::agent::AgentAssignmentRecord;
use crate::ai_platform::interfaces::dto::agents::AgentsSnapshotDto;

#[tauri::command]
pub async fn ai_platform_get_agents_snapshot() -> Result<AgentsSnapshotDto, String> {
    tokio::task::spawn_blocking(service::get_agents_snapshot)
        .await
        .map_err(|error| format!("task join: {error}"))?
}

#[tauri::command]
pub async fn ai_platform_set_agent_enabled(
    agent_key: String,
    enabled: bool,
) -> Result<AgentsSnapshotDto, String> {
    tokio::task::spawn_blocking(move || service::set_agent_enabled(agent_key, enabled))
        .await
        .map_err(|error| format!("task join: {error}"))?
}

#[tauri::command]
pub async fn ai_platform_save_agent_assignment(
    assignment: AgentAssignmentRecord,
) -> Result<AgentsSnapshotDto, String> {
    tokio::task::spawn_blocking(move || service::save_agent_assignment(assignment))
        .await
        .map_err(|error| format!("task join: {error}"))?
}

#[tauri::command]
pub async fn ai_platform_set_agents_routing_mode(
    routing_mode: String,
) -> Result<AgentsSnapshotDto, String> {
    tokio::task::spawn_blocking(move || service::set_routing_mode(routing_mode))
        .await
        .map_err(|error| format!("task join: {error}"))?
}