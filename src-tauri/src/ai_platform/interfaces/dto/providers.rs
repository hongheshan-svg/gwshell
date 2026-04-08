use crate::ai_platform::domain::provider::{ActiveProviderSet, ProviderRecord};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSnapshotDto {
    pub providers: Vec<ProviderRecord>,
    pub active: ActiveProviderSet,
    pub source: String,
    pub health_checks: Vec<ProviderHealthDto>,
    pub switch_history: Vec<ProviderSwitchHistoryDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderHealthDto {
    pub provider_id: String,
    pub status: String,
    pub latency_ms: Option<u64>,
    pub http_status: Option<u16>,
    pub check_mode: String,
    pub target: String,
    pub message: String,
    pub checked_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSwitchHistoryDto {
    pub provider_id: String,
    pub provider_name: String,
    pub app: String,
    pub switched_at: i64,
}