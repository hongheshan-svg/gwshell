use crate::ai_platform::domain::auth::{AuthConnectionRecord, AuthStatusItemRecord};
use crate::ai_platform::interfaces::dto::providers::ProviderSwitchHistoryDto;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthSnapshotDto {
    pub connections: Vec<AuthConnectionRecord>,
    pub statuses: Vec<AuthStatusItemRecord>,
    pub switch_history: Vec<ProviderSwitchHistoryDto>,
    pub source: String,
}