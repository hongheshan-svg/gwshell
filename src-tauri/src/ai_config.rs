use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

// ============================================================================
// Data structures - compatible with cc-switch provider format
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiProvider {
    pub id: String,
    pub name: String,
    /// Provider type: "openai" | "anthropic" | "google" | "custom" | preset id
    #[serde(rename = "providerType")]
    pub provider_type: String,
    /// API base URL
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    /// API key (encrypted at rest via frontend, stored as-is in JSON)
    #[serde(rename = "apiKey")]
    pub api_key: String,
    /// Target apps for this provider
    #[serde(default)]
    pub apps: ProviderApps,
    /// Per-app model configuration
    #[serde(default)]
    pub models: ProviderModels,
    /// Optional website URL
    #[serde(skip_serializing_if = "Option::is_none", rename = "websiteUrl")]
    pub website_url: Option<String>,
    /// Optional notes
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// Icon identifier (for frontend matching)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    /// Icon color (hex)
    #[serde(skip_serializing_if = "Option::is_none", rename = "iconColor")]
    pub icon_color: Option<String>,
    /// Is this the currently active provider?
    #[serde(default)]
    pub enabled: bool,
    /// Custom headers
    #[serde(skip_serializing_if = "Option::is_none", rename = "customHeaders")]
    pub custom_headers: Option<HashMap<String, String>>,
    /// Creation timestamp (ms)
    #[serde(skip_serializing_if = "Option::is_none", rename = "createdAt")]
    pub created_at: Option<i64>,
    /// Sort index for display order
    #[serde(skip_serializing_if = "Option::is_none", rename = "sortIndex")]
    pub sort_index: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ClaudeModels {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "haikuModel")]
    pub haiku_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "sonnetModel")]
    pub sonnet_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "opusModel")]
    pub opus_model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CodexModels {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "reasoningEffort")]
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GeminiModels {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OpenCodeModels {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OpenClawModels {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

/// Stored state
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AiProviderStore {
    pub providers: Vec<AiProvider>,
    /// ID of the currently active provider (per app)
    #[serde(rename = "activeClaude", skip_serializing_if = "Option::is_none")]
    pub active_claude: Option<String>,
    #[serde(rename = "activeCodex", skip_serializing_if = "Option::is_none")]
    pub active_codex: Option<String>,
    #[serde(rename = "activeGemini", skip_serializing_if = "Option::is_none")]
    pub active_gemini: Option<String>,
    #[serde(rename = "activeOpencode", skip_serializing_if = "Option::is_none")]
    pub active_opencode: Option<String>,
    #[serde(rename = "activeOpenclaw", skip_serializing_if = "Option::is_none")]
    pub active_openclaw: Option<String>,
}

// ============================================================================
// Persistence
// ============================================================================

fn gwshell_providers_path() -> Option<PathBuf> {
    dirs::data_local_dir().map(|d| d.join("gwshell").join("ai_providers.json"))
}

fn load_store() -> AiProviderStore {
    gwshell_providers_path()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_store(store: &AiProviderStore) -> Result<(), String> {
    let path = gwshell_providers_path().ok_or("Cannot determine data directory")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    // Atomic write: write to temp, then rename
    let tmp = path.with_extension("json.tmp");
    let json =
        serde_json::to_string_pretty(store).map_err(|e| format!("Serialize failed: {}", e))?;
    fs::write(&tmp, &json).map_err(|e| format!("Write failed: {}", e))?;
    #[cfg(windows)]
    {
        let _ = fs::remove_file(&path);
    }
    fs::rename(&tmp, &path).map_err(|e| format!("Rename failed: {}", e))?;
    Ok(())
}

// ============================================================================
// CLI config adapters — write live config files for each AI tool
// ============================================================================

fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

/// Write Claude Code settings (~/.claude/settings.json env block)
fn apply_claude_config(provider: &AiProvider) -> Result<(), String> {
    let models = provider.models.claude.as_ref();
    let model = models
        .and_then(|m| m.model.clone())
        .unwrap_or_else(|| "claude-sonnet-4-20250514".to_string());
    let haiku = models
        .and_then(|m| m.haiku_model.clone())
        .unwrap_or_else(|| model.clone());
    let sonnet = models
        .and_then(|m| m.sonnet_model.clone())
        .unwrap_or_else(|| model.clone());
    let opus = models
        .and_then(|m| m.opus_model.clone())
        .unwrap_or_else(|| model.clone());

    let claude_dir = home_dir().join(".claude");
    fs::create_dir_all(&claude_dir)
        .map_err(|e| format!("Create .claude dir failed: {}", e))?;

    let settings_path = claude_dir.join("settings.json");

    // Read existing settings or create new
    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path)
            .map_err(|e| format!("Read settings.json failed: {}", e))?;
        serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // Merge env block
    let env = serde_json::json!({
        "ANTHROPIC_BASE_URL": provider.base_url,
        "ANTHROPIC_AUTH_TOKEN": provider.api_key,
        "ANTHROPIC_MODEL": model,
        "ANTHROPIC_DEFAULT_HAIKU_MODEL": haiku,
        "ANTHROPIC_DEFAULT_SONNET_MODEL": sonnet,
        "ANTHROPIC_DEFAULT_OPUS_MODEL": opus,
    });

    settings["env"] = env;

    let json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Serialize failed: {}", e))?;
    atomic_write_text(&settings_path, &json)
}

/// Write Codex config (~/.codex/config.toml + auth env)
fn apply_codex_config(provider: &AiProvider) -> Result<(), String> {
    let models = provider.models.codex.as_ref();
    let model = models
        .and_then(|m| m.model.clone())
        .unwrap_or_else(|| "gpt-4o".to_string());
    let reasoning_effort = models
        .and_then(|m| m.reasoning_effort.clone())
        .unwrap_or_else(|| "high".to_string());

    // Normalize base_url: add /v1 if it's just an origin
    let base_trimmed = provider.base_url.trim_end_matches('/');
    let origin_only = match base_trimmed.split_once("://") {
        Some((_scheme, rest)) => !rest.contains('/'),
        None => !base_trimmed.contains('/'),
    };
    let codex_base_url = if base_trimmed.ends_with("/v1") {
        base_trimmed.to_string()
    } else if origin_only {
        format!("{base_trimmed}/v1")
    } else {
        base_trimmed.to_string()
    };

    let codex_dir = home_dir().join(".codex");
    fs::create_dir_all(&codex_dir)
        .map_err(|e| format!("Create .codex dir failed: {}", e))?;

    // Write config.toml
    let config_toml = format!(
        r#"model_provider = "newapi"
model = "{model}"
model_reasoning_effort = "{reasoning_effort}"
disable_response_storage = true

[model_providers.newapi]
name = "NewAPI"
base_url = "{codex_base_url}"
wire_api = "responses"
requires_openai_auth = true"#
    );
    atomic_write_text(&codex_dir.join("config.toml"), &config_toml)?;

    // Write auth.env (OPENAI_API_KEY)
    let auth_content = format!("OPENAI_API_KEY={}\n", provider.api_key);
    atomic_write_text(&codex_dir.join("auth.env"), &auth_content)
}

/// Write Gemini CLI config
fn apply_gemini_config(provider: &AiProvider) -> Result<(), String> {
    let models = provider.models.gemini.as_ref();
    let model = models
        .and_then(|m| m.model.clone())
        .unwrap_or_else(|| "gemini-2.5-pro".to_string());

    let gemini_dir = home_dir().join(".gemini");
    fs::create_dir_all(&gemini_dir)
        .map_err(|e| format!("Create .gemini dir failed: {}", e))?;

    let settings_path = gemini_dir.join("settings.json");

    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path)
            .map_err(|e| format!("Read gemini settings failed: {}", e))?;
        serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    settings["GOOGLE_GEMINI_BASE_URL"] = serde_json::json!(provider.base_url);
    settings["GEMINI_API_KEY"] = serde_json::json!(provider.api_key);
    settings["GEMINI_MODEL"] = serde_json::json!(model);

    let json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Serialize failed: {}", e))?;
    atomic_write_text(&settings_path, &json)
}

/// Write OpenCode config (~/.opencode/config.json)
fn apply_opencode_config(provider: &AiProvider) -> Result<(), String> {
    let models = provider.models.opencode.as_ref();
    let model = models
        .and_then(|m| m.model.clone())
        .unwrap_or_else(|| "gpt-4o".to_string());

    let opencode_dir = home_dir().join(".opencode");
    fs::create_dir_all(&opencode_dir)
        .map_err(|e| format!("Create .opencode dir failed: {}", e))?;

    let config = serde_json::json!({
        "provider": "openai-compatible",
        "providers": {
            "openai-compatible": {
                "apiKey": provider.api_key,
                "model": model,
                "baseURL": provider.base_url
            }
        }
    });

    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Serialize failed: {}", e))?;
    atomic_write_text(&opencode_dir.join("config.json"), &json)
}

/// Write OpenClaw config (~/.openclaw/config.json)
fn apply_openclaw_config(provider: &AiProvider) -> Result<(), String> {
    let models = provider.models.openclaw.as_ref();
    let model = models
        .and_then(|m| m.model.clone())
        .unwrap_or_else(|| "gpt-4o".to_string());

    let openclaw_dir = home_dir().join(".openclaw");
    fs::create_dir_all(&openclaw_dir)
        .map_err(|e| format!("Create .openclaw dir failed: {}", e))?;

    let config = serde_json::json!({
        "apiProvider": "custom",
        "customApiUrl": provider.base_url,
        "customApiKey": provider.api_key,
        "customModel": model
    });

    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Serialize failed: {}", e))?;
    atomic_write_text(&openclaw_dir.join("config.json"), &json)
}

/// Atomic write helper
fn atomic_write_text(path: &Path, content: &str) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, content).map_err(|e| format!("Write tmp failed: {}", e))?;
    #[cfg(windows)]
    {
        let _ = fs::remove_file(path);
    }
    fs::rename(&tmp, path).map_err(|e| format!("Rename failed: {}", e))?;
    Ok(())
}

// ============================================================================
// Tauri commands
// ============================================================================

#[tauri::command]
pub fn list_ai_providers() -> Result<Vec<AiProvider>, String> {
    let store = load_store();
    Ok(store.providers)
}

#[tauri::command]
pub fn get_ai_active_ids() -> Result<(Option<String>, Option<String>, Option<String>, Option<String>, Option<String>), String> {
    let store = load_store();
    Ok((store.active_claude, store.active_codex, store.active_gemini, store.active_opencode, store.active_openclaw))
}

#[tauri::command]
pub fn save_ai_provider(provider: AiProvider) -> Result<(), String> {
    let mut store = load_store();
    if let Some(existing) = store.providers.iter_mut().find(|p| p.id == provider.id) {
        *existing = provider;
    } else {
        store.providers.push(provider);
    }
    save_store(&store)
}

#[tauri::command]
pub fn delete_ai_provider(provider_id: String) -> Result<(), String> {
    let mut store = load_store();
    store.providers.retain(|p| p.id != provider_id);
    // Clear active references if they point to the deleted provider
    if store.active_claude.as_deref() == Some(&provider_id) {
        store.active_claude = None;
    }
    if store.active_codex.as_deref() == Some(&provider_id) {
        store.active_codex = None;
    }
    if store.active_gemini.as_deref() == Some(&provider_id) {
        store.active_gemini = None;
    }
    if store.active_opencode.as_deref() == Some(&provider_id) {
        store.active_opencode = None;
    }
    if store.active_openclaw.as_deref() == Some(&provider_id) {
        store.active_openclaw = None;
    }
    save_store(&store)
}

/// Switch active provider for a specific CLI tool and write live config
#[tauri::command]
pub fn switch_ai_provider(provider_id: String, tool: String) -> Result<(), String> {
    let mut store = load_store();

    let provider = store
        .providers
        .iter()
        .find(|p| p.id == provider_id)
        .cloned()
        .ok_or_else(|| format!("Provider '{}' not found", provider_id))?;

    match tool.as_str() {
        "claude" => {
            if !provider.apps.claude {
                return Err("Provider is not enabled for Claude Code".to_string());
            }
            apply_claude_config(&provider)?;
            store.active_claude = Some(provider_id);
        }
        "codex" => {
            if !provider.apps.codex {
                return Err("Provider is not enabled for Codex".to_string());
            }
            apply_codex_config(&provider)?;
            store.active_codex = Some(provider_id);
        }
        "gemini" => {
            if !provider.apps.gemini {
                return Err("Provider is not enabled for Gemini CLI".to_string());
            }
            apply_gemini_config(&provider)?;
            store.active_gemini = Some(provider_id);
        }
        "opencode" => {
            if !provider.apps.opencode {
                return Err("Provider is not enabled for OpenCode".to_string());
            }
            apply_opencode_config(&provider)?;
            store.active_opencode = Some(provider_id);
        }
        "openclaw" => {
            if !provider.apps.openclaw {
                return Err("Provider is not enabled for OpenClaw".to_string());
            }
            apply_openclaw_config(&provider)?;
            store.active_openclaw = Some(provider_id);
        }
        "all" => {
            if provider.apps.claude {
                apply_claude_config(&provider)?;
                store.active_claude = Some(provider.id.clone());
            }
            if provider.apps.codex {
                apply_codex_config(&provider)?;
                store.active_codex = Some(provider.id.clone());
            }
            if provider.apps.gemini {
                apply_gemini_config(&provider)?;
                store.active_gemini = Some(provider.id.clone());
            }
            if provider.apps.opencode {
                apply_opencode_config(&provider)?;
                store.active_opencode = Some(provider.id.clone());
            }
            if provider.apps.openclaw {
                apply_openclaw_config(&provider)?;
                store.active_openclaw = Some(provider.id.clone());
            }
        }
        _ => return Err(format!("Unknown tool: {}", tool)),
    }

    save_store(&store)
}

/// Import providers from cc-switch's config.json (if installed)
#[tauri::command]
pub fn import_from_cc_switch() -> Result<Vec<AiProvider>, String> {
    let cc_config_dir = home_dir().join(".cc-switch");
    let config_path = cc_config_dir.join("config.json");

    if !config_path.exists() {
        return Err("cc-switch is not installed or config not found".to_string());
    }

    let content =
        fs::read_to_string(&config_path).map_err(|e| format!("Read cc-switch config: {}", e))?;
    let config: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Parse cc-switch config: {}", e))?;

    let mut imported = Vec::new();

    // Parse cc-switch provider format
    if let Some(providers) = config.get("providers").and_then(|v| v.as_object()) {
        for (id, pval) in providers {
            if let Ok(provider) = parse_cc_switch_provider(id, pval) {
                imported.push(provider);
            }
        }
    }

    // Also check universalProviders
    if let Some(universal) = config.get("universalProviders").and_then(|v| v.as_object()) {
        for (id, uval) in universal {
            if let Ok(provider) = parse_cc_switch_universal(id, uval) {
                imported.push(provider);
            }
        }
    }

    Ok(imported)
}

fn parse_cc_switch_provider(id: &str, val: &serde_json::Value) -> Result<AiProvider, String> {
    let name = val
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or(id)
        .to_string();

    let settings = val.get("settingsConfig").unwrap_or(val);

    let base_url = settings
        .pointer("/env/ANTHROPIC_BASE_URL")
        .or_else(|| settings.pointer("/env/GOOGLE_GEMINI_BASE_URL"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let api_key = settings
        .pointer("/env/ANTHROPIC_AUTH_TOKEN")
        .or_else(|| settings.pointer("/env/ANTHROPIC_API_KEY"))
        .or_else(|| settings.pointer("/auth/OPENAI_API_KEY"))
        .or_else(|| settings.pointer("/env/GEMINI_API_KEY"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    Ok(AiProvider {
        id: format!("cc-{}", id),
        name,
        provider_type: "imported".to_string(),
        base_url,
        api_key,
        apps: ProviderApps {
            claude: settings.pointer("/env/ANTHROPIC_BASE_URL").is_some(),
            codex: settings.pointer("/auth/OPENAI_API_KEY").is_some(),
            gemini: settings.pointer("/env/GEMINI_API_KEY").is_some(),
            opencode: settings.pointer("/env/OPENCODE_API_KEY").is_some(),
            openclaw: settings.pointer("/env/OPENCLAW_API_KEY").is_some(),
        },
        models: ProviderModels::default(),
        website_url: val.get("websiteUrl").and_then(|v| v.as_str()).map(String::from),
        notes: val.get("notes").and_then(|v| v.as_str()).map(String::from),
        icon: val.get("icon").and_then(|v| v.as_str()).map(String::from),
        icon_color: val
            .get("iconColor")
            .and_then(|v| v.as_str())
            .map(String::from),
        enabled: false,
        custom_headers: None,
        created_at: val.get("createdAt").and_then(|v| v.as_i64()),
        sort_index: val.get("sortIndex").and_then(|v| v.as_u64()).map(|v| v as usize),
    })
}

fn parse_cc_switch_universal(id: &str, val: &serde_json::Value) -> Result<AiProvider, String> {
    let name = val
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or(id)
        .to_string();

    let base_url = val
        .get("baseUrl")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let api_key = val
        .get("apiKey")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let apps_val = val.get("apps");
    let apps = ProviderApps {
        claude: apps_val
            .and_then(|a| a.get("claude"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        codex: apps_val
            .and_then(|a| a.get("codex"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        gemini: apps_val
            .and_then(|a| a.get("gemini"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        opencode: apps_val
            .and_then(|a| a.get("opencode"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        openclaw: apps_val
            .and_then(|a| a.get("openclaw"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
    };

    Ok(AiProvider {
        id: format!("cc-universal-{}", id),
        name,
        provider_type: val
            .get("providerType")
            .and_then(|v| v.as_str())
            .unwrap_or("custom")
            .to_string(),
        base_url,
        api_key,
        apps,
        models: ProviderModels::default(),
        website_url: val.get("websiteUrl").and_then(|v| v.as_str()).map(String::from),
        notes: val.get("notes").and_then(|v| v.as_str()).map(String::from),
        icon: val.get("icon").and_then(|v| v.as_str()).map(String::from),
        icon_color: val
            .get("iconColor")
            .and_then(|v| v.as_str())
            .map(String::from),
        enabled: false,
        custom_headers: None,
        created_at: val.get("createdAt").and_then(|v| v.as_i64()),
        sort_index: val.get("sortIndex").and_then(|v| v.as_u64()).map(|v| v as usize),
    })
}
