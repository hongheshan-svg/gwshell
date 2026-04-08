use crate::ai_platform::domain::mcp::McpServerRecord;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerValidationDto {
    pub server_id: String,
    pub status: String,
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpAppSyncStatusDto {
    pub app: String,
    pub status: String,
    pub config_path: String,
    pub exists: bool,
    pub targeted_servers: usize,
    pub synced_servers: usize,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpSnapshotDto {
    pub servers: Vec<McpServerRecord>,
    pub templates: Vec<McpServerRecord>,
    pub source: String,
    pub validations: Vec<McpServerValidationDto>,
    pub sync_statuses: Vec<McpAppSyncStatusDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpSyncResultDto {
    pub status: String,
    pub message: String,
    pub synced_apps: Vec<String>,
    pub app_results: Vec<McpAppSyncStatusDto>,
}