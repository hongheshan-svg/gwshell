use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectorySettingsRecord {
    pub default_workspace_root: String,
    pub claude_config_dir: String,
    pub codex_config_dir: String,
    pub gemini_config_dir: String,
    pub opencode_config_dir: String,
    pub openclaw_config_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSettingsRecord {
    pub theme: String,
    pub language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSettingsRecord {
    pub enabled: bool,
    pub interval_hours: u32,
    pub retention_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebDavSettingsRecord {
    pub enabled: bool,
    pub base_url: String,
    pub username: String,
    pub password: String,
    pub remote_path: String,
    pub auto_sync: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboundProxySettingsRecord {
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiPlatformSettingsRecord {
    pub directories: DirectorySettingsRecord,
    pub appearance: AppearanceSettingsRecord,
    pub backup: BackupSettingsRecord,
    pub webdav: WebDavSettingsRecord,
    pub outbound_proxy: OutboundProxySettingsRecord,
}

impl Default for AiPlatformSettingsRecord {
    fn default() -> Self {
        Self {
            directories: DirectorySettingsRecord {
                default_workspace_root: String::new(),
                claude_config_dir: String::new(),
                codex_config_dir: String::new(),
                gemini_config_dir: String::new(),
                opencode_config_dir: String::new(),
                openclaw_config_dir: String::new(),
            },
            appearance: AppearanceSettingsRecord {
                theme: "dark".to_string(),
                language: "zh".to_string(),
            },
            backup: BackupSettingsRecord {
                enabled: true,
                interval_hours: 24,
                retention_count: 14,
            },
            webdav: WebDavSettingsRecord {
                enabled: false,
                base_url: String::new(),
                username: String::new(),
                password: String::new(),
                remote_path: "/gwshell/ai-platform".to_string(),
                auto_sync: false,
            },
            outbound_proxy: OutboundProxySettingsRecord { url: String::new() },
        }
    }
}