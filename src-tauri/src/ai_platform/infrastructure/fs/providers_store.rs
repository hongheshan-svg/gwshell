use crate::ai_platform::domain::provider::{
    ActiveProviderSet, ClaudeModels, CodexModels, GeminiModels, OpenClawModels, OpenCodeModels,
    ProviderApps, ProviderModels, ProviderRecord,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStore {
    #[serde(default)]
    pub providers: Vec<ProviderRecord>,
    #[serde(default)]
    pub active: ActiveProviderSet,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct LegacyProviderStore {
    #[serde(default)]
    providers: Vec<ProviderRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    active_claude: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    active_codex: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    active_gemini: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    active_opencode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    active_openclaw: Option<String>,
}

pub fn apply_provider_to_app(provider: &ProviderRecord, app: &str) -> Result<(), String> {
    match app {
        "claude" => apply_claude_config(provider),
        "codex" => apply_codex_config(provider),
        "gemini" => apply_gemini_config(provider),
        "opencode" => apply_opencode_config(provider),
        "openclaw" => apply_openclaw_config(provider),
        _ => Err(format!("Unsupported provider target: {app}")),
    }
}

pub fn read_legacy_store() -> Result<Option<ProviderStore>, String> {
    let Some(path) = legacy_store_path() else {
        return Ok(None);
    };

    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Read legacy provider store failed: {error}"))?;
    let legacy = serde_json::from_str::<LegacyProviderStore>(&content)
        .map_err(|error| format!("Parse legacy provider store failed: {error}"))?;
    Ok(Some(ProviderStore {
        providers: legacy.providers,
        active: ActiveProviderSet {
            claude: legacy.active_claude,
            codex: legacy.active_codex,
            gemini: legacy.active_gemini,
            opencode: legacy.active_opencode,
            openclaw: legacy.active_openclaw,
        },
    }))
}

fn legacy_store_path() -> Option<PathBuf> {
    dirs::data_local_dir().map(|dir| dir.join("gwshell").join("ai_providers.json"))
}

fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

fn atomic_write_text(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("Create config directory failed: {error}"))?;
    }
    let temp = path.with_extension("tmp");
    fs::write(&temp, content).map_err(|error| format!("Write temp config failed: {error}"))?;
    #[cfg(windows)]
    {
        let _ = fs::remove_file(path);
    }
    fs::rename(&temp, path).map_err(|error| format!("Finalize config write failed: {error}"))?;
    Ok(())
}

fn now_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

pub fn starter_store() -> ProviderStore {
    let now = now_timestamp();
    ProviderStore {
        providers: vec![
            ProviderRecord {
                id: "starter-claude-direct".to_string(),
                name: "Claude Direct".to_string(),
                provider_type: "anthropic".to_string(),
                base_url: "https://api.anthropic.com".to_string(),
                api_key: "".to_string(),
                apps: ProviderApps {
                    claude: true,
                    ..ProviderApps::default()
                },
                models: ProviderModels {
                    claude: Some(ClaudeModels {
                        model: Some("claude-sonnet-4-20250514".to_string()),
                        sonnet_model: Some("claude-sonnet-4-20250514".to_string()),
                        haiku_model: Some("claude-3-5-haiku-latest".to_string()),
                        opus_model: Some("claude-opus-4-20250514".to_string()),
                    }),
                    ..ProviderModels::default()
                },
                enabled: true,
                website_url: Some("https://www.anthropic.com".to_string()),
                notes: Some("Starter preset for direct Claude Code bridging.".to_string()),
                icon: None,
                icon_color: None,
                created_at: Some(now),
                updated_at: Some(now),
                failover_priority: Some(10),
            },
            ProviderRecord {
                id: "starter-openai-shared".to_string(),
                name: "OpenAI Shared".to_string(),
                provider_type: "openai-compatible".to_string(),
                base_url: "https://api.openai.com/v1".to_string(),
                api_key: "".to_string(),
                apps: ProviderApps {
                    codex: true,
                    opencode: true,
                    openclaw: true,
                    ..ProviderApps::default()
                },
                models: ProviderModels {
                    codex: Some(CodexModels {
                        model: Some("gpt-4.1".to_string()),
                        reasoning_effort: Some("high".to_string()),
                    }),
                    opencode: Some(OpenCodeModels {
                        model: Some("gpt-4.1".to_string()),
                    }),
                    openclaw: Some(OpenClawModels {
                        model: Some("gpt-4.1".to_string()),
                    }),
                    ..ProviderModels::default()
                },
                enabled: true,
                website_url: Some("https://platform.openai.com".to_string()),
                notes: Some("Starter preset for Codex, OpenCode, and OpenClaw.".to_string()),
                icon: None,
                icon_color: None,
                created_at: Some(now),
                updated_at: Some(now),
                failover_priority: Some(20),
            },
            ProviderRecord {
                id: "starter-gemini-direct".to_string(),
                name: "Gemini Direct".to_string(),
                provider_type: "google".to_string(),
                base_url: "https://generativelanguage.googleapis.com".to_string(),
                api_key: "".to_string(),
                apps: ProviderApps {
                    gemini: true,
                    ..ProviderApps::default()
                },
                models: ProviderModels {
                    gemini: Some(GeminiModels {
                        model: Some("gemini-2.5-pro".to_string()),
                    }),
                    ..ProviderModels::default()
                },
                enabled: true,
                website_url: Some("https://ai.google.dev".to_string()),
                notes: Some("Starter preset for Gemini CLI bridging.".to_string()),
                icon: None,
                icon_color: None,
                created_at: Some(now),
                updated_at: Some(now),
                failover_priority: Some(30),
            },
        ],
        active: ActiveProviderSet {
            claude: Some("starter-claude-direct".to_string()),
            codex: Some("starter-openai-shared".to_string()),
            gemini: Some("starter-gemini-direct".to_string()),
            opencode: Some("starter-openai-shared".to_string()),
            openclaw: Some("starter-openai-shared".to_string()),
        },
    }
}

fn apply_claude_config(provider: &ProviderRecord) -> Result<(), String> {
    let settings_path = home_dir().join(".claude").join("settings.json");
    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path)
            .map_err(|error| format!("Read Claude settings failed: {error}"))?;
        serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    let model = provider
        .models
        .claude
        .as_ref()
        .and_then(|models| models.model.clone())
        .unwrap_or_else(|| "claude-sonnet-4-20250514".to_string());
    let haiku = provider
        .models
        .claude
        .as_ref()
        .and_then(|models| models.haiku_model.clone())
        .unwrap_or_else(|| model.clone());
    let sonnet = provider
        .models
        .claude
        .as_ref()
        .and_then(|models| models.sonnet_model.clone())
        .unwrap_or_else(|| model.clone());
    let opus = provider
        .models
        .claude
        .as_ref()
        .and_then(|models| models.opus_model.clone())
        .unwrap_or_else(|| model.clone());

    settings["env"] = serde_json::json!({
        "ANTHROPIC_BASE_URL": provider.base_url,
        "ANTHROPIC_AUTH_TOKEN": provider.api_key,
        "ANTHROPIC_MODEL": model,
        "ANTHROPIC_DEFAULT_HAIKU_MODEL": haiku,
        "ANTHROPIC_DEFAULT_SONNET_MODEL": sonnet,
        "ANTHROPIC_DEFAULT_OPUS_MODEL": opus,
    });

    let json = serde_json::to_string_pretty(&settings)
        .map_err(|error| format!("Serialize Claude settings failed: {error}"))?;
    atomic_write_text(&settings_path, &json)
}

fn apply_codex_config(provider: &ProviderRecord) -> Result<(), String> {
    let config_path = home_dir().join(".codex").join("config.toml");
    let model = provider
        .models
        .codex
        .as_ref()
        .and_then(|models| models.model.clone())
        .unwrap_or_else(|| "gpt-4.1".to_string());
    let effort = provider
        .models
        .codex
        .as_ref()
        .and_then(|models| models.reasoning_effort.clone())
        .unwrap_or_else(|| "high".to_string());

    let base_url = provider.base_url.trim_end_matches('/');
    let config = format!(
        "model = \"{model}\"\nmodel_reasoning_effort = \"{effort}\"\n\n[model_providers.default]\nname = \"{name}\"\nbase_url = \"{base_url}\"\napi_key = \"{api_key}\"\nwire_api = \"responses\"\n",
        name = provider.name,
        api_key = provider.api_key,
    );
    atomic_write_text(&config_path, &config)
}

fn apply_gemini_config(provider: &ProviderRecord) -> Result<(), String> {
    let settings_path = home_dir().join(".gemini").join("settings.json");
    let model = provider
        .models
        .gemini
        .as_ref()
        .and_then(|models| models.model.clone())
        .unwrap_or_else(|| "gemini-2.5-pro".to_string());
    let config = serde_json::json!({
        "env": {
            "GEMINI_API_KEY": provider.api_key,
            "GOOGLE_GEMINI_BASE_URL": provider.base_url,
            "GEMINI_MODEL": model,
        }
    });
    let json = serde_json::to_string_pretty(&config)
        .map_err(|error| format!("Serialize Gemini settings failed: {error}"))?;
    atomic_write_text(&settings_path, &json)
}

fn apply_opencode_config(provider: &ProviderRecord) -> Result<(), String> {
    let config_path = home_dir().join(".opencode").join("config.json");
    let model = provider
        .models
        .opencode
        .as_ref()
        .and_then(|models| models.model.clone())
        .unwrap_or_else(|| "gpt-4.1".to_string());
    let config = serde_json::json!({
        "provider": "openai-compatible",
        "providers": {
            "openai-compatible": {
                "apiKey": provider.api_key,
                "model": model,
                "baseURL": provider.base_url,
            }
        }
    });
    let json = serde_json::to_string_pretty(&config)
        .map_err(|error| format!("Serialize OpenCode config failed: {error}"))?;
    atomic_write_text(&config_path, &json)
}

fn apply_openclaw_config(provider: &ProviderRecord) -> Result<(), String> {
    let config_path = home_dir().join(".openclaw").join("config.json");
    let model = provider
        .models
        .openclaw
        .as_ref()
        .and_then(|models| models.model.clone())
        .unwrap_or_else(|| "gpt-4.1".to_string());
    let config = serde_json::json!({
        "apiProvider": "custom",
        "customApiUrl": provider.base_url,
        "customApiKey": provider.api_key,
        "customModel": model,
    });
    let json = serde_json::to_string_pretty(&config)
        .map_err(|error| format!("Serialize OpenClaw config failed: {error}"))?;
    atomic_write_text(&config_path, &json)
}