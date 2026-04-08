use crate::ai_platform::domain::agent::AgentAssignmentRecord;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentsStore {
    #[serde(default)]
    pub disabled_agent_keys: Vec<String>,
    #[serde(default)]
    pub assignments: Vec<AgentAssignmentRecord>,
    #[serde(default = "default_routing_mode")]
    pub routing_mode: String,
}

impl Default for AgentsStore {
    fn default() -> Self {
        Self {
            disabled_agent_keys: Vec::new(),
            assignments: Vec::new(),
            routing_mode: default_routing_mode(),
        }
    }
}

pub fn load_store() -> Result<AgentsStore, String> {
    let path = store_path().ok_or("Cannot determine AI platform data directory")?;
    if !path.exists() {
        return Ok(AgentsStore::default());
    }
    let content = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

pub fn save_store(store: &AgentsStore) -> Result<(), String> {
    let path = store_path().ok_or("Cannot determine AI platform data directory")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let content = serde_json::to_string_pretty(store).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

fn default_routing_mode() -> String {
    "balanced".to_string()
}

fn store_path() -> Option<PathBuf> {
    dirs::data_local_dir().map(|dir| dir.join("gwshell").join("ai-platform").join("agents.json"))
}