use crate::ai_platform::domain::openclaw::{
    OpenClawEditableConfigRecord, OpenClawProviderOptionRecord,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawHealthItemDto {
    pub id: String,
    pub level: String,
    pub title: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawSnapshotDto {
    pub config_path: String,
    pub exists: bool,
    pub parse_error: Option<String>,
    pub config: OpenClawEditableConfigRecord,
    pub provider_options: Vec<OpenClawProviderOptionRecord>,
    pub bridge_summary: String,
    pub health: Vec<OpenClawHealthItemDto>,
    pub source: String,
}