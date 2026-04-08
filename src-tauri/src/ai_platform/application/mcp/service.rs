use crate::ai_platform::domain::mcp::McpServerRecord;
use crate::ai_platform::infrastructure::config_bridge::mcp_sync;
use crate::ai_platform::infrastructure::db::mcp_db::{load_or_initialize_servers, save_servers};
use crate::ai_platform::interfaces::dto::mcp::{
    McpServerValidationDto, McpSnapshotDto, McpSyncResultDto,
};

pub fn get_mcp_snapshot() -> Result<McpSnapshotDto, String> {
    let loaded = load_or_initialize_servers()?;
    Ok(McpSnapshotDto {
        validations: validate_servers(&loaded.servers),
        sync_statuses: mcp_sync::inspect_sync_statuses(&loaded.servers),
        servers: loaded.servers,
        templates: mcp_sync::templates(),
        source: loaded.source,
    })
}

pub fn save_mcp_server(server: McpServerRecord) -> Result<McpSnapshotDto, String> {
    let mut loaded = load_or_initialize_servers()?;
    if let Some(existing) = loaded.servers.iter_mut().find(|current| current.id == server.id) {
        *existing = server;
    } else {
        loaded.servers.push(server);
    }
    save_servers(&loaded.servers)?;
    let _ = mcp_sync::sync_all_mcp(&loaded.servers)?;
    Ok(McpSnapshotDto {
        validations: validate_servers(&loaded.servers),
        sync_statuses: mcp_sync::inspect_sync_statuses(&loaded.servers),
        servers: loaded.servers,
        templates: mcp_sync::templates(),
        source: loaded.source,
    })
}

pub fn delete_mcp_server(server_id: String) -> Result<McpSnapshotDto, String> {
    let mut loaded = load_or_initialize_servers()?;
    loaded.servers.retain(|server| server.id != server_id);
    save_servers(&loaded.servers)?;
    let _ = mcp_sync::sync_all_mcp(&loaded.servers)?;
    Ok(McpSnapshotDto {
        validations: validate_servers(&loaded.servers),
        sync_statuses: mcp_sync::inspect_sync_statuses(&loaded.servers),
        servers: loaded.servers,
        templates: mcp_sync::templates(),
        source: loaded.source,
    })
}

pub fn sync_mcp_servers() -> Result<McpSyncResultDto, String> {
    let loaded = load_or_initialize_servers()?;
    mcp_sync::sync_all_mcp(&loaded.servers)
}

fn validate_servers(servers: &[McpServerRecord]) -> Vec<McpServerValidationDto> {
    servers
        .iter()
        .map(|server| {
            let mut issues = Vec::new();
            let name = server.name.trim();

            if name.is_empty() {
                issues.push("Server name is required".to_string());
            }
            if server.command.trim().is_empty() {
                issues.push("Command is required".to_string());
            }
            if !server.sync_apps.claude && !server.sync_apps.codex && !server.sync_apps.gemini && !server.sync_apps.opencode {
                issues.push("At least one sync target should be enabled".to_string());
            }
            if !name.is_empty() && !name.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.')) {
                issues.push("Name should only use letters, numbers, dash, underscore or dot".to_string());
            }
            if !name.is_empty()
                && servers
                    .iter()
                    .filter(|candidate| candidate.id != server.id)
                    .any(|candidate| candidate.name.trim().eq_ignore_ascii_case(name))
            {
                issues.push("Server name must be unique".to_string());
            }

            let status = if issues.is_empty() {
                "ok"
            } else if issues.iter().any(|issue| {
                issue == "Server name is required"
                    || issue == "Command is required"
                    || issue == "Server name must be unique"
            }) {
                "error"
            } else {
                "warning"
            };

            McpServerValidationDto {
                server_id: server.id.clone(),
                status: status.to_string(),
                issues,
            }
        })
        .collect()
}