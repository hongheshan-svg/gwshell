use crate::ai_platform::domain::proxy::ProxyControlPlaneRecord;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyQueueItemDto {
    pub app: String,
    pub provider_id: String,
    pub provider_name: String,
    pub provider_type: String,
    pub priority: i32,
    pub is_active: bool,
    pub requires_proxy: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyAppStatusDto {
    pub app: String,
    pub running: bool,
    pub takeover_enabled: bool,
    pub failover_enabled: bool,
    pub queue_depth: u32,
    pub active_provider_id: Option<String>,
    pub requires_proxy: bool,
    pub status: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxySnapshotDto {
    pub config: ProxyControlPlaneRecord,
    pub app_statuses: Vec<ProxyAppStatusDto>,
    pub queue: Vec<ProxyQueueItemDto>,
    pub source: String,
}