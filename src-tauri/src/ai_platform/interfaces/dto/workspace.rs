use crate::ai_platform::domain::workspace::WorkspaceFileRecord;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshotDto {
    pub workspace_root: String,
    pub files: Vec<WorkspaceFileRecord>,
    pub daily_memory_dir: String,
}