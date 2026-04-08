use crate::ai_platform::domain::mcp::McpServerRecord;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct LoadedMcpStore {
    pub servers: Vec<McpServerRecord>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct LegacyMcpStore {
    #[serde(default)]
    servers: Vec<McpServerRecord>,
}

pub fn load_or_initialize_servers() -> Result<LoadedMcpStore, String> {
    let conn = open_connection()?;
    init_tables(&conn)?;

    let servers = load_servers(&conn)?;
    if !servers.is_empty() {
        return Ok(LoadedMcpStore {
            servers,
            source: "sqlite-store".to_string(),
        });
    }

    if let Some(legacy) = read_legacy_store()? {
        save_servers(&legacy)?;
        return Ok(LoadedMcpStore {
            servers: legacy,
            source: "legacy-import".to_string(),
        });
    }

    Ok(LoadedMcpStore {
        servers: Vec::new(),
        source: "empty-store".to_string(),
    })
}

pub fn save_servers(servers: &[McpServerRecord]) -> Result<(), String> {
    let mut conn = open_connection()?;
    init_tables(&conn)?;

    let transaction = conn.transaction().map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM ai_mcp_servers", [])
        .map_err(|error| error.to_string())?;

    for server in servers {
        let payload = serde_json::to_string(server).map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO ai_mcp_servers (id, data) VALUES (?1, ?2)",
                params![server.id, payload],
            )
            .map_err(|error| error.to_string())?;
    }

    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

fn load_servers(conn: &Connection) -> Result<Vec<McpServerRecord>, String> {
    let mut stmt = conn
        .prepare("SELECT data FROM ai_mcp_servers ORDER BY id")
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;

    let mut servers = Vec::new();
    for row in rows {
        let payload = row.map_err(|error| error.to_string())?;
        let server = serde_json::from_str(&payload).map_err(|error| error.to_string())?;
        servers.push(server);
    }
    Ok(servers)
}

fn read_legacy_store() -> Result<Option<Vec<McpServerRecord>>, String> {
    let Some(path) = legacy_store_path() else {
        return Ok(None);
    };

    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let store = serde_json::from_str::<LegacyMcpStore>(&content).map_err(|error| error.to_string())?;
    Ok(Some(store.servers))
}

fn open_connection() -> Result<Connection, String> {
    let db_path = db_path().ok_or("Cannot determine AI platform data directory")?;
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let conn = Connection::open(&db_path).map_err(|error| error.to_string())?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")
        .map_err(|error| error.to_string())?;
    Ok(conn)
}

fn init_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS ai_mcp_servers (
            id TEXT PRIMARY KEY,
            data TEXT NOT NULL
        );",
    )
    .map_err(|error| error.to_string())
}

fn db_path() -> Option<PathBuf> {
    dirs::data_local_dir().map(|dir| dir.join("gwshell").join("ai-platform").join("ai.db"))
}

fn legacy_store_path() -> Option<PathBuf> {
    dirs::data_local_dir().map(|dir| dir.join("gwshell").join("mcp_servers.json"))
}