use crate::ai_platform::domain::openclaw::{
    OpenClawEditableConfigRecord, OpenClawProviderOptionRecord,
};
use crate::ai_platform::infrastructure::db::providers_db::load_or_initialize_store;
use crate::ai_platform::infrastructure::fs::settings_store::load_store as load_settings_store;
use crate::ai_platform::interfaces::dto::openclaw::{
    OpenClawHealthItemDto, OpenClawSnapshotDto,
};
use serde_json::{Map, Value};
use std::fs;
use std::path::PathBuf;

const SUPPORTED_TOOLS_PROFILES: [&str; 4] = ["minimal", "coding", "messaging", "full"];

pub fn get_openclaw_snapshot() -> Result<OpenClawSnapshotDto, String> {
    let config_path = openclaw_config_path()?;
    let provider_state = load_or_initialize_store()?;
    let provider_options = provider_state
        .store
        .providers
        .iter()
        .filter(|provider| provider.enabled && provider.apps.openclaw)
        .filter_map(|provider| {
            let model = provider.models.openclaw.as_ref()?.model.clone()?;
            Some(OpenClawProviderOptionRecord {
                provider_id: provider.id.clone(),
                provider_name: provider.name.clone(),
                model,
                active: provider_state.store.active.openclaw.as_deref() == Some(provider.id.as_str()),
            })
        })
        .collect::<Vec<_>>();

    let exists = config_path.exists();
    let content = if exists {
        fs::read_to_string(&config_path).map_err(|error| error.to_string())?
    } else {
        String::new()
    };

    let (config, parse_error, bridge_summary) = if content.trim().is_empty() {
        (
            OpenClawEditableConfigRecord::default(),
            None,
            default_bridge_summary(),
        )
    } else {
        match serde_json::from_str::<Value>(&content) {
            Ok(value) => snapshot_from_value(value),
            Err(error) => (
                OpenClawEditableConfigRecord::default(),
                Some(error.to_string()),
                default_bridge_summary(),
            ),
        }
    };

    let health = build_health_items(parse_error.clone(), &config, &provider_options, exists);

    Ok(OpenClawSnapshotDto {
        config_path: config_path.to_string_lossy().to_string(),
        exists,
        parse_error,
        config,
        provider_options,
        bridge_summary,
        health,
        source: format!("openclaw-file + {}", provider_state.source),
    })
}

pub fn save_openclaw_config(
    config: OpenClawEditableConfigRecord,
) -> Result<OpenClawSnapshotDto, String> {
    validate_config(&config)?;
    let config_path = openclaw_config_path()?;
    let existing_root = if config_path.exists() {
        fs::read_to_string(&config_path)
            .ok()
            .and_then(|content| serde_json::from_str::<Value>(&content).ok())
            .unwrap_or_else(|| Value::Object(Map::new()))
    } else {
        Value::Object(Map::new())
    };

    let mut root = existing_root.as_object().cloned().unwrap_or_default();
    let env_value = serde_json::from_str::<Value>(&config.env_json)
        .map_err(|error| format!("OpenClaw env JSON invalid: {error}"))?;
    root.insert("env".to_string(), env_value);

    let mut tools = root
        .remove("tools")
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    if config.tools_profile.trim().is_empty() {
        tools.remove("profile");
    } else {
        tools.insert("profile".to_string(), Value::String(config.tools_profile.trim().to_string()));
    }
    tools.insert(
        "allow".to_string(),
        Value::Array(
            config
                .allow_list
                .iter()
                .filter(|item| !item.trim().is_empty())
                .map(|item| Value::String(item.trim().to_string()))
                .collect(),
        ),
    );
    tools.insert(
        "deny".to_string(),
        Value::Array(
            config
                .deny_list
                .iter()
                .filter(|item| !item.trim().is_empty())
                .map(|item| Value::String(item.trim().to_string()))
                .collect(),
        ),
    );
    root.insert("tools".to_string(), Value::Object(tools));

    let mut agents = root
        .remove("agents")
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    let mut defaults = agents
        .remove("defaults")
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    if config.primary_model.trim().is_empty() {
        defaults.remove("primaryModel");
    } else {
        defaults.insert(
            "primaryModel".to_string(),
            Value::String(config.primary_model.trim().to_string()),
        );
    }
    defaults.insert(
        "fallbackModels".to_string(),
        Value::Array(
            config
                .fallback_models
                .iter()
                .filter(|item| !item.trim().is_empty())
                .map(|item| Value::String(item.trim().to_string()))
                .collect(),
        ),
    );
    if config.workspace.trim().is_empty() {
        defaults.remove("workspace");
    } else {
        defaults.insert("workspace".to_string(), Value::String(config.workspace.trim().to_string()));
    }
    upsert_optional_number(&mut defaults, "timeoutSeconds", config.timeout_seconds);
    upsert_optional_number(&mut defaults, "contextTokens", config.context_tokens);
    upsert_optional_number(&mut defaults, "maxConcurrent", config.max_concurrent);
    defaults.remove("timeout");
    agents.insert("defaults".to_string(), Value::Object(defaults));
    root.insert("agents".to_string(), Value::Object(agents));

    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let content = serde_json::to_string_pretty(&Value::Object(root)).map_err(|error| error.to_string())?;
    fs::write(&config_path, content).map_err(|error| error.to_string())?;
    get_openclaw_snapshot()
}

fn snapshot_from_value(
    value: Value,
) -> (OpenClawEditableConfigRecord, Option<String>, String) {
    let root = value.as_object().cloned().unwrap_or_default();
    let env_value = root.get("env").cloned().unwrap_or_else(|| Value::Object(Map::new()));
    let tools = root
        .get("tools")
        .and_then(|value| value.as_object())
        .cloned()
        .unwrap_or_default();
    let agents_defaults = root
        .get("agents")
        .and_then(|value| value.get("defaults"))
        .and_then(|value| value.as_object())
        .cloned()
        .unwrap_or_default();

    let env_json = serde_json::to_string_pretty(&env_value).unwrap_or_else(|_| "{}".to_string());
    let tools_profile = tools
        .get("profile")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let allow_list = array_of_strings(tools.get("allow"));
    let deny_list = array_of_strings(tools.get("deny"));
    let primary_model = agents_defaults
        .get("primaryModel")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let fallback_models = array_of_strings(agents_defaults.get("fallbackModels"));
    let workspace = agents_defaults
        .get("workspace")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let timeout_seconds = agents_defaults
        .get("timeoutSeconds")
        .and_then(Value::as_u64)
        .map(|value| value as u32)
        .or_else(|| agents_defaults.get("timeout").and_then(Value::as_u64).map(|value| value as u32));
    let context_tokens = agents_defaults
        .get("contextTokens")
        .and_then(Value::as_u64)
        .map(|value| value as u32);
    let max_concurrent = agents_defaults
        .get("maxConcurrent")
        .and_then(Value::as_u64)
        .map(|value| value as u32);
    let bridge_summary = format!(
        "provider={} / model={} / endpoint={}",
        root.get("apiProvider").and_then(Value::as_str).unwrap_or("unset"),
        root.get("customModel").and_then(Value::as_str).unwrap_or("unset"),
        root.get("customApiUrl").and_then(Value::as_str).unwrap_or("unset")
    );

    (
        OpenClawEditableConfigRecord {
            env_json,
            tools_profile,
            allow_list,
            deny_list,
            primary_model,
            fallback_models,
            workspace,
            timeout_seconds,
            context_tokens,
            max_concurrent,
        },
        None,
        bridge_summary,
    )
}

fn build_health_items(
    parse_error: Option<String>,
    config: &OpenClawEditableConfigRecord,
    provider_options: &[OpenClawProviderOptionRecord],
    exists: bool,
) -> Vec<OpenClawHealthItemDto> {
    let mut items = Vec::new();

    if !exists {
        items.push(OpenClawHealthItemDto {
            id: "missing-file".to_string(),
            level: "warning".to_string(),
            title: "Config file missing".to_string(),
            detail: "尚未检测到 OpenClaw config.json，保存后会自动创建。".to_string(),
        });
    }

    if let Some(parse_error) = parse_error {
        items.push(OpenClawHealthItemDto {
            id: "parse-error".to_string(),
            level: "danger".to_string(),
            title: "Config parse failed".to_string(),
            detail: parse_error,
        });
        return items;
    }

    if !config.tools_profile.trim().is_empty()
        && !SUPPORTED_TOOLS_PROFILES.contains(&config.tools_profile.trim())
    {
        items.push(OpenClawHealthItemDto {
            id: "tools-profile".to_string(),
            level: "warning".to_string(),
            title: "Unsupported tools profile".to_string(),
            detail: format!(
                "当前 tools.profile={}，建议使用 minimal/coding/messaging/full。",
                config.tools_profile
            ),
        });
    }

    let configured_models = provider_options
        .iter()
        .map(|option| option.model.as_str())
        .collect::<Vec<_>>();
    if !config.primary_model.trim().is_empty()
        && !configured_models.iter().any(|model| *model == config.primary_model.trim())
    {
        items.push(OpenClawHealthItemDto {
            id: "primary-model".to_string(),
            level: "warning".to_string(),
            title: "Primary model not found".to_string(),
            detail: "默认模型不在当前 OpenClaw provider 列表中。".to_string(),
        });
    }

    if provider_options.is_empty() {
        items.push(OpenClawHealthItemDto {
            id: "provider-models".to_string(),
            level: "warning".to_string(),
            title: "No provider models".to_string(),
            detail: "当前没有启用且带模型的 OpenClaw provider。".to_string(),
        });
    }

    if items.is_empty() {
        items.push(OpenClawHealthItemDto {
            id: "healthy".to_string(),
            level: "success".to_string(),
            title: "Config healthy".to_string(),
            detail: "OpenClaw 配置可解析，且关键字段处于可用状态。".to_string(),
        });
    }

    items
}

fn validate_config(config: &OpenClawEditableConfigRecord) -> Result<(), String> {
    let env_value = serde_json::from_str::<Value>(&config.env_json)
        .map_err(|error| format!("OpenClaw env JSON invalid: {error}"))?;
    if !env_value.is_object() {
        return Err("OpenClaw env must be a JSON object".to_string());
    }
    if !config.tools_profile.trim().is_empty()
        && !SUPPORTED_TOOLS_PROFILES.contains(&config.tools_profile.trim())
    {
        return Err("OpenClaw tools profile must be minimal, coding, messaging, or full".to_string());
    }
    Ok(())
}

fn openclaw_config_path() -> Result<PathBuf, String> {
    let settings = load_settings_store()?;
    let configured_dir = settings.directories.openclaw_config_dir.trim().to_string();
    if !configured_dir.is_empty() {
        return Ok(PathBuf::from(configured_dir).join("config.json"));
    }
    dirs::home_dir()
        .map(|dir| dir.join(".openclaw").join("config.json"))
        .ok_or_else(|| "Cannot determine OpenClaw config path".to_string())
}

fn array_of_strings(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn upsert_optional_number(target: &mut Map<String, Value>, key: &str, value: Option<u32>) {
    if let Some(value) = value {
        target.insert(key.to_string(), Value::Number(value.into()));
    } else {
        target.remove(key);
    }
}

fn default_bridge_summary() -> String {
    "provider=unset / model=unset / endpoint=unset".to_string()
}