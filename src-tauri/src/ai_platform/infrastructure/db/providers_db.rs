use crate::ai_platform::infrastructure::fs::providers_store::{
    read_legacy_store, starter_store, ProviderStore,
};
use crate::ai_platform::interfaces::dto::providers::{
    ProviderHealthDto, ProviderSwitchHistoryDto,
};
use rusqlite::{params, Connection};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct LoadedProviderStore {
    pub store: ProviderStore,
    pub source: String,
}

pub fn load_or_initialize_store() -> Result<LoadedProviderStore, String> {
    let conn = open_connection()?;
    init_tables(&conn)?;

    let existing = load_store(&conn)?;
    if !existing.providers.is_empty() || has_active_bindings(&existing) {
        return Ok(LoadedProviderStore {
            store: existing,
            source: "sqlite-store".to_string(),
        });
    }

    if let Some(legacy) = read_legacy_store()? {
        save_store(&legacy)?;
        return Ok(LoadedProviderStore {
            store: legacy,
            source: "legacy-import".to_string(),
        });
    }

    let starter = starter_store();
    save_store(&starter)?;
    Ok(LoadedProviderStore {
        store: starter,
        source: "starter-seed".to_string(),
    })
}

pub fn save_store(store: &ProviderStore) -> Result<(), String> {
    let mut conn = open_connection()?;
    init_tables(&conn)?;

    let transaction = conn.transaction().map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM ai_providers", [])
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM ai_active_bindings", [])
        .map_err(|error| error.to_string())?;

    for provider in &store.providers {
        let payload = serde_json::to_string(provider).map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO ai_providers (id, data) VALUES (?1, ?2)",
                params![provider.id, payload],
            )
            .map_err(|error| error.to_string())?;
    }

    for (app, provider_id) in [
        ("claude", store.active.claude.as_deref()),
        ("codex", store.active.codex.as_deref()),
        ("gemini", store.active.gemini.as_deref()),
        ("opencode", store.active.opencode.as_deref()),
        ("openclaw", store.active.openclaw.as_deref()),
    ] {
        if let Some(provider_id) = provider_id {
            transaction
                .execute(
                    "INSERT INTO ai_active_bindings (app, provider_id) VALUES (?1, ?2)",
                    params![app, provider_id],
                )
                .map_err(|error| error.to_string())?;
        }
    }

    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

fn load_store(conn: &Connection) -> Result<ProviderStore, String> {
    let mut providers = Vec::new();
    let mut stmt = conn
        .prepare("SELECT data FROM ai_providers ORDER BY id")
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;

    for row in rows {
        let payload = row.map_err(|error| error.to_string())?;
        let provider = serde_json::from_str(&payload).map_err(|error| error.to_string())?;
        providers.push(provider);
    }

    let mut active = crate::ai_platform::domain::provider::ActiveProviderSet::default();
    let mut stmt = conn
        .prepare("SELECT app, provider_id FROM ai_active_bindings")
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?;

    for row in rows {
        let (app, provider_id) = row.map_err(|error| error.to_string())?;
        match app.as_str() {
            "claude" => active.claude = Some(provider_id),
            "codex" => active.codex = Some(provider_id),
            "gemini" => active.gemini = Some(provider_id),
            "opencode" => active.opencode = Some(provider_id),
            "openclaw" => active.openclaw = Some(provider_id),
            _ => {}
        }
    }

    Ok(ProviderStore { providers, active })
}

fn open_connection() -> Result<Connection, String> {
    let db_path = db_path().ok_or("Cannot determine AI platform data directory")?;
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let conn = Connection::open(&db_path).map_err(|error| error.to_string())?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")
        .map_err(|error| error.to_string())?;
    Ok(conn)
}

fn init_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS ai_providers (
            id TEXT PRIMARY KEY,
            data TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ai_active_bindings (
            app TEXT PRIMARY KEY,
            provider_id TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ai_provider_health_checks (
            provider_id TEXT PRIMARY KEY,
            data TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ai_provider_switch_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider_id TEXT NOT NULL,
            app TEXT NOT NULL,
            data TEXT NOT NULL
        );",
    )
    .map_err(|error| error.to_string())
}

fn db_path() -> Option<PathBuf> {
    dirs::data_local_dir().map(|dir| dir.join("gwshell").join("ai-platform").join("ai.db"))
}

fn has_active_bindings(store: &ProviderStore) -> bool {
    store.active.claude.is_some()
        || store.active.codex.is_some()
        || store.active.gemini.is_some()
        || store.active.opencode.is_some()
        || store.active.openclaw.is_some()
}

pub fn load_health_checks() -> Result<Vec<ProviderHealthDto>, String> {
    let conn = open_connection()?;
    init_tables(&conn)?;

    let mut stmt = conn
        .prepare("SELECT data FROM ai_provider_health_checks")
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;

    let mut checks = Vec::new();
    for row in rows {
        let payload = row.map_err(|error| error.to_string())?;
        let check = serde_json::from_str(&payload).map_err(|error| error.to_string())?;
        checks.push(check);
    }
    checks.sort_by(|left: &ProviderHealthDto, right: &ProviderHealthDto| {
        right.checked_at.cmp(&left.checked_at)
    });
    Ok(checks)
}

pub fn save_health_check(health: &ProviderHealthDto) -> Result<(), String> {
    let conn = open_connection()?;
    init_tables(&conn)?;
    let payload = serde_json::to_string(health).map_err(|error| error.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO ai_provider_health_checks (provider_id, data) VALUES (?1, ?2)",
        params![health.provider_id, payload],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn load_switch_history(limit: usize) -> Result<Vec<ProviderSwitchHistoryDto>, String> {
    let conn = open_connection()?;
    init_tables(&conn)?;

    let mut stmt = conn
        .prepare("SELECT data FROM ai_provider_switch_history ORDER BY id DESC LIMIT ?1")
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map(params![limit as i64], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;

    let mut history = Vec::new();
    for row in rows {
        let payload = row.map_err(|error| error.to_string())?;
        let item = serde_json::from_str(&payload).map_err(|error| error.to_string())?;
        history.push(item);
    }
    Ok(history)
}

pub fn record_switch_event(provider_id: &str, provider_name: &str, app: &str) -> Result<(), String> {
    let conn = open_connection()?;
    init_tables(&conn)?;
    let event = ProviderSwitchHistoryDto {
        provider_id: provider_id.to_string(),
        provider_name: provider_name.to_string(),
        app: app.to_string(),
        switched_at: now_timestamp(),
    };
    let payload = serde_json::to_string(&event).map_err(|error| error.to_string())?;
    conn.execute(
        "INSERT INTO ai_provider_switch_history (provider_id, app, data) VALUES (?1, ?2, ?3)",
        params![provider_id, app, payload],
    )
    .map_err(|error| error.to_string())?;
    conn.execute(
        "DELETE FROM ai_provider_switch_history WHERE id NOT IN (
            SELECT id FROM ai_provider_switch_history ORDER BY id DESC LIMIT 40
        )",
        [],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn now_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}