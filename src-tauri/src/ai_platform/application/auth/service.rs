use crate::ai_platform::domain::auth::{AuthConnectionRecord, AuthStatusItemRecord};
use crate::ai_platform::domain::provider::{ActiveProviderSet, ProviderRecord};
use crate::ai_platform::infrastructure::db::providers_db::{load_or_initialize_store, load_switch_history};
use crate::ai_platform::infrastructure::fs::settings_store::load_store as load_settings_store;
use crate::ai_platform::interfaces::dto::auth::AuthSnapshotDto;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

pub fn get_auth_snapshot() -> Result<AuthSnapshotDto, String> {
    let provider_state = load_or_initialize_store()?;
    let connections = vec![
        build_connection(
            "claude",
            "Claude",
            provider_state.store.active.claude.as_deref(),
            &provider_state.store.providers,
            &provider_state.store.active,
        ),
        build_connection(
            "codex",
            "Codex",
            provider_state.store.active.codex.as_deref(),
            &provider_state.store.providers,
            &provider_state.store.active,
        ),
        build_connection(
            "gemini",
            "Gemini",
            provider_state.store.active.gemini.as_deref(),
            &provider_state.store.providers,
            &provider_state.store.active,
        ),
        build_connection(
            "opencode",
            "OpenCode",
            provider_state.store.active.opencode.as_deref(),
            &provider_state.store.providers,
            &provider_state.store.active,
        ),
        build_connection(
            "openclaw",
            "OpenClaw",
            provider_state.store.active.openclaw.as_deref(),
            &provider_state.store.providers,
            &provider_state.store.active,
        ),
    ]
    .into_iter()
    .collect::<Result<Vec<_>, _>>()?;

    let statuses = build_statuses(&connections, &provider_state.store.providers);
    let switch_history = load_switch_history(12)?;

    Ok(AuthSnapshotDto {
        connections,
        statuses,
        switch_history,
        source: format!("auth-scan + {}", provider_state.source),
    })
}

fn build_connection(
    app: &str,
    label: &str,
    active_provider_id: Option<&str>,
    providers: &[ProviderRecord],
    active: &ActiveProviderSet,
) -> Result<AuthConnectionRecord, String> {
    let inspection = inspect_local_config(app)?;
    let provider = active_provider_id.and_then(|provider_id| {
        providers
            .iter()
            .find(|candidate| candidate.id == provider_id)
            .cloned()
    });

    let Some(provider) = provider else {
        return Ok(AuthConnectionRecord {
            app: app.to_string(),
            label: label.to_string(),
            active_provider_id: active_provider_id.map(ToString::to_string),
            active_provider_name: None,
            provider_type: None,
            provider_enabled: false,
            local_config_targets: inspection.targets,
            local_config_present: inspection.present,
            provider_token_present: false,
            local_token_present: inspection.token_present,
            token_source: inspection.token_source,
            base_url: inspection.base_url,
            model: inspection.model,
            status: "missing".to_string(),
            detail: format!("{} 尚未绑定 active provider。", label),
        });
    };

    let provider_token_present = !provider.api_key.trim().is_empty();
    let provider_type = provider.provider_type.clone();
    let provider_enabled = provider.enabled;
    let model = provider_model_for_app(&provider, app).or(inspection.model.clone());
    let base_url = if provider.base_url.trim().is_empty() {
        inspection.base_url.clone()
    } else {
        Some(provider.base_url.clone())
    };

    let (status, detail, token_source) = if !provider_enabled {
        (
            "degraded".to_string(),
            format!("{} 绑定的 provider 已被禁用。", label),
            inspection.token_source.clone(),
        )
    } else if provider_type == "copilot" {
        (
            if inspection.present { "ready" } else { "degraded" }.to_string(),
            if inspection.present {
                format!("{} 绑定了 Copilot provider，本地配置文件已存在。", label)
            } else {
                format!("{} 绑定了 Copilot provider，但当前首切片无法验证会话态 token。", label)
            },
            inspection
                .token_source
                .clone()
                .or_else(|| Some("copilot-session".to_string())),
        )
    } else if provider_token_present && inspection.present {
        (
            "ready".to_string(),
            format!("{} 已绑定 provider，且本地接入文件存在。", label),
            Some("provider-store".to_string()),
        )
    } else if inspection.token_present {
        (
            "ready".to_string(),
            format!("{} 已检测到本地鉴权信息。", label),
            inspection.token_source.clone(),
        )
    } else if provider_token_present {
        (
            "degraded".to_string(),
            format!("{} provider 已有 token，但本地接入文件还未落地。", label),
            Some("provider-store".to_string()),
        )
    } else {
        (
            "missing".to_string(),
            format!("{} 当前缺少可用 token。", label),
            inspection.token_source.clone(),
        )
    };

    let active_provider_name = Some(provider.name.clone());
    let active_provider_id = Some(provider.id.clone());

    let _ = active;

    Ok(AuthConnectionRecord {
        app: app.to_string(),
        label: label.to_string(),
        active_provider_id,
        active_provider_name,
        provider_type: Some(provider_type),
        provider_enabled,
        local_config_targets: inspection.targets,
        local_config_present: inspection.present,
        provider_token_present,
        local_token_present: inspection.token_present,
        token_source,
        base_url,
        model,
        status,
        detail,
    })
}

fn build_statuses(
    connections: &[AuthConnectionRecord],
    providers: &[ProviderRecord],
) -> Vec<AuthStatusItemRecord> {
    let mut items = Vec::new();
    let missing_bindings = connections
        .iter()
        .filter(|connection| connection.active_provider_id.is_none())
        .count();
    let missing_tokens = connections
        .iter()
        .filter(|connection| connection.status == "missing")
        .count();
    let missing_files = connections
        .iter()
        .filter(|connection| !connection.local_config_present)
        .count();
    let copilot_bound = connections
        .iter()
        .filter(|connection| connection.provider_type.as_deref() == Some("copilot"))
        .count();
    let active_apps = connections
        .iter()
        .filter(|connection| connection.active_provider_id.is_some())
        .count();

    if active_apps == 0 {
        items.push(AuthStatusItemRecord {
            id: "no-bindings".to_string(),
            level: "warning".to_string(),
            title: "No active auth bindings".to_string(),
            detail: "五个接入 app 目前都还没有 active provider 绑定。".to_string(),
        });
    }

    if missing_bindings > 0 {
        items.push(AuthStatusItemRecord {
            id: "binding-gap".to_string(),
            level: "warning".to_string(),
            title: "Binding gaps detected".to_string(),
            detail: format!("还有 {} 个 app 没有 active provider 绑定。", missing_bindings),
        });
    }

    if missing_tokens > 0 {
        items.push(AuthStatusItemRecord {
            id: "token-gap".to_string(),
            level: "danger".to_string(),
            title: "Missing auth tokens".to_string(),
            detail: format!("还有 {} 个 app 没有检测到 provider token 或本地 token。", missing_tokens),
        });
    }

    if missing_files > 0 {
        items.push(AuthStatusItemRecord {
            id: "local-config-gap".to_string(),
            level: "warning".to_string(),
            title: "Local bridge files incomplete".to_string(),
            detail: format!("还有 {} 个 app 缺少本地 CLI 接入文件。", missing_files),
        });
    }

    if copilot_bound > 0 {
        items.push(AuthStatusItemRecord {
            id: "copilot-observe".to_string(),
            level: "info".to_string(),
            title: "Copilot bindings need runtime verification".to_string(),
            detail: "Copilot 类型 provider 当前仅做绑定与文件观测，尚未下探本机会话态。".to_string(),
        });
    }

    let enabled_providers = providers.iter().filter(|provider| provider.enabled).count();
    if enabled_providers > 0 && items.is_empty() {
        items.push(AuthStatusItemRecord {
            id: "healthy".to_string(),
            level: "success".to_string(),
            title: "Auth surface looks healthy".to_string(),
            detail: "当前 active bindings、本地接入文件和 token 检测均处于可用状态。".to_string(),
        });
    }

    items
}

#[derive(Debug, Clone)]
struct LocalAuthInspection {
    targets: Vec<String>,
    present: bool,
    token_present: bool,
    token_source: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
}

fn inspect_local_config(app: &str) -> Result<LocalAuthInspection, String> {
    let settings = load_settings_store()?;
    match app {
        "claude" => inspect_claude(config_dir(&settings.directories.claude_config_dir, ".claude").join("settings.json")),
        "codex" => inspect_codex(config_dir(&settings.directories.codex_config_dir, ".codex")),
        "gemini" => inspect_gemini(config_dir(&settings.directories.gemini_config_dir, ".gemini").join("settings.json")),
        "opencode" => inspect_opencode(config_dir(&settings.directories.opencode_config_dir, ".opencode").join("config.json")),
        "openclaw" => inspect_openclaw(config_dir(&settings.directories.openclaw_config_dir, ".openclaw").join("config.json")),
        _ => Ok(LocalAuthInspection {
            targets: Vec::new(),
            present: false,
            token_present: false,
            token_source: None,
            base_url: None,
            model: None,
        }),
    }
}

fn inspect_claude(path: PathBuf) -> Result<LocalAuthInspection, String> {
    let exists = path.exists();
    let value = read_json(&path)?;
    let token_present = json_pointer_has_value(&value, "/env/ANTHROPIC_AUTH_TOKEN")
        || json_pointer_has_value(&value, "/env/ANTHROPIC_API_KEY");
    Ok(LocalAuthInspection {
        targets: vec![path.to_string_lossy().to_string()],
        present: exists,
        token_present,
        token_source: if json_pointer_has_value(&value, "/env/ANTHROPIC_AUTH_TOKEN") {
            Some("claude-settings.json".to_string())
        } else if json_pointer_has_value(&value, "/env/ANTHROPIC_API_KEY") {
            Some("claude-settings.json".to_string())
        } else {
            None
        },
        base_url: json_pointer_string(&value, "/env/ANTHROPIC_BASE_URL"),
        model: json_pointer_string(&value, "/env/ANTHROPIC_MODEL"),
    })
}

fn inspect_codex(dir: PathBuf) -> Result<LocalAuthInspection, String> {
    let auth_path = dir.join("auth.json");
    let config_path = dir.join("config.toml");
    let auth_exists = auth_path.exists();
    let config_exists = config_path.exists();
    let auth_value = read_json(&auth_path)?;
    let config_text = if config_exists {
        fs::read_to_string(&config_path).map_err(|error| error.to_string())?
    } else {
        String::new()
    };
    let auth_token = json_pointer_has_value(&auth_value, "/OPENAI_API_KEY");
    let config_token = has_toml_assignment(&config_text, "api_key") || has_toml_assignment(&config_text, "OPENAI_API_KEY");
    let token_source = if auth_token {
        Some("codex-auth.json".to_string())
    } else if config_token {
        Some("codex-config.toml".to_string())
    } else {
        None
    };

    Ok(LocalAuthInspection {
        targets: vec![auth_path.to_string_lossy().to_string(), config_path.to_string_lossy().to_string()],
        present: auth_exists || config_exists,
        token_present: auth_token || config_token,
        token_source,
        base_url: extract_toml_assignment(&config_text, "base_url"),
        model: extract_toml_assignment(&config_text, "model"),
    })
}

fn inspect_gemini(path: PathBuf) -> Result<LocalAuthInspection, String> {
    let exists = path.exists();
    let value = read_json(&path)?;
    Ok(LocalAuthInspection {
        targets: vec![path.to_string_lossy().to_string()],
        present: exists,
        token_present: json_pointer_has_value(&value, "/env/GEMINI_API_KEY"),
        token_source: if json_pointer_has_value(&value, "/env/GEMINI_API_KEY") {
            Some("gemini-settings.json".to_string())
        } else {
            None
        },
        base_url: json_pointer_string(&value, "/env/GOOGLE_GEMINI_BASE_URL"),
        model: json_pointer_string(&value, "/env/GEMINI_MODEL"),
    })
}

fn inspect_opencode(path: PathBuf) -> Result<LocalAuthInspection, String> {
    let exists = path.exists();
    let value = read_json(&path)?;
    Ok(LocalAuthInspection {
        targets: vec![path.to_string_lossy().to_string()],
        present: exists,
        token_present: json_pointer_has_value(&value, "/providers/openai-compatible/apiKey"),
        token_source: if json_pointer_has_value(&value, "/providers/openai-compatible/apiKey") {
            Some("opencode-config.json".to_string())
        } else {
            None
        },
        base_url: json_pointer_string(&value, "/providers/openai-compatible/baseURL"),
        model: json_pointer_string(&value, "/providers/openai-compatible/model"),
    })
}

fn inspect_openclaw(path: PathBuf) -> Result<LocalAuthInspection, String> {
    let exists = path.exists();
    let value = read_json(&path)?;
    let token_present = json_pointer_has_value(&value, "/customApiKey")
        || json_pointer_has_value(&value, "/env/ANTHROPIC_AUTH_TOKEN")
        || json_pointer_has_value(&value, "/env/OPENAI_API_KEY")
        || json_pointer_has_value(&value, "/env/GEMINI_API_KEY");
    Ok(LocalAuthInspection {
        targets: vec![path.to_string_lossy().to_string()],
        present: exists,
        token_present,
        token_source: if json_pointer_has_value(&value, "/customApiKey") {
            Some("openclaw-config.json".to_string())
        } else if json_pointer_has_value(&value, "/env/ANTHROPIC_AUTH_TOKEN")
            || json_pointer_has_value(&value, "/env/OPENAI_API_KEY")
            || json_pointer_has_value(&value, "/env/GEMINI_API_KEY")
        {
            Some("openclaw-config.json/env".to_string())
        } else {
            None
        },
        base_url: json_pointer_string(&value, "/customApiUrl"),
        model: json_pointer_string(&value, "/customModel"),
    })
}

fn config_dir(configured: &str, default_folder: &str) -> PathBuf {
    let configured = configured.trim();
    if !configured.is_empty() {
        return PathBuf::from(configured);
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(default_folder)
}

fn read_json(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(Value::Null);
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str::<Value>(&content).map_err(|error| error.to_string())
}

fn json_pointer_string(value: &Value, pointer: &str) -> Option<String> {
    value.pointer(pointer)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn json_pointer_has_value(value: &Value, pointer: &str) -> bool {
    json_pointer_string(value, pointer).is_some()
}

fn has_toml_assignment(content: &str, key: &str) -> bool {
    extract_toml_assignment(content, key).is_some()
}

fn extract_toml_assignment(content: &str, key: &str) -> Option<String> {
    let prefix = format!("{key} =");
    content.lines().find_map(|line| {
        let trimmed = line.trim();
        if !trimmed.starts_with(&prefix) {
            return None;
        }
        let value = trimmed[prefix.len()..].trim();
        if value.len() < 2 {
            return None;
        }
        if let Some(stripped) = value.strip_prefix('"').and_then(|rest| rest.strip_suffix('"')) {
            let stripped = stripped.trim();
            if stripped.is_empty() {
                None
            } else {
                Some(stripped.to_string())
            }
        } else {
            let raw = value.trim_matches('"').trim();
            if raw.is_empty() {
                None
            } else {
                Some(raw.to_string())
            }
        }
    })
}

fn provider_model_for_app(provider: &ProviderRecord, app: &str) -> Option<String> {
    match app {
        "claude" => provider.models.claude.as_ref().and_then(|models| models.model.clone()),
        "codex" => provider.models.codex.as_ref().and_then(|models| models.model.clone()),
        "gemini" => provider.models.gemini.as_ref().and_then(|models| models.model.clone()),
        "opencode" => provider.models.opencode.as_ref().and_then(|models| models.model.clone()),
        "openclaw" => provider.models.openclaw.as_ref().and_then(|models| models.model.clone()),
        _ => None,
    }
}