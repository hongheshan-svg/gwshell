use crate::session::SessionConfig;
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

    #[cfg(test)]
    pub fn new_in_memory_for_tests() -> Result<Self, String> {
        let conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
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
            CREATE TABLE IF NOT EXISTS agent_audit (
                id TEXT PRIMARY KEY,
                agent_session_id TEXT NOT NULL,
                target_session_id TEXT NOT NULL,
                started_at INTEGER NOT NULL,
                finished_at INTEGER,
                objective TEXT NOT NULL,
                status TEXT NOT NULL,
                report_json TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_agent_audit_target ON agent_audit(target_session_id, started_at DESC);
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

    pub fn save_app_setting_key(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn load_app_setting_key(&self, key: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT value FROM app_settings WHERE key = ?1")
            .map_err(|e| e.to_string())?;
        let result = stmt
            .query_row(params![key], |row| row.get::<_, String>(0))
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(result)
    }

    pub fn delete_app_setting_key(&self, key: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM app_settings WHERE key = ?1", params![key])
            .map_err(|e| e.to_string())?;
        Ok(())
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
        conn.execute("DELETE FROM app_settings WHERE key = 'vault_verifier'", [])
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
        let sessions: Vec<SessionConfig> = serde_json::from_str(json).map_err(|e| e.to_string())?;
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

    // ---- Agent Audit ----

    pub fn save_agent_audit_raw(
        &self,
        id: &str,
        agent_session_id: &str,
        target_session_id: &str,
        started_at: i64,
        finished_at: Option<i64>,
        objective: &str,
        status: &str,
        report_json: &str,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO agent_audit
             (id, agent_session_id, target_session_id, started_at, finished_at, objective, status, report_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                id,
                agent_session_id,
                target_session_id,
                started_at,
                finished_at,
                objective,
                status,
                report_json
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_agent_audits_raw(&self, target_session_id: &str) -> Result<Vec<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT report_json FROM agent_audit
                 WHERE target_session_id = ?1
                 ORDER BY started_at DESC
                 LIMIT 50",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![target_session_id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut reports = Vec::new();
        for row in rows {
            match row {
                Ok(report) => reports.push(report),
                Err(e) => eprintln!("[gwshell] skipping unreadable agent audit row: {}", e),
            }
        }
        Ok(reports)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::audit::save_audit;
    use crate::agent::types::{AgentAuditRecord, AgentSessionStatus};

    fn audit_record(id: &str, target_session_id: &str, started_at: i64) -> AgentAuditRecord {
        AgentAuditRecord {
            id: id.to_string(),
            agent_session_id: format!("agent-{}", id),
            target_session_id: target_session_id.to_string(),
            started_at,
            finished_at: Some(started_at + 10),
            objective: format!("objective {}", id),
            status: AgentSessionStatus::Completed,
            report_json: format!(r#"{{"summary":"{}"}}"#, id),
        }
    }

    #[test]
    fn agent_audit_save_and_list_round_trips_json_for_target_session() {
        let db = Database::new_in_memory_for_tests().unwrap();
        let expected = audit_record("newer", "target-1", 200);
        let older = audit_record("older", "target-1", 100);
        let other_target = audit_record("other", "target-2", 300);

        save_audit(&db, &older).unwrap();
        save_audit(&db, &other_target).unwrap();
        save_audit(&db, &expected).unwrap();

        let rows = db.list_agent_audits_raw("target-1").unwrap();
        assert_eq!(rows.len(), 2);

        let records = rows
            .iter()
            .map(|row| serde_json::from_str::<AgentAuditRecord>(row).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(records[0].id, expected.id);
        assert_eq!(records[0].target_session_id, "target-1");
        assert_eq!(records[0].report_json, expected.report_json);
        assert_eq!(records[1].id, older.id);
        assert!(records
            .iter()
            .all(|record| record.target_session_id == "target-1"));
    }

    #[test]
    fn list_agent_audits_raw_returns_newest_first_and_limits_to_50() {
        let db = Database::new_in_memory_for_tests().unwrap();

        for idx in 0..55 {
            let record = audit_record(&format!("audit-{idx}"), "target-1", idx);
            save_audit(&db, &record).unwrap();
        }

        let rows = db.list_agent_audits_raw("target-1").unwrap();
        assert_eq!(rows.len(), 50);

        let ids = rows
            .iter()
            .map(|row| serde_json::from_str::<AgentAuditRecord>(row).unwrap().id)
            .collect::<Vec<_>>();
        assert_eq!(ids.first().map(String::as_str), Some("audit-54"));
        assert_eq!(ids.last().map(String::as_str), Some("audit-5"));
    }
}
