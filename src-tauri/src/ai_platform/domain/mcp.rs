use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpSyncApps {
	#[serde(default)]
	pub claude: bool,
	#[serde(default)]
	pub codex: bool,
	#[serde(default)]
	pub gemini: bool,
	#[serde(default)]
	pub opencode: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerRecord {
	pub id: String,
	pub name: String,
	pub command: String,
	#[serde(default)]
	pub args: Vec<String>,
	#[serde(default)]
	pub env: HashMap<String, String>,
	#[serde(default)]
	pub sync_apps: McpSyncApps,
	#[serde(default = "default_enabled")]
	pub enabled: bool,
}

fn default_enabled() -> bool {
	true
}