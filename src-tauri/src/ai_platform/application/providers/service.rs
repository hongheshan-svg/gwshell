use crate::ai_platform::domain::provider::ProviderRecord;
use crate::ai_platform::infrastructure::db::providers_db::{
    load_health_checks, load_or_initialize_store, load_switch_history, record_switch_event,
    save_health_check, save_store,
};
use crate::ai_platform::infrastructure::fs::providers_store::apply_provider_to_app;
use crate::ai_platform::interfaces::dto::providers::{ProviderHealthDto, ProviderSnapshotDto};
use reqwest::blocking::Client;
use std::time::{Duration, Instant};

pub fn list_provider_snapshot() -> Result<ProviderSnapshotDto, String> {
    let loaded = load_or_initialize_store()?;
    Ok(ProviderSnapshotDto {
        providers: loaded.store.providers,
        active: loaded.store.active,
        source: loaded.source,
        health_checks: load_health_checks()?,
        switch_history: load_switch_history(12)?,
    })
}

pub fn save_provider(provider: ProviderRecord) -> Result<ProviderSnapshotDto, String> {
    let mut loaded = load_or_initialize_store()?;
    if let Some(existing) = loaded
        .store
        .providers
        .iter_mut()
        .find(|current| current.id == provider.id)
    {
        *existing = provider;
    } else {
        loaded.store.providers.push(provider);
    }
    save_store(&loaded.store)?;
    Ok(ProviderSnapshotDto {
        providers: loaded.store.providers,
        active: loaded.store.active,
        source: loaded.source,
        health_checks: load_health_checks()?,
        switch_history: load_switch_history(12)?,
    })
}

pub fn delete_provider(provider_id: String) -> Result<ProviderSnapshotDto, String> {
    let mut loaded = load_or_initialize_store()?;
    loaded.store.providers.retain(|provider| provider.id != provider_id);
    if loaded.store.active.claude.as_deref() == Some(provider_id.as_str()) {
        loaded.store.active.claude = None;
    }
    if loaded.store.active.codex.as_deref() == Some(provider_id.as_str()) {
        loaded.store.active.codex = None;
    }
    if loaded.store.active.gemini.as_deref() == Some(provider_id.as_str()) {
        loaded.store.active.gemini = None;
    }
    if loaded.store.active.opencode.as_deref() == Some(provider_id.as_str()) {
        loaded.store.active.opencode = None;
    }
    if loaded.store.active.openclaw.as_deref() == Some(provider_id.as_str()) {
        loaded.store.active.openclaw = None;
    }
    save_store(&loaded.store)?;
    Ok(ProviderSnapshotDto {
        providers: loaded.store.providers,
        active: loaded.store.active,
        source: loaded.source,
        health_checks: load_health_checks()?,
        switch_history: load_switch_history(12)?,
    })
}

pub fn switch_provider(provider_id: String, app: String) -> Result<ProviderSnapshotDto, String> {
    let mut loaded = load_or_initialize_store()?;
    let provider = loaded
        .store
        .providers
        .iter()
        .find(|candidate| candidate.id == provider_id)
        .cloned()
        .ok_or_else(|| format!("Provider '{provider_id}' not found"))?;

    if !provider.supports_app(&app) {
        return Err(format!("Provider '{}' is not enabled for {}", provider.name, app));
    }

    apply_provider_to_app(&provider, &app)?;

    match app.as_str() {
        "claude" => loaded.store.active.claude = Some(provider.id.clone()),
        "codex" => loaded.store.active.codex = Some(provider.id.clone()),
        "gemini" => loaded.store.active.gemini = Some(provider.id.clone()),
        "opencode" => loaded.store.active.opencode = Some(provider.id.clone()),
        "openclaw" => loaded.store.active.openclaw = Some(provider.id.clone()),
        _ => return Err(format!("Unsupported provider target: {app}")),
    }

    save_store(&loaded.store)?;
    record_switch_event(&provider.id, &provider.name, &app)?;
    Ok(ProviderSnapshotDto {
        providers: loaded.store.providers,
        active: loaded.store.active,
        source: loaded.source,
        health_checks: load_health_checks()?,
        switch_history: load_switch_history(12)?,
    })
}

pub fn check_provider_health(provider_id: String) -> Result<ProviderHealthDto, String> {
    let loaded = load_or_initialize_store()?;
    let provider = loaded
        .store
        .providers
        .iter()
        .find(|candidate| candidate.id == provider_id)
        .cloned()
        .ok_or_else(|| format!("Provider '{provider_id}' not found"))?;

    let target = normalize_provider_target(&provider)?;
    let started_at = Instant::now();
    let client = Client::builder()
        .timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("Build HTTP client failed: {error}"))?;

    match client.head(&target).send() {
        Ok(response) => {
            let status = response.status().as_u16();
            Ok(ProviderHealthDto {
                provider_id: provider.id,
                status: if response.status().is_success() || response.status().is_redirection() || response.status().as_u16() == 401 || response.status().as_u16() == 403 {
                    "healthy".to_string()
                } else {
                    "degraded".to_string()
                },
                latency_ms: Some(started_at.elapsed().as_millis() as u64),
                http_status: Some(status),
                check_mode: "http-head".to_string(),
                target,
                message: format!("HTTP HEAD returned status {status}"),
                checked_at: now_timestamp(),
            })
        }
        Err(error) => Ok(ProviderHealthDto {
            provider_id: provider.id,
            status: "unreachable".to_string(),
            latency_ms: None,
            http_status: None,
            check_mode: "http-head".to_string(),
            target,
            message: error.to_string(),
            checked_at: now_timestamp(),
        }),
    }
    .and_then(|health| {
        save_health_check(&health)?;
        Ok(health)
    })
}

fn normalize_provider_target(provider: &ProviderRecord) -> Result<String, String> {
    let base_url = provider.base_url.trim();
    if base_url.is_empty() {
        return Err(format!("Provider '{}' has no base URL", provider.name));
    }

    if base_url.contains("://") {
        Ok(base_url.trim_end_matches('/').to_string())
    } else {
        Ok(format!("https://{}", base_url.trim_end_matches('/')))
    }
}

fn now_timestamp() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}