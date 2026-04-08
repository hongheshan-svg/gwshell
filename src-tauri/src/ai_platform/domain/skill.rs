use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillRootRecord {
    pub id: String,
    pub path: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillRecord {
    pub id: String,
    pub root_id: String,
    pub name: String,
    pub description: String,
    pub path: String,
    pub skill_file: String,
    pub enabled: bool,
}