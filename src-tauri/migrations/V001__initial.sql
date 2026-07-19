-- V001: Initial schema (captures the v0.5.5 state as the baseline).
-- Idempotent: uses CREATE TABLE IF NOT EXISTS so existing v0.5.5 databases
-- are detected by the bootstrap helper and marked as V001-applied without
-- re-running destructive DDL.

CREATE TABLE IF NOT EXISTS sessions (
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
CREATE INDEX IF NOT EXISTS idx_agent_audit_target
    ON agent_audit(target_session_id, started_at DESC);

-- command_history with the v0.5.5 columns folded in (they were ALTER-added
-- in the old init_tables; V001 creates them inline for fresh installs).
CREATE TABLE IF NOT EXISTS command_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    command TEXT NOT NULL,
    ts INTEGER NOT NULL,
    cwd TEXT NOT NULL DEFAULT '',
    scope TEXT NOT NULL DEFAULT '',
    session_type TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_cmd_ts ON command_history(ts DESC);

CREATE TABLE IF NOT EXISTS snippets (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
);
