use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProviderApps {
	#[serde(default)]
	pub claude: bool,
	#[serde(default)]
	pub codex: bool,
	#[serde(default)]
	pub gemini: bool,
	#[serde(default)]
	pub opencode: bool,
	#[serde(default)]
	pub openclaw: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeModels {
	#[serde(skip_serializing_if = "Option::is_none")]
	pub model: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub haiku_model: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub sonnet_model: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub opus_model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodexModels {
	#[serde(skip_serializing_if = "Option::is_none")]
	pub model: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub reasoning_effort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GeminiModels {
	#[serde(skip_serializing_if = "Option::is_none")]
	pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeModels {
	#[serde(skip_serializing_if = "Option::is_none")]
	pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawModels {
	#[serde(skip_serializing_if = "Option::is_none")]
	pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModels {
	#[serde(skip_serializing_if = "Option::is_none")]
	pub claude: Option<ClaudeModels>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub codex: Option<CodexModels>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub gemini: Option<GeminiModels>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub opencode: Option<OpenCodeModels>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub openclaw: Option<OpenClawModels>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderRecord {
	pub id: String,
	pub name: String,
	pub provider_type: String,
	#[serde(default)]
	pub base_url: String,
	#[serde(default)]
	pub api_key: String,
	#[serde(default)]
	pub apps: ProviderApps,
	#[serde(default)]
	pub models: ProviderModels,
	#[serde(default = "default_enabled")]
	pub enabled: bool,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub website_url: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub notes: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub icon: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub icon_color: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub created_at: Option<i64>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub updated_at: Option<i64>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub failover_priority: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ActiveProviderSet {
	#[serde(skip_serializing_if = "Option::is_none")]
	pub claude: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub codex: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub gemini: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub opencode: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub openclaw: Option<String>,
}

fn default_enabled() -> bool {
	true
}

impl ProviderRecord {
	pub fn supports_app(&self, app: &str) -> bool {
		match app {
			"claude" => self.apps.claude,
			"codex" => self.apps.codex,
			"gemini" => self.apps.gemini,
			"opencode" => self.apps.opencode,
			"openclaw" => self.apps.openclaw,
			_ => false,
		}
	}
}