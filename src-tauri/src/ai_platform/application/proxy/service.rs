use crate::ai_platform::domain::provider::{ActiveProviderSet, ProviderRecord};
use crate::ai_platform::domain::proxy::{ProxyAppSwitchesRecord, ProxyControlPlaneRecord};
use crate::ai_platform::infrastructure::db::providers_db::load_or_initialize_store;
use crate::ai_platform::infrastructure::fs::proxy_store::{load_store, save_store};
use crate::ai_platform::interfaces::dto::proxy::{
    ProxyAppStatusDto, ProxyQueueItemDto, ProxySnapshotDto,
};

const APPS: [&str; 5] = ["claude", "codex", "gemini", "opencode", "openclaw"];

pub fn get_proxy_snapshot() -> Result<ProxySnapshotDto, String> {
    let store = load_store()?;
    build_snapshot(store)
}

pub fn save_proxy_config(config: ProxyControlPlaneRecord) -> Result<ProxySnapshotDto, String> {
    validate_config(&config)?;
    save_store(&config)?;
    build_snapshot(config)
}

fn build_snapshot(config: ProxyControlPlaneRecord) -> Result<ProxySnapshotDto, String> {
    let provider_store = load_or_initialize_store()?;
    let queue = build_queue(&provider_store.store.providers, &provider_store.store.active);
    let app_statuses = APPS
        .into_iter()
        .map(|app| app_status(app, &config, &provider_store.store.active, &queue))
        .collect::<Vec<_>>();

    Ok(ProxySnapshotDto {
        config,
        app_statuses,
        queue,
        source: format!("control-plane + {}", provider_store.source),
    })
}

fn validate_config(config: &ProxyControlPlaneRecord) -> Result<(), String> {
    if config.server.listen_host.trim().is_empty() {
        return Err("Proxy listen host is required".to_string());
    }
    if config.server.listen_port < 1024 {
        return Err("Proxy port must be at least 1024".to_string());
    }
    if config.server.connect_timeout_seconds == 0 {
        return Err("Connect timeout must be at least 1 second".to_string());
    }
    if config.server.request_timeout_seconds == 0 {
        return Err("Request timeout must be at least 1 second".to_string());
    }
    if config.failover_policy.consecutive_failures == 0 {
        return Err("Consecutive failure threshold must be at least 1".to_string());
    }
    if config.failover_policy.cooldown_seconds == 0 {
        return Err("Cooldown seconds must be at least 1".to_string());
    }
    Ok(())
}

fn build_queue(providers: &[ProviderRecord], active: &ActiveProviderSet) -> Vec<ProxyQueueItemDto> {
    let mut items = Vec::new();
    for app in APPS {
        let active_provider_id = active_provider_id(active, app);
        let mut candidates = providers
            .iter()
            .filter(|provider| provider.enabled && provider.supports_app(app))
            .cloned()
            .collect::<Vec<_>>();
        candidates.sort_by(|left, right| {
            let left_priority = left.failover_priority.unwrap_or(9_999);
            let right_priority = right.failover_priority.unwrap_or(9_999);
            left_priority
                .cmp(&right_priority)
                .then_with(|| left.name.cmp(&right.name))
        });

        for (index, provider) in candidates.into_iter().enumerate() {
            let requires_proxy = provider_requires_proxy(&provider);
            let provider_id = provider.id.clone();
            let is_active = active_provider_id == Some(provider_id.as_str());
            items.push(ProxyQueueItemDto {
                app: app.to_string(),
                provider_id,
                provider_name: provider.name,
                provider_type: provider.provider_type,
                priority: provider.failover_priority.unwrap_or((index as i32 + 1) * 10),
                is_active,
                requires_proxy,
            });
        }
    }
    items
}

fn app_status(
    app: &str,
    config: &ProxyControlPlaneRecord,
    active: &ActiveProviderSet,
    queue: &[ProxyQueueItemDto],
) -> ProxyAppStatusDto {
    let queue_items = queue.iter().filter(|item| item.app == app).collect::<Vec<_>>();
    let active_provider_id = active_provider_id(active, app).map(str::to_string);
    let takeover_enabled = flag_for_app(&config.takeover, app);
    let failover_enabled = config.failover_policy.enabled && flag_for_app(&config.failover, app);
    let requires_proxy = queue_items.iter().any(|item| item.requires_proxy);

    let (status, detail) = if queue_items.is_empty() {
        (
            "warning".to_string(),
            "当前没有可用于该 app 的启用 provider。".to_string(),
        )
    } else if takeover_enabled && !config.server.running {
        (
            "danger".to_string(),
            "已开启接管，但本地代理当前未运行。".to_string(),
        )
    } else if failover_enabled && queue_items.len() < 2 {
        (
            "warning".to_string(),
            "已开启 failover，但队列中不足两个 provider。".to_string(),
        )
    } else if requires_proxy && !takeover_enabled {
        (
            "warning".to_string(),
            "存在依赖代理的 provider，但该 app 尚未接管到本地代理。".to_string(),
        )
    } else if takeover_enabled {
        (
            "success".to_string(),
            format!(
                "通过 {}:{} 接管 {}，当前队列深度 {}。",
                config.server.listen_host,
                config.server.listen_port,
                app,
                queue_items.len()
            ),
        )
    } else {
        (
            "neutral".to_string(),
            "当前未接管，仍由各 app 直接访问其目标 provider。".to_string(),
        )
    };

    ProxyAppStatusDto {
        app: app.to_string(),
        running: config.server.running,
        takeover_enabled,
        failover_enabled,
        queue_depth: queue_items.len() as u32,
        active_provider_id,
        requires_proxy,
        status,
        detail,
    }
}

fn active_provider_id<'a>(active: &'a ActiveProviderSet, app: &str) -> Option<&'a str> {
    match app {
        "claude" => active.claude.as_deref(),
        "codex" => active.codex.as_deref(),
        "gemini" => active.gemini.as_deref(),
        "opencode" => active.opencode.as_deref(),
        "openclaw" => active.openclaw.as_deref(),
        _ => None,
    }
}

fn flag_for_app(record: &ProxyAppSwitchesRecord, app: &str) -> bool {
    match app {
        "claude" => record.claude,
        "codex" => record.codex,
        "gemini" => record.gemini,
        "opencode" => record.opencode,
        "openclaw" => record.openclaw,
        _ => false,
    }
}

fn provider_requires_proxy(provider: &ProviderRecord) -> bool {
    matches!(provider.provider_type.as_str(), "openai-compatible" | "copilot" | "openai-chat" | "openai-responses")
}