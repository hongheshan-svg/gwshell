use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

// ============================================================================
// Data structures - CC Switch compatible provider format
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiProvider {
    pub id: String,
    pub name: String,
    #[serde(rename = "providerType")]
    pub provider_type: String,
    #[serde(rename = "baseUrl", default)]
    pub base_url: String,
    #[serde(rename = "apiKey", default)]
    pub api_key: String,
    #[serde(default)]
    pub apps: ProviderApps,
    #[serde(default)]
    pub models: ProviderModels,
    /// CC Switch native settingsConfig (written directly to config files)
    #[serde(skip_serializing_if = "Option::is_none", rename = "settingsConfig")]
    pub settings_config: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "websiteUrl")]
    pub website_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "iconColor")]
    pub icon_color: Option<String>,
    #[serde(default)]
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none", rename = "isPartner")]
    pub is_partner: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "customHeaders")]
    pub custom_headers: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "createdAt")]
    pub created_at: Option<i64>,
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AiProviderStore {
    pub providers: Vec<AiProvider>,
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
// CLI config adapters
// ============================================================================

fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

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

/// Write Claude Code settings (~/.claude/settings.json)
fn apply_claude_config(provider: &AiProvider) -> Result<(), String> {
    let claude_dir = home_dir().join(".claude");
    fs::create_dir_all(&claude_dir)
        .map_err(|e| format!("Create .claude dir failed: {}", e))?;
    let settings_path = claude_dir.join("settings.json");

    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path)
            .map_err(|e| format!("Read settings.json failed: {}", e))?;
        serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    if let Some(sc) = &provider.settings_config {
        if let Some(env) = sc.get("env") {
            settings["env"] = env.clone();
            let json = serde_json::to_string_pretty(&settings)
                .map_err(|e| format!("Serialize failed: {}", e))?;
            return atomic_write_text(&settings_path, &json);
        }
    }

    let models = provider.models.claude.as_ref();
    let model = models.and_then(|m| m.model.clone()).unwrap_or_else(|| "claude-sonnet-4-20250514".to_string());
    let haiku = models.and_then(|m| m.haiku_model.clone()).unwrap_or_else(|| model.clone());
    let sonnet = models.and_then(|m| m.sonnet_model.clone()).unwrap_or_else(|| model.clone());
    let opus = models.and_then(|m| m.opus_model.clone()).unwrap_or_else(|| model.clone());

    settings["env"] = serde_json::json!({
        "ANTHROPIC_BASE_URL": provider.base_url,
        "ANTHROPIC_AUTH_TOKEN": provider.api_key,
        "ANTHROPIC_MODEL": model,
        "ANTHROPIC_DEFAULT_HAIKU_MODEL": haiku,
        "ANTHROPIC_DEFAULT_SONNET_MODEL": sonnet,
        "ANTHROPIC_DEFAULT_OPUS_MODEL": opus,
    });

    let json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Serialize failed: {}", e))?;
    atomic_write_text(&settings_path, &json)
}

/// Write Codex config (~/.codex/)
fn apply_codex_config(provider: &AiProvider) -> Result<(), String> {
    let codex_dir = home_dir().join(".codex");
    fs::create_dir_all(&codex_dir)
        .map_err(|e| format!("Create .codex dir failed: {}", e))?;

    if let Some(sc) = &provider.settings_config {
        if sc.get("auth").is_some() || sc.get("config").is_some() {
            if let Some(auth) = sc.get("auth") {
                let auth_json = serde_json::to_string_pretty(auth)
                    .map_err(|e| format!("Serialize auth failed: {}", e))?;
                atomic_write_text(&codex_dir.join("auth.json"), &auth_json)?;
            }
            if let Some(config) = sc.get("config").and_then(|c| c.as_str()) {
                if !config.is_empty() {
                    atomic_write_text(&codex_dir.join("config.toml"), config)?;
                }
            }
            return Ok(());
        }
    }

    let models = provider.models.codex.as_ref();
    let model = models.and_then(|m| m.model.clone()).unwrap_or_else(|| "gpt-4o".to_string());
    let effort = models.and_then(|m| m.reasoning_effort.clone()).unwrap_or_else(|| "high".to_string());

    let base = provider.base_url.trim_end_matches('/');
    let origin_only = match base.split_once("://") {
        Some((_s, rest)) => !rest.contains('/'),
        None => !base.contains('/'),
    };
    let url = if base.ends_with("/v1") { base.to_string() } else if origin_only { format!("{base}/v1") } else { base.to_string() };

    let toml = format!(
        "model_provider = \"newapi\"\nmodel = \"{model}\"\nmodel_reasoning_effort = \"{effort}\"\ndisable_response_storage = true\n\n[model_providers.newapi]\nname = \"NewAPI\"\nbase_url = \"{url}\"\nwire_api = \"responses\"\nrequires_openai_auth = true"
    );
    atomic_write_text(&codex_dir.join("config.toml"), &toml)?;

    let auth = serde_json::to_string_pretty(&serde_json::json!({ "OPENAI_API_KEY": provider.api_key }))
        .map_err(|e| format!("Serialize auth: {}", e))?;
    atomic_write_text(&codex_dir.join("auth.json"), &auth)
}

/// Write Gemini CLI config
fn apply_gemini_config(provider: &AiProvider) -> Result<(), String> {
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

    if let Some(sc) = &provider.settings_config {
        if let Some(env) = sc.get("env") {
            if let Some(obj) = env.as_object() {
                for (k, v) in obj { settings[k] = v.clone(); }
            }
            let json = serde_json::to_string_pretty(&settings)
                .map_err(|e| format!("Serialize failed: {}", e))?;
            return atomic_write_text(&settings_path, &json);
        }
    }

    let model = provider.models.gemini.as_ref().and_then(|m| m.model.clone()).unwrap_or_else(|| "gemini-2.5-pro".to_string());
    settings["GOOGLE_GEMINI_BASE_URL"] = serde_json::json!(provider.base_url);
    settings["GEMINI_API_KEY"] = serde_json::json!(provider.api_key);
    settings["GEMINI_MODEL"] = serde_json::json!(model);

    let json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Serialize failed: {}", e))?;
    atomic_write_text(&settings_path, &json)
}

fn apply_opencode_config(provider: &AiProvider) -> Result<(), String> {
    let dir = home_dir().join(".opencode");
    fs::create_dir_all(&dir).map_err(|e| format!("Create .opencode dir failed: {}", e))?;

    if let Some(sc) = &provider.settings_config {
        if sc.get("npm").is_some() {
            let json = serde_json::to_string_pretty(sc).map_err(|e| format!("Serialize: {}", e))?;
            return atomic_write_text(&dir.join("config.json"), &json);
        }
    }

    let model = provider.models.opencode.as_ref().and_then(|m| m.model.clone()).unwrap_or_else(|| "gpt-4o".to_string());
    let config = serde_json::json!({
        "provider": "openai-compatible",
        "providers": { "openai-compatible": { "apiKey": provider.api_key, "model": model, "baseURL": provider.base_url } }
    });
    let json = serde_json::to_string_pretty(&config).map_err(|e| format!("Serialize: {}", e))?;
    atomic_write_text(&dir.join("config.json"), &json)
}

fn apply_openclaw_config(provider: &AiProvider) -> Result<(), String> {
    let dir = home_dir().join(".openclaw");
    fs::create_dir_all(&dir).map_err(|e| format!("Create .openclaw dir failed: {}", e))?;

    if let Some(sc) = &provider.settings_config {
        if sc.get("api").is_some() || sc.get("models").is_some() {
            let json = serde_json::to_string_pretty(sc).map_err(|e| format!("Serialize: {}", e))?;
            return atomic_write_text(&dir.join("config.json"), &json);
        }
    }

    let model = provider.models.openclaw.as_ref().and_then(|m| m.model.clone()).unwrap_or_else(|| "gpt-4o".to_string());
    let config = serde_json::json!({ "apiProvider": "custom", "customApiUrl": provider.base_url, "customApiKey": provider.api_key, "customModel": model });
    let json = serde_json::to_string_pretty(&config).map_err(|e| format!("Serialize: {}", e))?;
    atomic_write_text(&dir.join("config.json"), &json)
}

// ============================================================================
// Tauri commands
// ============================================================================

#[tauri::command]
pub async fn list_ai_providers() -> Result<Vec<AiProvider>, String> {
    tokio::task::spawn_blocking(|| Ok(load_store().providers)).await.map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
pub async fn get_ai_active_ids() -> Result<(Option<String>, Option<String>, Option<String>, Option<String>, Option<String>), String> {
    tokio::task::spawn_blocking(|| {
        let s = load_store();
        Ok((s.active_claude, s.active_codex, s.active_gemini, s.active_opencode, s.active_openclaw))
    }).await.map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
pub async fn save_ai_provider(provider: AiProvider) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let mut store = load_store();
        if let Some(existing) = store.providers.iter_mut().find(|p| p.id == provider.id) {
            *existing = provider;
        } else {
            store.providers.push(provider);
        }
        save_store(&store)
    }).await.map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
pub async fn delete_ai_provider(provider_id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let mut store = load_store();
        store.providers.retain(|p| p.id != provider_id);
        if store.active_claude.as_deref() == Some(&provider_id) { store.active_claude = None; }
        if store.active_codex.as_deref() == Some(&provider_id) { store.active_codex = None; }
        if store.active_gemini.as_deref() == Some(&provider_id) { store.active_gemini = None; }
        if store.active_opencode.as_deref() == Some(&provider_id) { store.active_opencode = None; }
        if store.active_openclaw.as_deref() == Some(&provider_id) { store.active_openclaw = None; }
        save_store(&store)
    }).await.map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
pub async fn switch_ai_provider(provider_id: String, tool: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let mut store = load_store();
        let provider = store.providers.iter().find(|p| p.id == provider_id).cloned()
            .ok_or_else(|| format!("Provider '{}' not found", provider_id))?;

        match tool.as_str() {
            "claude" => { if !provider.apps.claude { return Err("Not enabled for Claude".into()); } apply_claude_config(&provider)?; store.active_claude = Some(provider_id); }
            "codex" => { if !provider.apps.codex { return Err("Not enabled for Codex".into()); } apply_codex_config(&provider)?; store.active_codex = Some(provider_id); }
            "gemini" => { if !provider.apps.gemini { return Err("Not enabled for Gemini".into()); } apply_gemini_config(&provider)?; store.active_gemini = Some(provider_id); }
            "opencode" => { if !provider.apps.opencode { return Err("Not enabled for OpenCode".into()); } apply_opencode_config(&provider)?; store.active_opencode = Some(provider_id); }
            "openclaw" => { if !provider.apps.openclaw { return Err("Not enabled for OpenClaw".into()); } apply_openclaw_config(&provider)?; store.active_openclaw = Some(provider_id); }
            "all" => {
                if provider.apps.claude { apply_claude_config(&provider)?; store.active_claude = Some(provider.id.clone()); }
                if provider.apps.codex { apply_codex_config(&provider)?; store.active_codex = Some(provider.id.clone()); }
                if provider.apps.gemini { apply_gemini_config(&provider)?; store.active_gemini = Some(provider.id.clone()); }
                if provider.apps.opencode { apply_opencode_config(&provider)?; store.active_opencode = Some(provider.id.clone()); }
                if provider.apps.openclaw { apply_openclaw_config(&provider)?; store.active_openclaw = Some(provider.id.clone()); }
            }
            _ => return Err(format!("Unknown tool: {}", tool)),
        }
        save_store(&store)
    }).await.map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
pub async fn import_from_cc_switch() -> Result<Vec<AiProvider>, String> {
    tokio::task::spawn_blocking(import_from_cc_switch_blocking)
        .await.map_err(|e| format!("task join: {}", e))?
}

fn import_from_cc_switch_blocking() -> Result<Vec<AiProvider>, String> {
    let config_path = home_dir().join(".cc-switch").join("config.json");
    if !config_path.exists() {
        return Err("cc-switch is not installed or config not found".to_string());
    }

    let content = fs::read_to_string(&config_path).map_err(|e| format!("Read cc-switch config: {}", e))?;
    let config: serde_json::Value = serde_json::from_str(&content).map_err(|e| format!("Parse cc-switch config: {}", e))?;
    let mut imported = Vec::new();

    for app in ["claude", "codex", "gemini", "opencode", "openclaw"] {
        if let Some(providers) = config.get(app).and_then(|v| v.get("providers")).and_then(|v| v.as_object()) {
            for (id, pval) in providers {
                if let Ok(p) = parse_cc_switch_provider(id, pval, app) { imported.push(p); }
            }
        }
    }

    if let Some(universal) = config.get("universalProviders").and_then(|v| v.as_object()) {
        for (id, uval) in universal {
            if let Ok(p) = parse_cc_switch_universal(id, uval) { imported.push(p); }
        }
    }

    Ok(imported)
}

fn parse_cc_switch_provider(id: &str, val: &serde_json::Value, app: &str) -> Result<AiProvider, String> {
    let name = val.get("name").and_then(|v| v.as_str()).unwrap_or(id).to_string();
    let sc = val.get("settingsConfig").cloned();
    let base_url = sc.as_ref()
        .and_then(|s| s.pointer("/env/ANTHROPIC_BASE_URL").or_else(|| s.pointer("/env/GOOGLE_GEMINI_BASE_URL")))
        .and_then(|v| v.as_str()).unwrap_or("").to_string();
    let api_key = sc.as_ref()
        .and_then(|s| s.pointer("/env/ANTHROPIC_AUTH_TOKEN").or_else(|| s.pointer("/env/ANTHROPIC_API_KEY")).or_else(|| s.pointer("/auth/OPENAI_API_KEY")).or_else(|| s.pointer("/env/GEMINI_API_KEY")))
        .and_then(|v| v.as_str()).unwrap_or("").to_string();
    let mut apps = ProviderApps::default();
    match app { "claude" => apps.claude = true, "codex" => apps.codex = true, "gemini" => apps.gemini = true, "opencode" => apps.opencode = true, "openclaw" => apps.openclaw = true, _ => {} }

    Ok(AiProvider {
        id: format!("cc-{}-{}", app, id), name, provider_type: "imported".into(), base_url, api_key, apps,
        models: ProviderModels::default(), settings_config: sc,
        category: val.get("category").and_then(|v| v.as_str()).map(String::from),
        website_url: val.get("websiteUrl").and_then(|v| v.as_str()).map(String::from),
        notes: val.get("notes").and_then(|v| v.as_str()).map(String::from),
        icon: val.get("icon").and_then(|v| v.as_str()).map(String::from),
        icon_color: val.get("iconColor").and_then(|v| v.as_str()).map(String::from),
        enabled: false, is_partner: val.get("isPartner").and_then(|v| v.as_bool()),
        custom_headers: None, created_at: val.get("createdAt").and_then(|v| v.as_i64()),
        sort_index: val.get("sortIndex").and_then(|v| v.as_u64()).map(|v| v as usize),
    })
}

fn parse_cc_switch_universal(id: &str, val: &serde_json::Value) -> Result<AiProvider, String> {
    let name = val.get("name").and_then(|v| v.as_str()).unwrap_or(id).to_string();
    let base_url = val.get("baseUrl").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let api_key = val.get("apiKey").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let av = val.get("apps");
    let apps = ProviderApps {
        claude: av.and_then(|a| a.get("claude")).and_then(|v| v.as_bool()).unwrap_or(false),
        codex: av.and_then(|a| a.get("codex")).and_then(|v| v.as_bool()).unwrap_or(false),
        gemini: av.and_then(|a| a.get("gemini")).and_then(|v| v.as_bool()).unwrap_or(false),
        opencode: av.and_then(|a| a.get("opencode")).and_then(|v| v.as_bool()).unwrap_or(false),
        openclaw: av.and_then(|a| a.get("openclaw")).and_then(|v| v.as_bool()).unwrap_or(false),
    };
    Ok(AiProvider {
        id: format!("cc-universal-{}", id), name,
        provider_type: val.get("providerType").and_then(|v| v.as_str()).unwrap_or("custom").into(),
        base_url, api_key, apps, models: ProviderModels::default(), settings_config: None,
        category: None, website_url: val.get("websiteUrl").and_then(|v| v.as_str()).map(String::from),
        notes: val.get("notes").and_then(|v| v.as_str()).map(String::from),
        icon: val.get("icon").and_then(|v| v.as_str()).map(String::from),
        icon_color: val.get("iconColor").and_then(|v| v.as_str()).map(String::from),
        enabled: false, is_partner: None, custom_headers: None,
        created_at: val.get("createdAt").and_then(|v| v.as_i64()),
        sort_index: val.get("sortIndex").and_then(|v| v.as_u64()).map(|v| v as usize),
    })
}
