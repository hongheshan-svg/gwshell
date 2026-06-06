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
            );
            CREATE TABLE IF NOT EXISTS command_history (
                id      INTEGER PRIMARY KEY AUTOINCREMENT,
                command TEXT NOT NULL,
                ts      INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_cmd_ts ON command_history(ts DESC);
            CREATE TABLE IF NOT EXISTS snippets (
                id   TEXT PRIMARY KEY,
                data TEXT NOT NULL
            );",
        )
        .map_err(|e| e.to_string())?;

        // Idempotent migration: add scoping columns to command_history if absent.
        // ALTER errors with "duplicate column name" on later runs — ignored.
        for col in ["cwd", "scope", "session_type"] {
            let _ = conn.execute(
                &format!(
                    "ALTER TABLE command_history ADD COLUMN {} TEXT NOT NULL DEFAULT ''",
                    col
                ),
                [],
            );
        }
        Ok(())
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

    // ---- Vault Verifier (Argon2id PHC string for the app-lock passphrase) ----
    // Reuses the app_settings key/value table under key 'vault_verifier'. This is
    // independent of the key='main' settings blob above. Only the Argon2id hash
    // (a PHC string) is ever stored here — never the plaintext passphrase.

    pub fn set_vault_verifier(&self, phc: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('vault_verifier', ?1)",
            params![phc],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_vault_verifier(&self) -> Option<String> {
        let conn = self.conn.lock().ok()?;
        let mut stmt = conn
            .prepare("SELECT value FROM app_settings WHERE key = 'vault_verifier'")
            .ok()?;
        stmt.query_row([], |row| row.get::<_, String>(0))
            .optional()
            .ok()
            .flatten()
    }

    pub fn clear_vault_verifier(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM app_settings WHERE key = 'vault_verifier'",
            [],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
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

    // ---- Command History ----

    pub fn load_command_history(&self, limit: u32) -> Vec<crate::history::HistoryEntry> {
        match self.conn.lock() {
            Ok(conn) => crate::history::load_history(&conn, limit),
            Err(_) => vec![],
        }
    }

    pub fn save_command_history(&self, command: &str, cwd: &str, scope: &str, session_type: &str) {
        if let Ok(conn) = self.conn.lock() {
            crate::history::save_command(&conn, command, cwd, scope, session_type);
        }
    }

    // ---- Snippets ----

    pub fn save_snippet(&self, id: &str, data: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO snippets (id, data) VALUES (?1, ?2)",
            params![id, data],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_snippets(&self) -> Result<Vec<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT data FROM snippets")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                let data: String = row.get(0)?;
                Ok(data)
            })
            .map_err(|e| e.to_string())?;
        let mut snippets = Vec::new();
        for row in rows {
            match row {
                Ok(data) => snippets.push(data),
                Err(e) => eprintln!("[gwshell] skipping unreadable snippet row: {}", e),
            }
        }
        Ok(snippets)
    }

    pub fn delete_snippet(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM snippets WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}
