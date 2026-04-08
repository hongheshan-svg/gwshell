use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileRecord {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub path: String,
    pub exists: bool,
    pub content: String,
}