use crate::ai_platform::domain::mcp::McpServerRecord;
use crate::ai_platform::interfaces::dto::mcp::{McpAppSyncStatusDto, McpSyncResultDto};
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

pub fn sync_all_mcp(servers: &[McpServerRecord]) -> Result<McpSyncResultDto, String> {
    let mut synced_apps = Vec::new();
    let mut errors = Vec::new();
    let mut app_results = Vec::new();

    if let Err(error) = sync_claude_mcp(servers) {
        errors.push(format!("Claude: {error}"));
        app_results.push(error_sync_status("claude", servers, error));
    } else {
        synced_apps.push("claude".to_string());
        app_results.push(inspect_app_sync_status("claude", servers));
    }

    if let Err(error) = sync_codex_mcp(servers) {
        errors.push(format!("Codex: {error}"));
        app_results.push(error_sync_status("codex", servers, error));
    } else {
        synced_apps.push("codex".to_string());
        app_results.push(inspect_app_sync_status("codex", servers));
    }

    if let Err(error) = sync_gemini_mcp(servers) {
        errors.push(format!("Gemini: {error}"));
        app_results.push(error_sync_status("gemini", servers, error));
    } else {
        synced_apps.push("gemini".to_string());
        app_results.push(inspect_app_sync_status("gemini", servers));
    }

    if let Err(error) = sync_opencode_mcp(servers) {
        errors.push(format!("OpenCode: {error}"));
        app_results.push(error_sync_status("opencode", servers, error));
    } else {
        synced_apps.push("opencode".to_string());
        app_results.push(inspect_app_sync_status("opencode", servers));
    }

    if errors.is_empty() {
        Ok(McpSyncResultDto {
            status: "ok".to_string(),
            message: format!("Synced {} MCP target(s)", synced_apps.len()),
            synced_apps,
            app_results,
        })
    } else {
        Ok(McpSyncResultDto {
            status: "partial".to_string(),
            message: errors.join("; "),
            synced_apps,
            app_results,
        })
    }
}

pub fn inspect_sync_statuses(servers: &[McpServerRecord]) -> Vec<McpAppSyncStatusDto> {
    ["claude", "codex", "gemini", "opencode"]
        .into_iter()
        .map(|app| inspect_app_sync_status(app, servers))
        .collect()
}

pub fn templates() -> Vec<McpServerRecord> {
    vec![
        McpServerRecord {
            id: "tpl-filesystem".into(),
            name: "filesystem".into(),
            command: "npx".into(),
            args: vec!["-y".into(), "@modelcontextprotocol/server-filesystem".into(), ".".into()],
            env: Default::default(),
            sync_apps: crate::ai_platform::domain::mcp::McpSyncApps {
                claude: true,
                codex: true,
                gemini: true,
                opencode: true,
            },
            enabled: true,
        },
        McpServerRecord {
            id: "tpl-github".into(),
            name: "github".into(),
            command: "npx".into(),
            args: vec!["-y".into(), "@modelcontextprotocol/server-github".into()],
            env: [("GITHUB_PERSONAL_ACCESS_TOKEN".to_string(), "".to_string())]
                .into_iter()
                .collect(),
            sync_apps: crate::ai_platform::domain::mcp::McpSyncApps {
                claude: true,
                codex: true,
                gemini: true,
                opencode: true,
            },
            enabled: true,
        },
        McpServerRecord {
            id: "tpl-memory".into(),
            name: "memory".into(),
            command: "npx".into(),
            args: vec!["-y".into(), "@modelcontextprotocol/server-memory".into()],
            env: Default::default(),
            sync_apps: crate::ai_platform::domain::mcp::McpSyncApps {
                claude: true,
                codex: true,
                gemini: true,
                opencode: true,
            },
            enabled: true,
        },
    ]
}

fn build_mcp_json(servers: &[McpServerRecord], app: &str) -> Value {
    let mut map = Map::new();
    for server in servers {
        if !server.enabled {
            continue;
        }
        let include = match app {
            "claude" => server.sync_apps.claude,
            "codex" => server.sync_apps.codex,
            "gemini" => server.sync_apps.gemini,
            "opencode" => server.sync_apps.opencode,
            _ => false,
        };
        if !include {
            continue;
        }
        let mut server_obj = Map::new();
        server_obj.insert("command".into(), serde_json::json!(server.command));
        if !server.args.is_empty() {
            server_obj.insert("args".into(), serde_json::json!(server.args));
        }
        if !server.env.is_empty() {
            server_obj.insert("env".into(), serde_json::json!(server.env));
        }
        map.insert(server.name.clone(), Value::Object(server_obj));
    }
    Value::Object(map)
}

fn sync_claude_mcp(servers: &[McpServerRecord]) -> Result<(), String> {
    let path = home_dir().join(".claude").join("settings.json");
    let mut settings = read_json_or_default(&path)?;
    settings["mcpServers"] = build_mcp_json(servers, "claude");
    write_json(&path, &settings)
}

fn sync_gemini_mcp(servers: &[McpServerRecord]) -> Result<(), String> {
    let path = home_dir().join(".gemini").join("settings.json");
    let mut settings = read_json_or_default(&path)?;
    settings["mcpServers"] = build_mcp_json(servers, "gemini");
    write_json(&path, &settings)
}

fn sync_opencode_mcp(servers: &[McpServerRecord]) -> Result<(), String> {
    let path = home_dir().join(".opencode").join("config.json");
    let mut config = read_json_or_default(&path)?;
    config["mcpServers"] = build_mcp_json(servers, "opencode");
    write_json(&path, &config)
}

fn sync_codex_mcp(servers: &[McpServerRecord]) -> Result<(), String> {
    let config_path = home_dir().join(".codex").join("config.toml");
    let existing = if config_path.exists() {
        fs::read_to_string(&config_path).unwrap_or_default()
    } else {
        String::new()
    };

    let mut lines: Vec<String> = Vec::new();
    let mut in_mcp_section = false;
    for line in existing.lines() {
        if line.starts_with("[mcp_servers") {
            in_mcp_section = true;
            continue;
        }
        if in_mcp_section && line.starts_with('[') {
            in_mcp_section = false;
        }
        if !in_mcp_section {
            lines.push(line.to_string());
        }
    }

    for server in servers {
        if !server.enabled || !server.sync_apps.codex {
            continue;
        }
        lines.push(String::new());
        lines.push(format!("[mcp_servers.{}]", server.name));
        lines.push(format!("command = \"{}\"", server.command));
        if !server.args.is_empty() {
            let args = server
                .args
                .iter()
                .map(|arg| format!("\"{}\"", arg))
                .collect::<Vec<_>>()
                .join(", ");
            lines.push(format!("args = [{}]", args));
        }
        if !server.env.is_empty() {
            lines.push(format!("[mcp_servers.{}.env]", server.name));
            for (key, value) in &server.env {
                lines.push(format!("{} = \"{}\"", key, value));
            }
        }
    }

    atomic_write_text(&config_path, &lines.join("\n"))
}

fn inspect_app_sync_status(app: &str, servers: &[McpServerRecord]) -> McpAppSyncStatusDto {
    let targeted_servers = targeted_servers_for(app, servers);
    let path = config_path_for(app);
    let exists = path.exists();

    if targeted_servers == 0 {
        return McpAppSyncStatusDto {
            app: app.to_string(),
            status: "idle".to_string(),
            config_path: path.to_string_lossy().to_string(),
            exists,
            targeted_servers,
            synced_servers: 0,
            message: "No enabled MCP servers target this app".to_string(),
        };
    }

    if !exists {
        return McpAppSyncStatusDto {
            app: app.to_string(),
            status: "missing".to_string(),
            config_path: path.to_string_lossy().to_string(),
            exists,
            targeted_servers,
            synced_servers: 0,
            message: "Config file does not exist yet".to_string(),
        };
    }

    let synced_servers = match app {
        "claude" | "gemini" | "opencode" => inspect_json_sync_status(app, servers, &path),
        "codex" => inspect_codex_sync_status(servers, &path),
        _ => Ok(0),
    };

    match synced_servers {
        Ok(synced_servers) => {
            let status = if synced_servers == targeted_servers {
                "synced"
            } else if synced_servers == 0 {
                "drift"
            } else {
                "partial"
            };
            let message = match status {
                "synced" => format!("All {targeted_servers} targeted server(s) are present on disk"),
                "partial" => format!("{synced_servers}/{targeted_servers} targeted server(s) matched on disk"),
                _ => "Targeted servers are not fully reflected on disk".to_string(),
            };

            McpAppSyncStatusDto {
                app: app.to_string(),
                status: status.to_string(),
                config_path: path.to_string_lossy().to_string(),
                exists,
                targeted_servers,
                synced_servers,
                message,
            }
        }
        Err(error) => McpAppSyncStatusDto {
            app: app.to_string(),
            status: "error".to_string(),
            config_path: path.to_string_lossy().to_string(),
            exists,
            targeted_servers,
            synced_servers: 0,
            message: error,
        },
    }
}

fn error_sync_status(app: &str, servers: &[McpServerRecord], error: String) -> McpAppSyncStatusDto {
    McpAppSyncStatusDto {
        app: app.to_string(),
        status: "error".to_string(),
        config_path: config_path_for(app).to_string_lossy().to_string(),
        exists: config_path_for(app).exists(),
        targeted_servers: targeted_servers_for(app, servers),
        synced_servers: 0,
        message: error,
    }
}

fn targeted_servers_for(app: &str, servers: &[McpServerRecord]) -> usize {
    servers
        .iter()
        .filter(|server| {
            server.enabled
                && match app {
                    "claude" => server.sync_apps.claude,
                    "codex" => server.sync_apps.codex,
                    "gemini" => server.sync_apps.gemini,
                    "opencode" => server.sync_apps.opencode,
                    _ => false,
                }
        })
        .count()
}

fn inspect_json_sync_status(app: &str, servers: &[McpServerRecord], path: &Path) -> Result<usize, String> {
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let parsed: Value = serde_json::from_str(&content).map_err(|error| error.to_string())?;
    let mcp_servers = parsed
        .get("mcpServers")
        .and_then(Value::as_object)
        .ok_or("mcpServers object is missing".to_string())?;

    let mut matched = 0;
    for server in servers.iter().filter(|server| {
        server.enabled
            && match app {
                "claude" => server.sync_apps.claude,
                "gemini" => server.sync_apps.gemini,
                "opencode" => server.sync_apps.opencode,
                _ => false,
            }
    }) {
        let Some(entry) = mcp_servers.get(&server.name).and_then(Value::as_object) else {
            continue;
        };
        let command_matches = entry
            .get("command")
            .and_then(Value::as_str)
            .map(|value| value == server.command)
            .unwrap_or(false);
        let args_matches = entry
            .get("args")
            .map(|value| value == &serde_json::json!(server.args))
            .unwrap_or(server.args.is_empty());
        let env_matches = entry
            .get("env")
            .map(|value| value == &serde_json::json!(server.env))
            .unwrap_or(server.env.is_empty());
        if command_matches && args_matches && env_matches {
            matched += 1;
        }
    }
    Ok(matched)
}

fn inspect_codex_sync_status(servers: &[McpServerRecord], path: &Path) -> Result<usize, String> {
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let mut matched = 0;
    for server in servers.iter().filter(|server| server.enabled && server.sync_apps.codex) {
        let section = format!("[mcp_servers.{}]", server.name);
        let command_line = format!("command = \"{}\"", server.command);
        if content.contains(&section) && content.contains(&command_line) {
            matched += 1;
        }
    }
    Ok(matched)
}

fn config_path_for(app: &str) -> PathBuf {
    match app {
        "claude" => home_dir().join(".claude").join("settings.json"),
        "codex" => home_dir().join(".codex").join("config.toml"),
        "gemini" => home_dir().join(".gemini").join("settings.json"),
        "opencode" => home_dir().join(".opencode").join("config.json"),
        _ => home_dir().join(format!(".{app}")),
    }
}

fn read_json_or_default(path: &Path) -> Result<Value, String> {
    if path.exists() {
        let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
        Ok(serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({})))
    } else {
        Ok(serde_json::json!({}))
    }
}

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    let content = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    atomic_write_text(path, &content)
}

fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

fn atomic_write_text(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temp = path.with_extension("tmp");
    fs::write(&temp, content).map_err(|error| error.to_string())?;
    #[cfg(windows)]
    {
        let _ = fs::remove_file(path);
    }
    fs::rename(&temp, path).map_err(|error| error.to_string())?;
    Ok(())
}