use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawProviderOptionRecord {
    pub provider_id: String,
    pub provider_name: String,
    pub model: String,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawEditableConfigRecord {
    pub env_json: String,
    pub tools_profile: String,
    pub allow_list: Vec<String>,
    pub deny_list: Vec<String>,
    pub primary_model: String,
    pub fallback_models: Vec<String>,
    pub workspace: String,
    pub timeout_seconds: Option<u32>,
    pub context_tokens: Option<u32>,
    pub max_concurrent: Option<u32>,
}

impl Default for OpenClawEditableConfigRecord {
    fn default() -> Self {
        Self {
            env_json: "{}".to_string(),
            tools_profile: String::new(),
            allow_list: Vec::new(),
            deny_list: Vec::new(),
            primary_model: String::new(),
            fallback_models: Vec::new(),
            workspace: String::new(),
            timeout_seconds: Some(90),
            context_tokens: None,
            max_concurrent: Some(2),
        }
    }
}