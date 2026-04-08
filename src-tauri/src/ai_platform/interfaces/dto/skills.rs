use crate::ai_platform::domain::skill::{SkillRecord, SkillRootRecord};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillsSnapshotDto {
    pub roots: Vec<SkillRootRecord>,
    pub skills: Vec<SkillRecord>,
    pub source: String,
}