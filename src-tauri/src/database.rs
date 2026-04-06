use crate::session::{SessionConfig, SessionGroup};
use rusqlite::{params, Connection};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn new() -> Result<Self, String> {
        let db_path = Self::db_path().ok_or("Cannot determine data directory")?;
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.init_tables()?;
        Ok(db)
    }

    fn db_path() -> Option<PathBuf> {
        dirs::data_local_dir().map(|d| d.join("gwshell").join("gwshell.db"))
    }

    fn init_tables(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS groups (
                name TEXT PRIMARY KEY,
                data TEXT NOT NULL
            );",
        )
        .map_err(|e| e.to_string())
    }

    // ---- Sessions ----

    pub fn save_session(&self, config: &SessionConfig) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let data = serde_json::to_string(config).map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO sessions (id, data) VALUES (?1, ?2)",
            params![config.id, data],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_sessions(&self) -> Result<Vec<SessionConfig>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT data FROM sessions")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                let data: String = row.get(0)?;
                Ok(data)
            })
            .map_err(|e| e.to_string())?;
        let mut sessions = Vec::new();
        for row in rows {
            let data = row.map_err(|e| e.to_string())?;
            if let Ok(config) = serde_json::from_str::<SessionConfig>(&data) {
                sessions.push(config);
            }
        }
        Ok(sessions)
    }

    pub fn delete_session(&self, session_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM sessions WHERE id = ?1", params![session_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ---- Groups ----

    pub fn save_group(&self, group: &SessionGroup) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let data = serde_json::to_string(group).map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO groups (name, data) VALUES (?1, ?2)",
            params![group.name, data],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_groups(&self) -> Result<Vec<SessionGroup>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT data FROM groups")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                let data: String = row.get(0)?;
                Ok(data)
            })
            .map_err(|e| e.to_string())?;
        let mut groups = Vec::new();
        for row in rows {
            let data = row.map_err(|e| e.to_string())?;
            if let Ok(group) = serde_json::from_str::<SessionGroup>(&data) {
                groups.push(group);
            }
        }
        Ok(groups)
    }

    pub fn delete_group(&self, name: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM groups WHERE name = ?1", params![name])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}
