use rusqlite::{params, Connection};
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};

/// One distinct command, aggregated by (command, scope, cwd).
#[derive(Serialize)]
pub struct HistoryEntry {
    pub command: String,
    pub cwd: String,
    pub scope: String,
    pub session_type: String,
    pub count: i64,     // number of executions in this (scope, cwd)
    pub last_used: i64, // latest unix-seconds timestamp
}

/// Returns aggregated history entries, newest-first, capped at `limit`.
pub fn load_history(conn: &Connection, limit: u32) -> Vec<HistoryEntry> {
    let sql = "SELECT command, cwd, scope, session_type, COUNT(*) AS cnt, MAX(ts) AS last_used \
               FROM command_history \
               GROUP BY command, scope, cwd, session_type \
               ORDER BY last_used DESC LIMIT ?1";
    let mut stmt = match conn.prepare(sql) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    let rows = stmt.query_map(params![limit], |row| {
        Ok(HistoryEntry {
            command: row.get(0)?,
            cwd: row.get(1)?,
            scope: row.get(2)?,
            session_type: row.get(3)?,
            count: row.get(4)?,
            last_used: row.get(5)?,
        })
    });
    match rows {
        Ok(iter) => iter.filter_map(|r| r.ok()).collect(),
        Err(_) => vec![],
    }
}

pub fn save_command(conn: &Connection, command: &str, cwd: &str, scope: &str, session_type: &str) {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let _ = conn.execute(
        "INSERT INTO command_history (command, ts, cwd, scope, session_type) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![command, ts, cwd, scope, session_type],
    );
    // Cap the table at 10 000 rows; delete the oldest surplus.
    let _ = conn.execute(
        "DELETE FROM command_history WHERE id IN (
             SELECT id FROM command_history ORDER BY ts ASC
             LIMIT MAX(0, (SELECT COUNT(*) FROM command_history) - 10000)
         )",
        [],
    );
}
