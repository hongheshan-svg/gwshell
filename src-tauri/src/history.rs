use rusqlite::{params, Connection};
use std::time::{SystemTime, UNIX_EPOCH};

/// Returns commands ordered newest-first (most recent at index 0).
/// Deduplicates by keeping only the most-recent occurrence of each command.
pub fn load_history(conn: &Connection, limit: u32) -> Vec<String> {
    let sql = "SELECT command FROM command_history \
               GROUP BY command ORDER BY MAX(ts) DESC LIMIT ?1";
    let mut stmt = match conn.prepare(sql) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    let result = match stmt.query_map(params![limit], |row| row.get::<_, String>(0)) {
        Ok(iter) => iter.filter_map(|r| r.ok()).collect(),
        Err(_) => vec![],
    };
    result
}

pub fn save_command(conn: &Connection, command: &str) {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let _ = conn.execute(
        "INSERT INTO command_history (command, ts) VALUES (?1, ?2)",
        params![command, ts],
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
