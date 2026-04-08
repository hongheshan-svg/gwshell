use crate::ai_platform::domain::prompt::{PromptFileRecord, PromptTemplateRecord};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptSnapshotDto {
    pub project_dir: String,
    pub files: Vec<PromptFileRecord>,
    pub templates: Vec<PromptTemplateRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptSyncResultDto {
    pub source_tool: String,
    pub synced_tools: Vec<String>,
    pub synced_files: Vec<String>,
    pub message: String,
}