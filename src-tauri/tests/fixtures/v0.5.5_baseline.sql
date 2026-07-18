-- src-tauri/tests/fixtures/v0.5.5_baseline.sql
-- Represents the schema as created by the old database.rs::init_tables (pre-refinery).
-- Used by tests/migrations.rs to verify the bootstrap helper correctly detects
-- an existing v0.5.5 database and marks V001 as applied without data loss.

CREATE TABLE sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE groups (name TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE agent_audit (
    id TEXT PRIMARY KEY,
    agent_session_id TEXT NOT NULL,
    target_session_id TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    objective TEXT NOT NULL,
    status TEXT NOT NULL,
    report_json TEXT NOT NULL
);
CREATE INDEX idx_agent_audit_target ON agent_audit(target_session_id, started_at DESC);
CREATE TABLE command_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    command TEXT NOT NULL,
    ts INTEGER NOT NULL,
    cwd TEXT NOT NULL DEFAULT '',
    scope TEXT NOT NULL DEFAULT '',
    session_type TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_cmd_ts ON command_history(ts DESC);
CREATE TABLE snippets (id TEXT PRIMARY KEY, data TEXT NOT NULL);

-- Sample data to verify round-trip preservation:
INSERT INTO sessions (id, data) VALUES ('test-1', '{"name":"test"}');
INSERT INTO app_settings (key, value) VALUES ('main', '{}');
INSERT INTO command_history (command, ts, cwd, scope, session_type) VALUES ('ls -la', 1234567890, '/tmp', 'global', 'localshell');
