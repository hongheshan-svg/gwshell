use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

// ============================================================================
// Data structures
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServer {
    pub id: String,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default, rename = "syncApps")]
    pub sync_apps: McpSyncApps,
    #[serde(default)]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct McpSyncApps {
    #[serde(default)]
    pub claude: bool,
    #[serde(default)]
    pub codex: bool,
    #[serde(default)]
    pub gemini: bool,
    #[serde(default)]
    pub opencode: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct McpStore {
    pub servers: Vec<McpServer>,
}

// ============================================================================
// Persistence
// ============================================================================

fn gwshell_mcp_path() -> Option<PathBuf> {
    dirs::data_local_dir().map(|d| d.join("gwshell").join("mcp_servers.json"))
}

fn load_mcp_store() -> McpStore {
    gwshell_mcp_path()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_mcp_store(store: &McpStore) -> Result<(), String> {
    let path = gwshell_mcp_path().ok_or("Cannot determine data directory")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(store).map_err(|e| format!("Serialize failed: {}", e))?;
    fs::write(&tmp, &json).map_err(|e| format!("Write failed: {}", e))?;
    #[cfg(windows)]
    { let _ = fs::remove_file(&path); }
    fs::rename(&tmp, &path).map_err(|e| format!("Rename failed: {}", e))?;
    Ok(())
}

fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

fn atomic_write_text(path: &Path, content: &str) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, content).map_err(|e| format!("Write tmp failed: {}", e))?;
    #[cfg(windows)]
    { let _ = fs::remove_file(path); }
    fs::rename(&tmp, path).map_err(|e| format!("Rename failed: {}", e))?;
    Ok(())
}

// ============================================================================
// Sync MCP configs to each tool
// ============================================================================

fn build_mcp_json(servers: &[McpServer], app: &str) -> serde_json::Value {
    let mut map = serde_json::Map::new();
    for s in servers {
        if !s.enabled { continue; }
        let include = match app {
            "claude" => s.sync_apps.claude,
            "codex" => s.sync_apps.codex,
            "gemini" => s.sync_apps.gemini,
            "opencode" => s.sync_apps.opencode,
            _ => false,
        };
        if !include { continue; }
        let mut server_obj = serde_json::Map::new();
        server_obj.insert("command".into(), serde_json::json!(s.command));
        if !s.args.is_empty() {
            server_obj.insert("args".into(), serde_json::json!(s.args));
        }
        if !s.env.is_empty() {
            server_obj.insert("env".into(), serde_json::json!(s.env));
        }
        map.insert(s.name.clone(), serde_json::Value::Object(server_obj));
    }
    serde_json::Value::Object(map)
}

fn sync_claude_mcp(servers: &[McpServer]) -> Result<(), String> {
    let claude_dir = home_dir().join(".claude");
    fs::create_dir_all(&claude_dir).map_err(|e| format!("Create .claude dir: {}", e))?;
    let path = claude_dir.join("settings.json");
    let mut settings: serde_json::Value = if path.exists() {
        let c = fs::read_to_string(&path).map_err(|e| format!("Read: {}", e))?;
        serde_json::from_str(&c).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    settings["mcpServers"] = build_mcp_json(servers, "claude");
    let json = serde_json::to_string_pretty(&settings).map_err(|e| format!("Serialize: {}", e))?;
    atomic_write_text(&path, &json)
}

fn sync_gemini_mcp(servers: &[McpServer]) -> Result<(), String> {
    let gemini_dir = home_dir().join(".gemini");
    fs::create_dir_all(&gemini_dir).map_err(|e| format!("Create .gemini dir: {}", e))?;
    let path = gemini_dir.join("settings.json");
    let mut settings: serde_json::Value = if path.exists() {
        let c = fs::read_to_string(&path).map_err(|e| format!("Read: {}", e))?;
        serde_json::from_str(&c).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    settings["mcpServers"] = build_mcp_json(servers, "gemini");
    let json = serde_json::to_string_pretty(&settings).map_err(|e| format!("Serialize: {}", e))?;
    atomic_write_text(&path, &json)
}

fn sync_opencode_mcp(servers: &[McpServer]) -> Result<(), String> {
    let opencode_dir = home_dir().join(".opencode");
    fs::create_dir_all(&opencode_dir).map_err(|e| format!("Create .opencode dir: {}", e))?;
    let path = opencode_dir.join("config.json");
    let mut config: serde_json::Value = if path.exists() {
        let c = fs::read_to_string(&path).map_err(|e| format!("Read: {}", e))?;
        serde_json::from_str(&c).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    config["mcpServers"] = build_mcp_json(servers, "opencode");
    let json = serde_json::to_string_pretty(&config).map_err(|e| format!("Serialize: {}", e))?;
    atomic_write_text(&path, &json)
}

/// Codex uses TOML [mcp_servers] section — we append it
fn sync_codex_mcp(servers: &[McpServer]) -> Result<(), String> {
    let codex_dir = home_dir().join(".codex");
    fs::create_dir_all(&codex_dir).map_err(|e| format!("Create .codex dir: {}", e))?;
    let config_path = codex_dir.join("config.toml");

    // Read existing config, remove old [mcp_servers] section
    let existing = if config_path.exists() {
        fs::read_to_string(&config_path).unwrap_or_default()
    } else {
        String::new()
    };

    // Remove existing [mcp_servers.*] sections
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

    // Append MCP sections
    for s in servers {
        if !s.enabled || !s.sync_apps.codex { continue; }
        lines.push(String::new());
        lines.push(format!("[mcp_servers.{}]", s.name));
        lines.push(format!("command = \"{}\"", s.command));
        if !s.args.is_empty() {
            let args_str = s.args.iter()
                .map(|a| format!("\"{}\"", a))
                .collect::<Vec<_>>()
                .join(", ");
            lines.push(format!("args = [{}]", args_str));
        }
        for (k, v) in &s.env {
            lines.push(format!("[mcp_servers.{}.env]", s.name));
            lines.push(format!("{} = \"{}\"", k, v));
            break; // write all env in one section
        }
        if s.env.len() > 1 {
            // Already wrote section header above
            for (k, v) in s.env.iter().skip(1) {
                lines.push(format!("{} = \"{}\"", k, v));
            }
        }
    }

    let content = lines.join("\n");
    atomic_write_text(&config_path, &content)
}

fn sync_all_mcp(servers: &[McpServer]) -> Result<(), String> {
    let mut errors = Vec::new();
    if let Err(e) = sync_claude_mcp(servers) { errors.push(format!("Claude: {}", e)); }
    if let Err(e) = sync_codex_mcp(servers) { errors.push(format!("Codex: {}", e)); }
    if let Err(e) = sync_gemini_mcp(servers) { errors.push(format!("Gemini: {}", e)); }
    if let Err(e) = sync_opencode_mcp(servers) { errors.push(format!("OpenCode: {}", e)); }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

// ============================================================================
// Tauri commands
// ============================================================================

#[tauri::command]
pub fn list_mcp_servers() -> Result<Vec<McpServer>, String> {
    Ok(load_mcp_store().servers)
}

#[tauri::command]
pub fn save_mcp_server(server: McpServer) -> Result<(), String> {
    let mut store = load_mcp_store();
    if let Some(existing) = store.servers.iter_mut().find(|s| s.id == server.id) {
        *existing = server;
    } else {
        store.servers.push(server);
    }
    save_mcp_store(&store)?;
    sync_all_mcp(&store.servers)
}

#[tauri::command]
pub fn delete_mcp_server(server_id: String) -> Result<(), String> {
    let mut store = load_mcp_store();
    store.servers.retain(|s| s.id != server_id);
    save_mcp_store(&store)?;
    sync_all_mcp(&store.servers)
}

#[tauri::command]
pub fn sync_mcp_servers() -> Result<(), String> {
    let store = load_mcp_store();
    sync_all_mcp(&store.servers)
}

/// Get MCP server templates
#[tauri::command]
pub fn get_mcp_templates() -> Vec<McpServer> {
    vec![
        McpServer {
            id: "tpl-filesystem".into(),
            name: "filesystem".into(),
            command: "npx".into(),
            args: vec!["-y".into(), "@modelcontextprotocol/server-filesystem".into(), ".".into()],
            env: HashMap::new(),
            sync_apps: McpSyncApps { claude: true, codex: true, gemini: true, opencode: true },
            enabled: true,
        },
        McpServer {
            id: "tpl-github".into(),
            name: "github".into(),
            command: "npx".into(),
            args: vec!["-y".into(), "@modelcontextprotocol/server-github".into()],
            env: {
                let mut m = HashMap::new();
                m.insert("GITHUB_PERSONAL_ACCESS_TOKEN".into(), "".into());
                m
            },
            sync_apps: McpSyncApps { claude: true, codex: true, gemini: true, opencode: true },
            enabled: true,
        },
        McpServer {
            id: "tpl-postgres".into(),
            name: "postgres".into(),
            command: "npx".into(),
            args: vec!["-y".into(), "@modelcontextprotocol/server-postgres".into(), "postgresql://localhost/mydb".into()],
            env: HashMap::new(),
            sync_apps: McpSyncApps { claude: true, codex: false, gemini: true, opencode: true },
            enabled: true,
        },
        McpServer {
            id: "tpl-memory".into(),
            name: "memory".into(),
            command: "npx".into(),
            args: vec!["-y".into(), "@modelcontextprotocol/server-memory".into()],
            env: HashMap::new(),
            sync_apps: McpSyncApps { claude: true, codex: true, gemini: true, opencode: true },
            enabled: true,
        },
    ]
}
