use crate::ai_platform::domain::sessions::{SessionAssetRecord, SessionGroupRecord};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionsSnapshotDto {
    pub sessions: Vec<SessionAssetRecord>,
    pub groups: Vec<SessionGroupRecord>,
    pub deeplink_template: String,
    pub source: String,
}