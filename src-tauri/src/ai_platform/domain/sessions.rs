use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionAssetRecord {
    pub id: String,
    pub name: String,
    pub session_type: String,
    pub group: Option<String>,
    pub target: String,
    pub project_dir: Option<String>,
    pub summary: String,
    pub resume_command: Option<String>,
    pub created_at: Option<String>,
    pub expired_at: Option<String>,
    pub proxy_enabled: bool,
    pub tunnel_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionGroupRecord {
    pub name: String,
    pub count: usize,
}