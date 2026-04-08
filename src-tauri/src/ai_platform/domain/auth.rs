use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthConnectionRecord {
    pub app: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_provider_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_provider_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_type: Option<String>,
    pub provider_enabled: bool,
    pub local_config_targets: Vec<String>,
    pub local_config_present: bool,
    pub provider_token_present: bool,
    pub local_token_present: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub status: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatusItemRecord {
    pub id: String,
    pub level: String,
    pub title: String,
    pub detail: String,
}