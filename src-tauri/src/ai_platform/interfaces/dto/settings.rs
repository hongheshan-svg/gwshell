use crate::ai_platform::domain::settings::AiPlatformSettingsRecord;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsStatusItemDto {
    pub id: String,
    pub label: String,
    pub level: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSnapshotDto {
    pub settings: AiPlatformSettingsRecord,
    pub statuses: Vec<SettingsStatusItemDto>,
    pub source: String,
}