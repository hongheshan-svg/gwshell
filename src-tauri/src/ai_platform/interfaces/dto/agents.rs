use crate::ai_platform::domain::agent::{AgentAssignmentRecord, AgentCategoryRecord};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProviderOptionDto {
    pub provider_id: String,
    pub provider_name: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSnapshotItemDto {
    pub key: String,
    pub name: String,
    pub category: String,
    pub description: String,
    pub enabled: bool,
    pub assignment: AgentAssignmentRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentsSnapshotDto {
    pub categories: Vec<AgentCategoryRecord>,
    pub agents: Vec<AgentSnapshotItemDto>,
    pub provider_options: Vec<AgentProviderOptionDto>,
    pub routing_mode: String,
    pub source: String,
}