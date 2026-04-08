use crate::ai_platform::domain::agent::{
    AgentAssignmentRecord, AgentCategoryRecord, AgentTemplateRecord,
};
use crate::ai_platform::infrastructure::db::providers_db::load_or_initialize_store;
use crate::ai_platform::infrastructure::fs::agents_store::{load_store, save_store};
use crate::ai_platform::interfaces::dto::agents::{
    AgentProviderOptionDto, AgentSnapshotItemDto, AgentsSnapshotDto,
};

pub fn get_agents_snapshot() -> Result<AgentsSnapshotDto, String> {
    let store = load_store()?;
    build_snapshot(store)
}

pub fn set_agent_enabled(agent_key: String, enabled: bool) -> Result<AgentsSnapshotDto, String> {
    let mut store = load_store()?;
    if enabled {
        store.disabled_agent_keys.retain(|current| current != &agent_key);
    } else if !store.disabled_agent_keys.iter().any(|current| current == &agent_key) {
        store.disabled_agent_keys.push(agent_key);
    }
    save_store(&store)?;
    build_snapshot(store)
}

pub fn save_agent_assignment(assignment: AgentAssignmentRecord) -> Result<AgentsSnapshotDto, String> {
    let mut store = load_store()?;
    if let Some(existing) = store
        .assignments
        .iter_mut()
        .find(|current| current.agent_key == assignment.agent_key)
    {
        *existing = assignment;
    } else {
        store.assignments.push(assignment);
    }
    save_store(&store)?;
    build_snapshot(store)
}

pub fn set_routing_mode(routing_mode: String) -> Result<AgentsSnapshotDto, String> {
    let mut store = load_store()?;
    store.routing_mode = routing_mode;
    save_store(&store)?;
    build_snapshot(store)
}

fn build_snapshot(store: crate::ai_platform::infrastructure::fs::agents_store::AgentsStore) -> Result<AgentsSnapshotDto, String> {
    let categories = categories();
    let templates = templates();
    let provider_options = provider_options()?;

    let agents = templates
        .into_iter()
        .map(|template| {
            let assignment = store
                .assignments
                .iter()
                .find(|current| current.agent_key == template.key)
                .cloned()
                .unwrap_or(AgentAssignmentRecord {
                    agent_key: template.key.clone(),
                    provider_id: None,
                    model: None,
                    timeout_seconds: Some(template.default_timeout_seconds),
                });

            AgentSnapshotItemDto {
                key: template.key.clone(),
                name: template.name,
                category: template.category,
                description: template.description,
                enabled: !store
                    .disabled_agent_keys
                    .iter()
                    .any(|disabled| disabled == &template.key),
                assignment,
            }
        })
        .collect();

    Ok(AgentsSnapshotDto {
        categories,
        agents,
        provider_options,
        routing_mode: store.routing_mode,
        source: "agent-catalog".to_string(),
    })
}

fn provider_options() -> Result<Vec<AgentProviderOptionDto>, String> {
    let loaded = load_or_initialize_store()?;
    let mut options = loaded
        .store
        .providers
        .into_iter()
        .filter(|provider| provider.enabled && provider.apps.openclaw)
        .filter_map(|provider| {
            let model = provider.models.openclaw.as_ref()?.model.clone()?;
            Some(AgentProviderOptionDto {
                provider_id: provider.id,
                provider_name: provider.name,
                model,
            })
        })
        .collect::<Vec<_>>();
    options.sort_by(|left, right| left.provider_name.cmp(&right.provider_name));
    Ok(options)
}

fn categories() -> Vec<AgentCategoryRecord> {
    vec![
        AgentCategoryRecord {
            id: "orchestration".to_string(),
            name: "Orchestration".to_string(),
            description: "负责规划、路由和任务拆分的主控 agents".to_string(),
        },
        AgentCategoryRecord {
            id: "delivery".to_string(),
            name: "Delivery".to_string(),
            description: "面向实现、修复和提交流程的执行 agents".to_string(),
        },
        AgentCategoryRecord {
            id: "analysis".to_string(),
            name: "Analysis".to_string(),
            description: "用于研究、评审和架构判断的咨询 agents".to_string(),
        },
    ]
}

fn templates() -> Vec<AgentTemplateRecord> {
    vec![
        AgentTemplateRecord {
            key: "atlas".to_string(),
            name: "Atlas".to_string(),
            category: "orchestration".to_string(),
            description: "主 orchestrator，负责 TODO、分发和全局节奏控制。".to_string(),
            default_timeout_seconds: 120,
        },
        AgentTemplateRecord {
            key: "hephaestus".to_string(),
            name: "Hephaestus".to_string(),
            category: "delivery".to_string(),
            description: "面向落地执行的 deep worker，适合复杂编码与修复。".to_string(),
            default_timeout_seconds: 180,
        },
        AgentTemplateRecord {
            key: "oracle".to_string(),
            name: "Oracle".to_string(),
            category: "analysis".to_string(),
            description: "架构与调试顾问，擅长读代码、建模和风险判断。".to_string(),
            default_timeout_seconds: 90,
        },
        AgentTemplateRecord {
            key: "scribe".to_string(),
            name: "Scribe".to_string(),
            category: "delivery".to_string(),
            description: "用于 prompts、spec、说明文档和总结的辅助 agent。".to_string(),
            default_timeout_seconds: 60,
        },
    ]
}