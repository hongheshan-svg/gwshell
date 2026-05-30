use crate::session::{SessionConfig, SessionGroup};
use rusqlite::{params, Connection, OptionalExtension};
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
        // Enable WAL mode for faster reads and concurrent access
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")
            .map_err(|e| e.to_string())?;
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
            );
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
        )
        .map_err(|e| e.to_string())
    }

    // ---- Sessions ----

    pub fn save_session(&self, config: &SessionConfig) -> Result<(), String> {
        // Encrypt secret fields before they touch disk.
        let mut config = config.clone();
        crate::crypto::encrypt_session_secrets(&mut config);
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let data = serde_json::to_string(&config).map_err(|e| e.to_string())?;
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
            match serde_json::from_str::<SessionConfig>(&data) {
                Ok(mut config) => {
                    // Decrypt secrets so the in-memory cache / frontend / connect
                    // path see usable plaintext.
                    crate::crypto::decrypt_session_secrets(&mut config);
                    sessions.push(config);
                }
                // Don't silently drop a corrupt/incompatible row without a trace.
                Err(e) => eprintln!("[gwshell] skipping unreadable session row: {}", e),
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
        // Encrypt secrets of any embedded session configs too.
        let mut group = group.clone();
        crate::crypto::encrypt_group_secrets(&mut group);
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let data = serde_json::to_string(&group).map_err(|e| e.to_string())?;
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
            match serde_json::from_str::<SessionGroup>(&data) {
                Ok(mut group) => {
                    crate::crypto::decrypt_group_secrets(&mut group);
                    groups.push(group);
                }
                Err(e) => eprintln!("[gwshell] skipping unreadable group row: {}", e),
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

    // ---- App Settings ----

    pub fn save_app_settings(&self, value: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('main', ?1)",
            params![value],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn load_app_settings(&self) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT value FROM app_settings WHERE key = 'main'")
            .map_err(|e| e.to_string())?;
        let result = stmt
            .query_row([], |row| row.get::<_, String>(0))
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(result)
    }

    // ---- Storage Operations ----

    pub fn export_sessions_json(&self) -> Result<String, String> {
        let mut sessions = self.get_sessions()?;
        // Never write plaintext secrets to a user-chosen export file. Passwords
        // and TOTP secrets are stripped; re-enter them after importing.
        for s in &mut sessions {
            s.password = None;
            s.jump_password = None;
            s.proxy_password = None;
            s.totp_code = None;
        }
        serde_json::to_string_pretty(&sessions).map_err(|e| e.to_string())
    }

    pub fn import_sessions_json(&self, json: &str) -> Result<usize, String> {
        let sessions: Vec<SessionConfig> =
            serde_json::from_str(json).map_err(|e| e.to_string())?;
        let count = sessions.len();
        for session in &sessions {
            self.save_session(session)?;
        }
        Ok(count)
    }

    pub fn clear_all_sessions(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM sessions", [])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}
