# GWShell Agent Runtime Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working GWShell Agent Runtime vertical slice: encrypted AI provider settings, one SSH-backed Agent session, real-time log evidence, streaming model analysis, typed actions, risk-gated execution, verification, and audit persistence.

**Architecture:** Add a first-class backend `agent` subsystem beside SSH/metrics/docker/database, and a lazy frontend `components/Agent` feature with its own `agentStore`. The model never directly executes commands; it emits structured action requests that pass through deterministic redaction, risk, policy, tool execution, verification, and audit layers.

**Tech Stack:** Tauri 2 IPC/events, Rust/Tokio/russh/reqwest/rusqlite/serde, React/Vite/TypeScript/Zustand/i18next, existing `SshManager`, `Database`, and `crypto.rs`.

---

## Scope Check

The full Agent Runtime spec covers AI provider management, live logs, tool calls, approvals, verification, audit, runbooks, and future automatic maintenance. This plan implements the first shippable foundation only:

- One connected SSH host per Agent session.
- OpenAI-compatible streaming provider.
- One or more user-attached log/probe sources.
- Read-only actions can run from Agent.
- Mutating actions are proposed and require explicit approval.
- Verification and audit are implemented for executed actions.

Later plans should cover L3 policy auto-maintenance, runbook conversion, fleet/background mode, and richer SFTP/Docker mutation tools.

## File Structure

### Backend

- Create `src-tauri/src/agent/mod.rs`: module exports.
- Create `src-tauri/src/agent/types.rs`: serializable Agent structs shared by IPC/events.
- Create `src-tauri/src/agent/redaction.rs`: redacts secrets before storage/provider calls.
- Create `src-tauri/src/agent/risk.rs`: deterministic command/action risk classifier.
- Create `src-tauri/src/agent/provider.rs`: AI provider settings, encrypted API key helpers, OpenAI-compatible SSE client.
- Create `src-tauri/src/agent/prompt.rs`: fixed Agent system prompt and request builder.
- Create `src-tauri/src/agent/tools.rs`: typed tool registry over existing SSH exec and Agent stream handles.
- Create `src-tauri/src/agent/stream.rs`: bounded SSH exec stream/log-tail support.
- Create `src-tauri/src/agent/manager.rs`: active Agent session lifecycle, event emission, cancellation.
- Create `src-tauri/src/agent/audit.rs`: audit report persistence helpers.
- Modify `src-tauri/src/lib.rs`: register `mod agent`, add `agent_manager` to `AppState`, add IPC commands.
- Modify `src-tauri/src/database.rs`: add Agent tables and CRUD helpers.
- Modify `src-tauri/src/ssh/exec.rs`: expose bounded streaming exec helper, or call helper from `agent/stream.rs` using existing session handles.
- Modify `src-tauri/src/ssh/mod.rs`: expose `exec_stream` wrapper for Agent log tails.

### Frontend

- Create `src/types/agent.ts`: TypeScript mirror of Rust event/action/report types.
- Create `src/stores/agentStore.ts`: Agent panel state, session state, evidence, stream text, action queue.
- Create `src/lib/agentEvents.ts`: Tauri event subscription helpers.
- Create `src/components/Agent/AgentPanel.tsx`.
- Create `src/components/Agent/AgentObjective.tsx`.
- Create `src/components/Agent/AgentSources.tsx`.
- Create `src/components/Agent/AgentAnalysisStream.tsx`.
- Create `src/components/Agent/AgentEvidence.tsx`.
- Create `src/components/Agent/AgentActionQueue.tsx`.
- Create `src/components/Agent/AgentAuditTimeline.tsx`.
- Create `src/components/Agent/index.ts`.
- Create `src/components/Settings/AiSettingsSection.tsx`.
- Modify `src/App.tsx`: lazy-load Agent panel.
- Modify `src/stores/appStore.ts`: only add `agentPanelOpen`, `toggleAgentPanel`; keep live Agent state in `agentStore`.
- Modify `src/components/Settings/SettingsModal.tsx`: add Agent/AI nav item and render AI settings section.
- Modify `src/components/CommandPalette/commands.ts`: add "Open Agent" and "Start Agent on Active SSH".
- Modify `src/components/TitleBar/TitleBar.tsx`: add Agent panel toggle.
- Modify `src/i18n/locales/gwshell.zh.json` and `src/i18n/locales/gwshell.en.json`: Agent and AI settings strings.
- Modify `src/styles/global.css` or add `src/components/Agent/AgentPanel.css`: panel styles.

---

### Task 1: Backend Agent Types Skeleton

**Files:**
- Create: `src-tauri/src/agent/mod.rs`
- Create: `src-tauri/src/agent/types.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/agent/types.rs`

- [ ] **Step 1: Create the agent module exports**

Add `src-tauri/src/agent/mod.rs`:

```rust
pub mod types;
```

- [ ] **Step 2: Define serializable Agent types**

Add `src-tauri/src/agent/types.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentAutonomyLevel {
    Observe,
    Recommend,
    ConfirmedAct,
    PolicyAutoMaintain,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentRisk {
    ReadOnly,
    Low,
    Medium,
    High,
    Blocked,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentToolName {
    RunCommand,
    StreamLog,
    ReadFile,
    DockerLogs,
    RestartService,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSessionStart {
    pub target_session_id: String,
    pub objective: String,
    pub autonomy: AgentAutonomyLevel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSessionInfo {
    pub id: String,
    pub target_session_id: String,
    pub objective: String,
    pub autonomy: AgentAutonomyLevel,
    pub started_at: i64,
    pub status: AgentSessionStatus,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentSessionStatus {
    Running,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentEvidence {
    pub id: String,
    pub source: String,
    pub label: String,
    pub body: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentFinding {
    pub id: String,
    pub title: String,
    pub severity: String,
    pub confidence: String,
    pub evidence_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentToolCall {
    pub id: String,
    pub tool: AgentToolName,
    pub target_session_id: String,
    pub payload: serde_json::Value,
    pub risk: AgentRisk,
    pub reason: String,
    pub expected_result: Option<String>,
    pub verify: Option<Box<AgentToolCall>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentToolResult {
    pub call_id: String,
    pub ok: bool,
    pub output: String,
    pub error: Option<String>,
    pub verification: Option<Box<AgentToolResult>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentAnalysisUpdate {
    pub summary: String,
    pub findings: Vec<AgentFinding>,
    pub proposed_actions: Vec<AgentToolCall>,
    pub questions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentAuditRecord {
    pub id: String,
    pub agent_session_id: String,
    pub target_session_id: String,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub objective: String,
    pub status: AgentSessionStatus,
    pub report_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiProviderSettings {
    pub enabled: bool,
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub api_key_configured: bool,
    pub temperature: f32,
    pub max_input_chars: usize,
    pub request_timeout_secs: u64,
}

impl Default for AiProviderSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            provider: "openai_compatible".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
            model: "gpt-4.1-mini".to_string(),
            api_key_configured: false,
            temperature: 0.2,
            max_input_chars: 24_000,
            request_timeout_secs: 45,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ai_provider_defaults_are_openai_compatible_and_safe() {
        let s = AiProviderSettings::default();
        assert!(!s.enabled);
        assert_eq!(s.provider, "openai_compatible");
        assert_eq!(s.base_url, "https://api.openai.com/v1");
        assert!(!s.api_key_configured);
        assert_eq!(s.max_input_chars, 24_000);
    }

    #[test]
    fn tool_call_serializes_snake_case_risk_and_tool() {
        let call = AgentToolCall {
            id: "c1".into(),
            tool: AgentToolName::RunCommand,
            target_session_id: "s1".into(),
            payload: serde_json::json!({ "command": "df -hP" }),
            risk: AgentRisk::ReadOnly,
            reason: "inspect disk".into(),
            expected_result: None,
            verify: None,
        };
        let json = serde_json::to_string(&call).unwrap();
        assert!(json.contains("\"run_command\""));
        assert!(json.contains("\"read_only\""));
    }
}
```

- [ ] **Step 3: Register the Rust module**

Modify the top of `src-tauri/src/lib.rs`:

```rust
mod agent;
mod crypto;
mod database;
```

- [ ] **Step 4: Run type tests**

Run:

```bash
cd src-tauri
cargo test agent::types
```

Expected: both `agent::types` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/agent/mod.rs src-tauri/src/agent/types.rs src-tauri/src/lib.rs
git commit -m "feat: add agent runtime types"
```

### Task 2: Redaction And Risk Classifier

**Files:**
- Modify: `src-tauri/src/agent/mod.rs`
- Create: `src-tauri/src/agent/redaction.rs`
- Create: `src-tauri/src/agent/risk.rs`
- Test: `src-tauri/src/agent/redaction.rs`, `src-tauri/src/agent/risk.rs`

- [ ] **Step 1: Export modules**

Modify `src-tauri/src/agent/mod.rs`:

```rust
pub mod redaction;
pub mod risk;
pub mod types;
```

- [ ] **Step 2: Add redaction implementation**

Add `src-tauri/src/agent/redaction.rs`:

```rust
const MAX_EVIDENCE_BODY: usize = 32 * 1024;

pub fn cap_text(input: &str, max_chars: usize) -> String {
    let mut out = String::new();
    for ch in input.chars().take(max_chars) {
        out.push(ch);
    }
    if input.chars().count() > max_chars {
        out.push_str("\n[truncated]");
    }
    out
}

pub fn redact_secrets(input: &str) -> String {
    let mut out = Vec::new();
    let mut in_private_key = false;

    for line in input.lines() {
        let lower = line.to_ascii_lowercase();
        if line.contains("-----BEGIN ") && line.contains("PRIVATE KEY-----") {
            in_private_key = true;
            out.push("[redacted private key]".to_string());
            continue;
        }
        if in_private_key {
            if line.contains("-----END ") && line.contains("PRIVATE KEY-----") {
                in_private_key = false;
            }
            continue;
        }
        if lower.contains("authorization: bearer ") {
            out.push("Authorization: Bearer [redacted]".to_string());
        } else if lower.contains("api_key=") || lower.contains("apikey=") || lower.contains("token=") {
            out.push(redact_assignment_line(line));
        } else if lower.contains("password=") || lower.contains("passwd=") {
            out.push(redact_assignment_line(line));
        } else {
            out.push(line.to_string());
        }
    }

    cap_text(&out.join("\n"), MAX_EVIDENCE_BODY)
}

fn redact_assignment_line(line: &str) -> String {
    let mut s = line.to_string();
    for key in ["api_key", "apikey", "token", "password", "passwd"] {
        for sep in ["=", ":"] {
            let needle = format!("{}{}", key, sep);
            if let Some(idx) = s.to_ascii_lowercase().find(&needle) {
                let end = s[idx..]
                    .find(|c: char| c.is_whitespace() || c == '&')
                    .map(|off| idx + off)
                    .unwrap_or_else(|| s.len());
                s.replace_range(idx + needle.len()..end, "[redacted]");
            }
        }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_bearer_tokens_and_password_assignments() {
        let text = "Authorization: Bearer abc123\nDB password=secret\nurl?token=abc";
        let redacted = redact_secrets(text);
        assert!(redacted.contains("Bearer [redacted]"));
        assert!(redacted.contains("password=[redacted]"));
        assert!(redacted.contains("token=[redacted]"));
        assert!(!redacted.contains("abc123"));
        assert!(!redacted.contains("secret"));
    }

    #[test]
    fn redacts_private_key_blocks() {
        let text = "a\n-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n-----END OPENSSH PRIVATE KEY-----\nz";
        let redacted = redact_secrets(text);
        assert!(redacted.contains("[redacted private key]"));
        assert!(!redacted.contains("secret"));
        assert!(redacted.contains("z"));
    }
}
```

- [ ] **Step 3: Add risk classifier**

Add `src-tauri/src/agent/risk.rs`:

```rust
use super::types::{AgentRisk, AgentToolCall, AgentToolName};

pub fn classify_tool_call(call: &AgentToolCall) -> AgentRisk {
    match call.tool {
        AgentToolName::RunCommand => {
            let command = call
                .payload
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            classify_command(command)
        }
        AgentToolName::StreamLog | AgentToolName::ReadFile | AgentToolName::DockerLogs => {
            AgentRisk::ReadOnly
        }
        AgentToolName::RestartService => AgentRisk::Medium,
    }
}

pub fn classify_command(command: &str) -> AgentRisk {
    let c = command.trim().to_ascii_lowercase();
    if c.is_empty() {
        return AgentRisk::Blocked;
    }
    if c.contains("rm -rf /")
        || c.contains("mkfs")
        || c.contains("dd if=")
        || c.contains("passwd ")
        || c.contains("userdel ")
        || c.contains("chmod -r 777 /")
        || c.contains("iptables ")
        || c.contains("ufw ")
        || c.contains("firewall-cmd")
    {
        return AgentRisk::Blocked;
    }
    if c.starts_with("df ")
        || c == "df"
        || c.starts_with("free ")
        || c == "free"
        || c.starts_with("journalctl ")
        || c.starts_with("systemctl status ")
        || c.starts_with("ss ")
        || c.starts_with("ps ")
        || c.starts_with("docker logs ")
        || c.starts_with("docker ps")
        || c.starts_with("cat /proc/")
        || c.starts_with("tail ")
        || c.starts_with("grep ")
    {
        return AgentRisk::ReadOnly;
    }
    if c.starts_with("systemctl reload ") {
        return AgentRisk::Low;
    }
    if c.starts_with("systemctl restart ")
        || c.starts_with("docker restart ")
        || c.starts_with("kill ")
    {
        return AgentRisk::Medium;
    }
    if c.starts_with("rm ")
        || c.starts_with("truncate ")
        || c.starts_with("reboot")
        || c.starts_with("shutdown")
        || c.starts_with("systemctl stop ")
    {
        return AgentRisk::High;
    }
    AgentRisk::Medium
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_only_commands_are_read_only() {
        assert_eq!(classify_command("df -hP"), AgentRisk::ReadOnly);
        assert_eq!(classify_command("journalctl -u nginx -n 50"), AgentRisk::ReadOnly);
        assert_eq!(classify_command("docker logs --tail=100 web"), AgentRisk::ReadOnly);
    }

    #[test]
    fn dangerous_commands_are_blocked_or_high() {
        assert_eq!(classify_command("rm -rf /"), AgentRisk::Blocked);
        assert_eq!(classify_command("iptables -F"), AgentRisk::Blocked);
        assert_eq!(classify_command("rm /tmp/file"), AgentRisk::High);
        assert_eq!(classify_command("systemctl restart nginx"), AgentRisk::Medium);
    }
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
cd src-tauri
cargo test agent::redaction agent::risk
```

Expected: all redaction and risk tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/agent/mod.rs src-tauri/src/agent/redaction.rs src-tauri/src/agent/risk.rs
git commit -m "feat: add agent redaction and risk policy"
```

### Task 3: Agent Database And Encrypted AI Provider Settings

**Files:**
- Create: `src-tauri/src/agent/provider.rs`
- Modify: `src-tauri/src/agent/mod.rs`
- Modify: `src-tauri/src/database.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/agent/provider.rs`

- [ ] **Step 1: Export provider module**

Modify `src-tauri/src/agent/mod.rs`:

```rust
pub mod provider;
pub mod redaction;
pub mod risk;
pub mod types;
```

- [ ] **Step 2: Add database tables and helpers**

Modify `Database::init_tables()` in `src-tauri/src/database.rs` by adding these table definitions inside the existing `execute_batch` string:

```sql
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
```

Add generic settings helpers below `load_app_settings()`:

```rust
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
    stmt.query_row(params![key], |row| row.get::<_, String>(0))
        .optional()
        .map_err(|e| e.to_string())
}

pub fn delete_app_setting_key(&self, key: &str) -> Result<(), String> {
    let conn = self.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM app_settings WHERE key = ?1", params![key])
        .map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 3: Add provider settings persistence**

Add `src-tauri/src/agent/provider.rs`:

```rust
use super::types::AiProviderSettings;
use crate::{crypto, database::Database};

const SETTINGS_KEY: &str = "agent_ai_provider_settings";
const SECRET_KEY: &str = "agent_ai_provider_api_key";

pub fn load_settings(db: &Database) -> Result<AiProviderSettings, String> {
    let mut settings = match db.load_app_setting_key(SETTINGS_KEY)? {
        Some(raw) => serde_json::from_str::<AiProviderSettings>(&raw).unwrap_or_default(),
        None => AiProviderSettings::default(),
    };
    settings.api_key_configured = load_api_key(db)?.is_some();
    Ok(settings)
}

pub fn save_settings(db: &Database, mut settings: AiProviderSettings) -> Result<(), String> {
    settings.api_key_configured = load_api_key(db)?.is_some();
    let raw = serde_json::to_string(&settings).map_err(|e| e.to_string())?;
    db.save_app_setting_key(SETTINGS_KEY, &raw)
}

pub fn set_api_key(db: &Database, api_key: &str) -> Result<(), String> {
    let enc = crypto::encrypt_secret(api_key);
    db.save_app_setting_key(SECRET_KEY, &enc)
}

pub fn clear_api_key(db: &Database) -> Result<(), String> {
    db.delete_app_setting_key(SECRET_KEY)
}

pub fn load_api_key(db: &Database) -> Result<Option<String>, String> {
    let Some(raw) = db.load_app_setting_key(SECRET_KEY)? else {
        return Ok(None);
    };
    let key = crypto::decrypt_secret(&raw);
    if key.trim().is_empty() {
        Ok(None)
    } else {
        Ok(Some(key))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialized_settings_do_not_need_api_key_value() {
        let raw = serde_json::to_string(&AiProviderSettings::default()).unwrap();
        assert!(!raw.contains("sk-"));
        assert!(raw.contains("api_key_configured"));
    }
}
```

- [ ] **Step 4: Add IPC wrappers**

In `src-tauri/src/lib.rs`, add commands near settings commands:

```rust
#[tauri::command]
async fn load_ai_provider_settings(
    state: State<'_, Arc<AppState>>,
) -> Result<agent::types::AiProviderSettings, String> {
    agent::provider::load_settings(&state.db)
}

#[tauri::command]
async fn save_ai_provider_settings(
    settings: agent::types::AiProviderSettings,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    agent::provider::save_settings(&state.db, settings)
}

#[tauri::command]
async fn set_ai_provider_api_key(
    api_key: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    agent::provider::set_api_key(&state.db, &api_key)
}

#[tauri::command]
async fn clear_ai_provider_api_key(
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    agent::provider::clear_api_key(&state.db)
}
```

Register those commands in `tauri::generate_handler![...]`.

- [ ] **Step 5: Run checks**

Run:

```bash
cd src-tauri
cargo test agent::provider
cargo check
```

Expected: provider test passes and backend compiles.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/agent/provider.rs src-tauri/src/agent/mod.rs src-tauri/src/database.rs src-tauri/src/lib.rs
git commit -m "feat: persist agent ai provider settings"
```

### Task 4: OpenAI-Compatible Streaming Parser And Prompt Contract

**Files:**
- Create: `src-tauri/src/agent/prompt.rs`
- Modify: `src-tauri/src/agent/provider.rs`
- Modify: `src-tauri/src/agent/mod.rs`
- Test: `src-tauri/src/agent/provider.rs`, `src-tauri/src/agent/prompt.rs`

- [ ] **Step 1: Export prompt module**

Modify `src-tauri/src/agent/mod.rs`:

```rust
pub mod prompt;
pub mod provider;
pub mod redaction;
pub mod risk;
pub mod types;
```

- [ ] **Step 2: Add prompt builder**

Add `src-tauri/src/agent/prompt.rs`:

```rust
use super::types::{AgentEvidence, AgentFinding};

pub const AGENT_SYSTEM_PROMPT: &str = r#"You are operating inside GWShell Agent.
You cannot execute commands directly.
Every factual claim must cite evidence IDs.
Separate confirmed findings from hypotheses.
Ask for missing evidence instead of guessing.
Propose tool calls only from the allowed schema.
Prefer reversible, low-risk actions.
For high-risk actions, explain risk and ask for human approval.
Never request secrets, private keys, tokens, shell history, or full config dumps."#;

pub fn build_user_prompt(
    objective: &str,
    evidence: &[AgentEvidence],
    findings: &[AgentFinding],
) -> String {
    let evidence_json = serde_json::to_string(evidence).unwrap_or_else(|_| "[]".to_string());
    let findings_json = serde_json::to_string(findings).unwrap_or_else(|_| "[]".to_string());
    format!(
        "Objective:\n{}\n\nEvidence JSON:\n{}\n\nLocal rule findings JSON:\n{}\n\nReturn concise streamed analysis and a final JSON update.",
        objective, evidence_json, findings_json
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_prompt_blocks_direct_execution() {
        assert!(AGENT_SYSTEM_PROMPT.contains("cannot execute commands directly"));
        assert!(AGENT_SYSTEM_PROMPT.contains("evidence IDs"));
    }
}
```

- [ ] **Step 3: Add SSE chunk parser helpers**

Append to `src-tauri/src/agent/provider.rs`:

```rust
pub fn parse_openai_sse_text_delta(chunk: &str) -> Vec<String> {
    let mut deltas = Vec::new();
    for line in chunk.lines() {
        let Some(rest) = line.strip_prefix("data:") else {
            continue;
        };
        let data = rest.trim();
        if data == "[DONE]" || data.is_empty() {
            continue;
        }
        let Ok(json) = serde_json::from_str::<serde_json::Value>(data) else {
            continue;
        };
        if let Some(content) = json
            .get("choices")
            .and_then(|v| v.get(0))
            .and_then(|v| v.get("delta"))
            .and_then(|v| v.get("content"))
            .and_then(|v| v.as_str())
        {
            deltas.push(content.to_string());
        }
    }
    deltas
}

#[cfg(test)]
mod sse_tests {
    use super::*;

    #[test]
    fn parses_openai_text_deltas() {
        let chunk = "data: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}\n\ndata: [DONE]\n";
        assert_eq!(parse_openai_sse_text_delta(chunk), vec!["hello"]);
    }

    #[test]
    fn ignores_malformed_sse_lines() {
        let chunk = "event: x\ndata: not-json\ndata: {\"choices\":[{\"delta\":{}}]}\n";
        assert!(parse_openai_sse_text_delta(chunk).is_empty());
    }
}
```

- [ ] **Step 4: Run parser tests**

Run:

```bash
cd src-tauri
cargo test agent::provider::sse_tests agent::prompt
```

Expected: SSE and prompt tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/agent/prompt.rs src-tauri/src/agent/provider.rs src-tauri/src/agent/mod.rs
git commit -m "feat: add agent prompt and streaming parser"
```

### Task 5: Backend Agent Manager And Read-Only Tool Registry

**Files:**
- Create: `src-tauri/src/agent/tools.rs`
- Create: `src-tauri/src/agent/manager.rs`
- Modify: `src-tauri/src/agent/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/agent/tools.rs`

- [ ] **Step 1: Export manager and tools**

Modify `src-tauri/src/agent/mod.rs`:

```rust
pub mod manager;
pub mod prompt;
pub mod provider;
pub mod redaction;
pub mod risk;
pub mod tools;
pub mod types;
```

- [ ] **Step 2: Add read-only tool registry**

Add `src-tauri/src/agent/tools.rs`:

```rust
use super::redaction::redact_secrets;
use super::risk::classify_tool_call;
use super::types::{AgentRisk, AgentToolCall, AgentToolName, AgentToolResult};
use crate::ssh::SshManager;
use std::sync::Arc;
use tokio::time::{timeout, Duration};

pub async fn execute_tool(
    ssh: Arc<SshManager>,
    call: AgentToolCall,
) -> AgentToolResult {
    let actual_risk = classify_tool_call(&call);
    if actual_risk == AgentRisk::Blocked || actual_risk == AgentRisk::High {
        return AgentToolResult {
            call_id: call.id,
            ok: false,
            output: String::new(),
            error: Some(format!("blocked by policy: {:?}", actual_risk)),
            verification: None,
        };
    }

    match call.tool {
        AgentToolName::RunCommand => {
            let command = call
                .payload
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            match timeout(Duration::from_secs(20), ssh.ssh_exec(&call.target_session_id, command)).await {
                Ok(Ok(out)) => AgentToolResult {
                    call_id: call.id,
                    ok: true,
                    output: redact_secrets(&out),
                    error: None,
                    verification: None,
                },
                Ok(Err(e)) => AgentToolResult {
                    call_id: call.id,
                    ok: false,
                    output: String::new(),
                    error: Some(e),
                    verification: None,
                },
                Err(_) => AgentToolResult {
                    call_id: call.id,
                    ok: false,
                    output: String::new(),
                    error: Some("tool timed out".to_string()),
                    verification: None,
                },
            }
        }
        _ => AgentToolResult {
            call_id: call.id,
            ok: false,
            output: String::new(),
            error: Some("unsupported tool for this action path".to_string()),
            verification: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::types::{AgentToolCall, AgentToolName};

    #[test]
    fn high_risk_command_is_blocked_before_execution() {
        let call = AgentToolCall {
            id: "a1".into(),
            tool: AgentToolName::RunCommand,
            target_session_id: "s1".into(),
            payload: serde_json::json!({ "command": "rm -rf /" }),
            risk: AgentRisk::ReadOnly,
            reason: "bad".into(),
            expected_result: None,
            verify: None,
        };
        assert_eq!(classify_tool_call(&call), AgentRisk::Blocked);
    }
}
```

- [ ] **Step 3: Add minimal AgentManager**

Add `src-tauri/src/agent/manager.rs`:

```rust
use super::types::{AgentAutonomyLevel, AgentSessionInfo, AgentSessionStart, AgentSessionStatus};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

#[derive(Default)]
pub struct AgentManager {
    sessions: Mutex<HashMap<String, AgentSessionInfo>>,
}

impl AgentManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn start_session(&self, req: AgentSessionStart) -> AgentSessionInfo {
        let id = Uuid::new_v4().to_string();
        let info = AgentSessionInfo {
            id: id.clone(),
            target_session_id: req.target_session_id,
            objective: req.objective,
            autonomy: req.autonomy,
            started_at: now_secs(),
            status: AgentSessionStatus::Running,
        };
        self.sessions.lock().insert(id, info.clone());
        info
    }

    pub fn cancel_session(&self, agent_session_id: &str) -> bool {
        let mut sessions = self.sessions.lock();
        let Some(info) = sessions.get_mut(agent_session_id) else {
            return false;
        };
        info.status = AgentSessionStatus::Cancelled;
        true
    }
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manager_starts_and_cancels_session() {
        let manager = AgentManager::new();
        let info = manager.start_session(AgentSessionStart {
            target_session_id: "ssh1".into(),
            objective: "check nginx".into(),
            autonomy: AgentAutonomyLevel::Recommend,
        });
        assert_eq!(info.target_session_id, "ssh1");
        assert!(manager.cancel_session(&info.id));
    }
}
```

- [ ] **Step 4: Add AgentManager to AppState and IPC**

Modify `AppState` in `src-tauri/src/lib.rs`:

```rust
pub struct AppState {
    pub pty_manager: PtyManager,
    pub ssh_manager: Arc<SshManager>,
    pub serial_manager: SerialManager,
    pub sessions: Mutex<Vec<SessionConfig>>,
    pub db: Database,
    pub metrics: metrics::MetricsManager,
    pub agent_manager: Arc<agent::manager::AgentManager>,
}
```

Add commands:

```rust
#[tauri::command]
async fn start_agent_session(
    request: agent::types::AgentSessionStart,
    state: State<'_, Arc<AppState>>,
) -> Result<agent::types::AgentSessionInfo, String> {
    if request.objective.trim().is_empty() {
        return Err("Objective is required".into());
    }
    Ok(state.agent_manager.start_session(request))
}

#[tauri::command]
async fn cancel_agent_session(
    agent_session_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<bool, String> {
    Ok(state.agent_manager.cancel_session(&agent_session_id))
}
```

Register commands and initialize `agent_manager: Arc::new(agent::manager::AgentManager::new())` where `AppState` is constructed.

- [ ] **Step 5: Run tests and check**

Run:

```bash
cd src-tauri
cargo test agent::manager agent::tools
cargo check
```

Expected: tests pass and backend compiles.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/agent/manager.rs src-tauri/src/agent/tools.rs src-tauri/src/agent/mod.rs src-tauri/src/lib.rs
git commit -m "feat: add agent manager and tool registry"
```

### Task 6: SSH Exec Streaming For Real-Time Logs

**Files:**
- Create: `src-tauri/src/agent/stream.rs`
- Modify: `src-tauri/src/agent/mod.rs`
- Modify: `src-tauri/src/ssh/mod.rs`
- Modify: `src-tauri/src/ssh/exec.rs`
- Test: `src-tauri/src/agent/stream.rs`

- [ ] **Step 1: Export stream module**

Modify `src-tauri/src/agent/mod.rs`:

```rust
pub mod manager;
pub mod prompt;
pub mod provider;
pub mod redaction;
pub mod risk;
pub mod stream;
pub mod tools;
pub mod types;
```

- [ ] **Step 2: Define stream command builder**

Add `src-tauri/src/agent/stream.rs`:

```rust
pub fn journal_tail_command(unit: Option<&str>, lines: u32) -> String {
    let lines = lines.clamp(20, 500);
    match unit.filter(|u| !u.trim().is_empty()) {
        Some(unit) => format!(
            "journalctl -u {} -n {} -f --no-pager",
            shell_escape(unit),
            lines
        ),
        None => format!("journalctl -n {} -f --no-pager", lines),
    }
}

pub fn docker_logs_tail_command(container: &str, lines: u32) -> String {
    let lines = lines.clamp(20, 500);
    format!("docker logs --tail={} -f {}", lines, shell_escape(container))
}

pub fn file_tail_command(path: &str, lines: u32) -> String {
    let lines = lines.clamp(20, 500);
    format!("tail -n {} -F {}", lines, shell_escape(path))
}

fn shell_escape(input: &str) -> String {
    format!("'{}'", input.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_journal_tail_command_with_unit() {
        assert_eq!(
            journal_tail_command(Some("nginx.service"), 50),
            "journalctl -u 'nginx.service' -n 50 -f --no-pager"
        );
    }

    #[test]
    fn escapes_file_tail_path() {
        let cmd = file_tail_command("/var/log/app's.log", 10);
        assert!(cmd.contains("'app'\\''s.log'"));
        assert!(cmd.contains("-n 20"));
    }
}
```

- [ ] **Step 3: Add backend stream support**

In `src-tauri/src/ssh/exec.rs`, add a streaming helper that opens a session channel, runs `exec`, and calls a callback for each data chunk until timeout/cancel. Use this signature:

```rust
pub async fn exec_stream<F>(
    conn: &Handle<Client>,
    command: &str,
    mut on_chunk: F,
    stop: std::sync::Arc<tokio::sync::Notify>,
) -> Result<(), String>
where
    F: FnMut(Vec<u8>) + Send + 'static,
{
    let channel = conn
        .channel_open_session()
        .await
        .map_err(|e| format!("Stream channel failed: {}", e))?;
    channel
        .exec(true, command.as_bytes())
        .await
        .map_err(|e| format!("Stream exec failed: {}", e))?;
    let mut channel = channel;
    loop {
        tokio::select! {
            _ = stop.notified() => break,
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { data }) | Some(ChannelMsg::ExtendedData { data, .. }) => {
                        on_chunk(data.to_vec());
                    }
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                    _ => {}
                }
            }
        }
    }
    Ok(())
}
```

In `src-tauri/src/ssh/mod.rs`, expose a wrapper:

```rust
pub async fn ssh_exec_stream<F>(
    &self,
    session_id: &str,
    command: &str,
    on_chunk: F,
    stop: std::sync::Arc<Notify>,
) -> Result<(), String>
where
    F: FnMut(Vec<u8>) + Send + 'static,
{
    let conn = self
        .sessions
        .lock()
        .await
        .get(session_id)
        .map(|s| s.conn.clone())
        .ok_or("Session not found")?;
    exec::exec_stream(&conn, command, on_chunk, stop).await
}
```

- [ ] **Step 4: Run tests and check**

Run:

```bash
cd src-tauri
cargo test agent::stream
cargo check
```

Expected: stream command tests pass and backend compiles.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/agent/stream.rs src-tauri/src/agent/mod.rs src-tauri/src/ssh/exec.rs src-tauri/src/ssh/mod.rs
git commit -m "feat: add ssh log streaming for agent"
```

### Task 7: Agent Events, Evidence Frames, And Audit Persistence

**Files:**
- Create: `src-tauri/src/agent/audit.rs`
- Modify: `src-tauri/src/agent/mod.rs`
- Modify: `src-tauri/src/agent/manager.rs`
- Modify: `src-tauri/src/database.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Export audit module**

Modify `src-tauri/src/agent/mod.rs`:

```rust
pub mod audit;
pub mod manager;
pub mod prompt;
pub mod provider;
pub mod redaction;
pub mod risk;
pub mod stream;
pub mod tools;
pub mod types;
```

- [ ] **Step 2: Add audit helpers**

Add `src-tauri/src/agent/audit.rs`:

```rust
use super::types::AgentAuditRecord;
use crate::database::Database;

pub fn save_audit(db: &Database, record: &AgentAuditRecord) -> Result<(), String> {
    let raw = serde_json::to_string(record).map_err(|e| e.to_string())?;
    db.save_agent_audit_raw(
        &record.id,
        &record.agent_session_id,
        &record.target_session_id,
        record.started_at,
        record.finished_at,
        &record.objective,
        &format!("{:?}", record.status),
        &raw,
    )
}
```

Add to `Database`:

```rust
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
        params![id, agent_session_id, target_session_id, started_at, finished_at, objective, status, report_json],
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
```

- [ ] **Step 3: Add basic event emit helpers in manager**

Add methods to `AgentManager` in `src-tauri/src/agent/manager.rs`:

```rust
pub fn event_name(kind: &str, agent_session_id: &str) -> String {
    format!("agent-{}-{}", kind, agent_session_id)
}
```

Use event kinds exactly:

```text
status
evidence
analysis-delta
analysis-update
action-proposed
action-result
audit
error
```

- [ ] **Step 4: Add list audits IPC**

Add command in `src-tauri/src/lib.rs`:

```rust
#[tauri::command]
async fn list_agent_audits(
    target_session_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<agent::types::AgentAuditRecord>, String> {
    let rows = state.db.list_agent_audits_raw(&target_session_id)?;
    Ok(rows
        .into_iter()
        .filter_map(|row| serde_json::from_str::<agent::types::AgentAuditRecord>(&row).ok())
        .collect())
}
```

Register the command in `tauri::generate_handler![...]`.

- [ ] **Step 5: Run check**

Run:

```bash
cd src-tauri
cargo check
```

Expected: backend compiles.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/agent/audit.rs src-tauri/src/agent/mod.rs src-tauri/src/agent/manager.rs src-tauri/src/database.rs src-tauri/src/lib.rs
git commit -m "feat: add agent audit persistence"
```

### Task 8: Frontend Agent Types, Store, And Event Subscriptions

**Files:**
- Create: `src/types/agent.ts`
- Create: `src/stores/agentStore.ts`
- Create: `src/lib/agentEvents.ts`
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add TypeScript Agent types**

Add `src/types/agent.ts`:

```ts
export type AgentAutonomyLevel = 'observe' | 'recommend' | 'confirmed_act' | 'policy_auto_maintain';
export type AgentRisk = 'read_only' | 'low' | 'medium' | 'high' | 'blocked';
export type AgentToolName = 'run_command' | 'stream_log' | 'read_file' | 'docker_logs' | 'restart_service';
export type AgentSessionStatus = 'running' | 'completed' | 'cancelled' | 'failed';

export interface AiProviderSettings {
  enabled: boolean;
  provider: 'openai_compatible';
  base_url: string;
  model: string;
  api_key_configured: boolean;
  temperature: number;
  max_input_chars: number;
  request_timeout_secs: number;
}

export interface AgentSessionStart {
  target_session_id: string;
  objective: string;
  autonomy: AgentAutonomyLevel;
}

export interface AgentSessionInfo extends AgentSessionStart {
  id: string;
  started_at: number;
  status: AgentSessionStatus;
}

export interface AgentEvidence {
  id: string;
  source: string;
  label: string;
  body: string;
  created_at: number;
}

export interface AgentFinding {
  id: string;
  title: string;
  severity: string;
  confidence: string;
  evidence_ids: string[];
}

export interface AgentToolCall {
  id: string;
  tool: AgentToolName;
  target_session_id: string;
  payload: Record<string, unknown>;
  risk: AgentRisk;
  reason: string;
  expected_result?: string;
  verify?: AgentToolCall;
}

export interface AgentToolResult {
  call_id: string;
  ok: boolean;
  output: string;
  error?: string | null;
  verification?: AgentToolResult | null;
}

export interface AgentAnalysisUpdate {
  summary: string;
  findings: AgentFinding[];
  proposed_actions: AgentToolCall[];
  questions: string[];
}
```

- [ ] **Step 2: Export Agent types**

Modify `src/types/index.ts`:

```ts
export * from './agent';
```

- [ ] **Step 3: Add Agent store**

Add `src/stores/agentStore.ts`:

```ts
import { create } from 'zustand';
import type { AgentAnalysisUpdate, AgentEvidence, AgentSessionInfo, AgentToolCall, AgentToolResult } from '../types/agent';

interface AgentStore {
  activeSession: AgentSessionInfo | null;
  evidence: AgentEvidence[];
  analysisText: string;
  latestUpdate: AgentAnalysisUpdate | null;
  actions: AgentToolCall[];
  results: AgentToolResult[];
  error: string | null;
  setActiveSession: (session: AgentSessionInfo | null) => void;
  pushEvidence: (evidence: AgentEvidence) => void;
  appendAnalysisText: (delta: string) => void;
  setLatestUpdate: (update: AgentAnalysisUpdate) => void;
  upsertAction: (action: AgentToolCall) => void;
  pushResult: (result: AgentToolResult) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useAgentStore = create<AgentStore>((set) => ({
  activeSession: null,
  evidence: [],
  analysisText: '',
  latestUpdate: null,
  actions: [],
  results: [],
  error: null,
  setActiveSession: (session) => set({ activeSession: session, evidence: [], analysisText: '', latestUpdate: null, actions: [], results: [], error: null }),
  pushEvidence: (evidence) => set((s) => ({ evidence: [...s.evidence, evidence] })),
  appendAnalysisText: (delta) => set((s) => ({ analysisText: s.analysisText + delta })),
  setLatestUpdate: (update) => set({ latestUpdate: update }),
  upsertAction: (action) => set((s) => ({ actions: [...s.actions.filter((a) => a.id !== action.id), action] })),
  pushResult: (result) => set((s) => ({ results: [...s.results, result] })),
  setError: (error) => set({ error }),
  reset: () => set({ activeSession: null, evidence: [], analysisText: '', latestUpdate: null, actions: [], results: [], error: null }),
}));
```

- [ ] **Step 4: Add event subscription helper**

Add `src/lib/agentEvents.ts`:

```ts
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useAgentStore } from '../stores/agentStore';
import type { AgentAnalysisUpdate, AgentEvidence, AgentToolCall, AgentToolResult } from '../types/agent';

export async function subscribeAgentEvents(agentSessionId: string): Promise<UnlistenFn[]> {
  const unlisteners = await Promise.all([
    listen<AgentEvidence>(`agent-evidence-${agentSessionId}`, (event) => {
      useAgentStore.getState().pushEvidence(event.payload);
    }),
    listen<{ textDelta: string }>(`agent-analysis-delta-${agentSessionId}`, (event) => {
      useAgentStore.getState().appendAnalysisText(event.payload.textDelta);
    }),
    listen<AgentAnalysisUpdate>(`agent-analysis-update-${agentSessionId}`, (event) => {
      useAgentStore.getState().setLatestUpdate(event.payload);
    }),
    listen<AgentToolCall>(`agent-action-proposed-${agentSessionId}`, (event) => {
      useAgentStore.getState().upsertAction(event.payload);
    }),
    listen<AgentToolResult>(`agent-action-result-${agentSessionId}`, (event) => {
      useAgentStore.getState().pushResult(event.payload);
    }),
    listen<{ message: string }>(`agent-error-${agentSessionId}`, (event) => {
      useAgentStore.getState().setError(event.payload.message);
    }),
  ]);
  return unlisteners;
}
```

- [ ] **Step 5: Run frontend build**

Run:

```bash
npm run build
```

Expected: TypeScript compiles.

- [ ] **Step 6: Commit**

```bash
git add src/types/agent.ts src/types/index.ts src/stores/agentStore.ts src/lib/agentEvents.ts
git commit -m "feat: add frontend agent state model"
```

### Task 9: AI Settings UI

**Files:**
- Create: `src/components/Settings/AiSettingsSection.tsx`
- Modify: `src/components/Settings/SettingsModal.tsx`
- Modify: `src/i18n/locales/gwshell.zh.json`
- Modify: `src/i18n/locales/gwshell.en.json`

- [ ] **Step 1: Create AI settings section**

Add `src/components/Settings/AiSettingsSection.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import type { AiProviderSettings } from '../../types/agent';

const defaults: AiProviderSettings = {
  enabled: false,
  provider: 'openai_compatible',
  base_url: 'https://api.openai.com/v1',
  model: 'gpt-4.1-mini',
  api_key_configured: false,
  temperature: 0.2,
  max_input_chars: 24000,
  request_timeout_secs: 45,
};

export const AiSettingsSection: React.FC = () => {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<AiProviderSettings>(defaults);
  const [apiKey, setApiKey] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    invoke<AiProviderSettings>('load_ai_provider_settings')
      .then(setSettings)
      .catch((err) => setMessage(String(err)));
  }, []);

  const save = async () => {
    await invoke('save_ai_provider_settings', { settings });
    if (apiKey.trim()) {
      await invoke('set_ai_provider_api_key', { apiKey: apiKey.trim() });
      setApiKey('');
      setSettings((s) => ({ ...s, api_key_configured: true }));
    }
    setMessage(t('agent_ai_saved'));
  };

  const clearKey = async () => {
    await invoke('clear_ai_provider_api_key');
    setSettings((s) => ({ ...s, api_key_configured: false }));
    setMessage(t('agent_ai_key_cleared'));
  };

  return (
    <>
      <div className="settings-section-title">{t('agent_ai_title')}</div>
      <div className="settings-col" style={{ maxWidth: 760 }}>
        <label className="settings-row">
          <span className="settings-row-left"><span className="settings-label">{t('agent_ai_enabled')}</span></span>
          <span className="settings-row-right">
            <button className={`settings-toggle ${settings.enabled ? 'on' : ''}`} onClick={() => setSettings((s) => ({ ...s, enabled: !s.enabled }))} type="button">
              <span className="settings-toggle-knob" />
            </button>
          </span>
        </label>
        <div className="settings-row">
          <span className="settings-row-left"><span className="settings-label">{t('agent_ai_base_url')}</span></span>
          <span className="settings-row-right"><input className="settings-input" style={{ width: 320 }} value={settings.base_url} onChange={(e) => setSettings((s) => ({ ...s, base_url: e.target.value }))} /></span>
        </div>
        <div className="settings-row">
          <span className="settings-row-left"><span className="settings-label">{t('agent_ai_model')}</span></span>
          <span className="settings-row-right"><input className="settings-input" style={{ width: 220 }} value={settings.model} onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))} /></span>
        </div>
        <div className="settings-row">
          <span className="settings-row-left"><span className="settings-label">{t('agent_ai_api_key')}</span><span className="settings-desc">{settings.api_key_configured ? t('agent_ai_key_configured') : t('agent_ai_key_missing')}</span></span>
          <span className="settings-row-right"><input className="settings-input" type="password" style={{ width: 260 }} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." /></span>
        </div>
        <div className="settings-row">
          <span className="settings-row-left"><span className="settings-label">{t('agent_ai_timeout')}</span></span>
          <span className="settings-row-right"><input className="settings-input" style={{ width: 90 }} value={settings.request_timeout_secs} onChange={(e) => setSettings((s) => ({ ...s, request_timeout_secs: parseInt(e.target.value) || 45 }))} /></span>
        </div>
        <div className="settings-row">
          <span className="settings-row-left"><span className="settings-desc">{t('agent_ai_external_notice')}</span></span>
          <span className="settings-row-right">
            <button className="settings-btn-outline" onClick={clearKey}>{t('agent_ai_clear_key')}</button>
            <button className="settings-btn-primary" style={{ marginLeft: 8 }} onClick={save}>{t('settings_apply')}</button>
          </span>
        </div>
        {message && <p className="settings-desc" style={{ color: 'var(--success)' }}>{message}</p>}
      </div>
    </>
  );
};
```

- [ ] **Step 2: Add settings nav item**

Modify `navCategories` in `src/components/Settings/SettingsModal.tsx` by adding:

```ts
{ items: [{ id: 'agent-ai', labelKey: 'agent_ai_title' }] },
```

Import and render:

```tsx
import { AiSettingsSection } from './AiSettingsSection';
```

Inside settings content:

```tsx
{activeNav === 'agent-ai' && <AiSettingsSection />}
```

- [ ] **Step 3: Add i18n keys**

Add to `src/i18n/locales/gwshell.zh.json`:

```json
"agent_ai_title": "Agent / AI",
"agent_ai_enabled": "启用 Agent",
"agent_ai_base_url": "Base URL",
"agent_ai_model": "模型",
"agent_ai_api_key": "API Key",
"agent_ai_key_configured": "已配置密钥",
"agent_ai_key_missing": "未配置密钥",
"agent_ai_timeout": "超时秒数",
"agent_ai_clear_key": "清除密钥",
"agent_ai_saved": "AI 设置已保存",
"agent_ai_key_cleared": "AI 密钥已清除",
"agent_ai_external_notice": "启用后，脱敏后的服务器证据会发送到配置的大模型接口。"
```

Add English equivalents to `src/i18n/locales/gwshell.en.json`.

- [ ] **Step 4: Run frontend build**

Run:

```bash
npm run build
```

Expected: TypeScript compiles and i18n JSON parses.

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/AiSettingsSection.tsx src/components/Settings/SettingsModal.tsx src/i18n/locales/gwshell.zh.json src/i18n/locales/gwshell.en.json
git commit -m "feat: add agent ai settings"
```

### Task 10: Agent Panel Shell And App Integration

**Files:**
- Create: `src/components/Agent/AgentPanel.tsx`
- Create: `src/components/Agent/AgentObjective.tsx`
- Create: `src/components/Agent/AgentAnalysisStream.tsx`
- Create: `src/components/Agent/AgentEvidence.tsx`
- Create: `src/components/Agent/AgentActionQueue.tsx`
- Create: `src/components/Agent/index.ts`
- Modify: `src/App.tsx`
- Modify: `src/stores/appStore.ts`
- Modify: `src/components/TitleBar/TitleBar.tsx`

- [ ] **Step 1: Add appStore Agent panel state**

Modify `src/stores/appStore.ts` interface:

```ts
agentPanelOpen: boolean;
toggleAgentPanel: () => void;
```

Add implementation:

```ts
agentPanelOpen: false,
toggleAgentPanel: () => set((state) => ({ agentPanelOpen: !state.agentPanelOpen })),
```

- [ ] **Step 2: Create Agent objective component**

Add `src/components/Agent/AgentObjective.tsx`:

```tsx
import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import { useAgentStore } from '../../stores/agentStore';
import { subscribeAgentEvents } from '../../lib/agentEvents';
import type { AgentSessionInfo } from '../../types/agent';

export const AgentObjective: React.FC = () => {
  const { t } = useTranslation();
  const [objective, setObjective] = useState('');
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const setActiveSession = useAgentStore((s) => s.setActiveSession);
  const setError = useAgentStore((s) => s.setError);
  const activeTab = tabs.find((t) => t.id === activeTabId);

  const start = async () => {
    if (!activeTab || activeTab.type !== 'ssh' || !activeTab.connected) {
      setError(t('agent_requires_connected_ssh'));
      return;
    }
    const session = await invoke<AgentSessionInfo>('start_agent_session', {
      request: {
        target_session_id: activeTab.sessionId,
        objective,
        autonomy: 'recommend',
      },
    });
    setActiveSession(session);
    await subscribeAgentEvents(session.id);
  };

  return (
    <div className="agent-objective">
      <textarea className="agent-objective-input" value={objective} onChange={(e) => setObjective(e.target.value)} placeholder={t('agent_objective_placeholder')} />
      <button className="settings-btn-primary" onClick={start} disabled={!objective.trim()}>{t('agent_start')}</button>
    </div>
  );
};
```

- [ ] **Step 3: Create display components**

Add `src/components/Agent/AgentAnalysisStream.tsx`:

```tsx
import React from 'react';
import { useAgentStore } from '../../stores/agentStore';

export const AgentAnalysisStream: React.FC = () => {
  const text = useAgentStore((s) => s.analysisText);
  return <pre className="agent-analysis-stream">{text || 'No analysis yet.'}</pre>;
};
```

Add `src/components/Agent/AgentEvidence.tsx`:

```tsx
import React from 'react';
import { useAgentStore } from '../../stores/agentStore';

export const AgentEvidence: React.FC = () => {
  const evidence = useAgentStore((s) => s.evidence);
  return (
    <div className="agent-evidence-list">
      {evidence.map((item) => (
        <details className="agent-evidence-item" key={item.id}>
          <summary>{item.label}</summary>
          <pre>{item.body}</pre>
        </details>
      ))}
    </div>
  );
};
```

Add `src/components/Agent/AgentActionQueue.tsx`:

```tsx
import React from 'react';
import { useAgentStore } from '../../stores/agentStore';

export const AgentActionQueue: React.FC = () => {
  const actions = useAgentStore((s) => s.actions);
  return (
    <div className="agent-action-list">
      {actions.map((action) => (
        <div className={`agent-action agent-risk-${action.risk}`} key={action.id}>
          <div>{action.tool}</div>
          <div>{action.reason}</div>
          <code>{typeof action.payload.command === 'string' ? action.payload.command : JSON.stringify(action.payload)}</code>
        </div>
      ))}
    </div>
  );
};
```

- [ ] **Step 4: Create panel**

Add `src/components/Agent/AgentPanel.tsx`:

```tsx
import React from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import { useAgentStore } from '../../stores/agentStore';
import { AgentObjective } from './AgentObjective';
import { AgentAnalysisStream } from './AgentAnalysisStream';
import { AgentEvidence } from './AgentEvidence';
import { AgentActionQueue } from './AgentActionQueue';

export const AgentPanel: React.FC = () => {
  const { t } = useTranslation();
  const open = useAppStore((s) => s.agentPanelOpen);
  const toggle = useAppStore((s) => s.toggleAgentPanel);
  const activeSession = useAgentStore((s) => s.activeSession);
  const error = useAgentStore((s) => s.error);
  if (!open) return null;

  return (
    <aside className="agent-panel">
      <div className="agent-panel-header">
        <span>{t('agent_panel_title')}</span>
        <button className="sp-header__close" onClick={toggle} title={t('serverPanel_close')}><X size={16} /></button>
      </div>
      <div className="agent-panel-body">
        <AgentObjective />
        {error && <div className="agent-error">{error}</div>}
        {activeSession && <div className="agent-session-id">{activeSession.objective}</div>}
        <AgentAnalysisStream />
        <AgentActionQueue />
        <AgentEvidence />
      </div>
    </aside>
  );
};
```

Add `src/components/Agent/index.ts`:

```ts
export { AgentPanel } from './AgentPanel';
```

- [ ] **Step 5: Render panel in App**

Modify `src/App.tsx`:

```tsx
const AgentPanel = lazy(() => import('./components/Agent').then((m) => ({ default: m.AgentPanel })));
```

Render near `ServerPanel`:

```tsx
<Suspense fallback={null}>
  <AgentPanel />
</Suspense>
```

- [ ] **Step 6: Add title bar toggle**

Modify `src/components/TitleBar/TitleBar.tsx` to read `agentPanelOpen` and `toggleAgentPanel`, add a button with title `agent_panel_title`.

- [ ] **Step 7: Add i18n strings and styles**

Add zh/en keys:

```json
"agent_panel_title": "GWShell Agent",
"agent_objective_placeholder": "描述问题或维护目标，例如：nginx 502 after deploy",
"agent_start": "启动 Agent",
"agent_requires_connected_ssh": "Agent 需要当前标签是已连接的 SSH 会话"
```

Add minimal CSS:

```css
.agent-panel {
  width: 380px;
  border-left: 1px solid var(--border);
  background: var(--bg-panel);
  display: flex;
  flex-direction: column;
}
.agent-panel-header {
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  border-bottom: 1px solid var(--border);
}
.agent-panel-body {
  padding: 10px;
  overflow: auto;
}
.agent-objective-input {
  width: 100%;
  min-height: 72px;
}
.agent-analysis-stream,
.agent-evidence-item pre {
  white-space: pre-wrap;
  font-family: var(--terminal-font, monospace);
}
```

- [ ] **Step 8: Run frontend build**

Run:

```bash
npm run build
```

Expected: TypeScript compiles.

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx src/stores/appStore.ts src/components/Agent src/components/TitleBar/TitleBar.tsx src/i18n/locales/gwshell.zh.json src/i18n/locales/gwshell.en.json src/styles/global.css
git commit -m "feat: add agent panel shell"
```

### Task 11: Wire Agent Session To Initial Evidence And Model Stream

**Files:**
- Modify: `src-tauri/src/agent/manager.rs`
- Modify: `src-tauri/src/agent/provider.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Emit initial evidence on start**

Update `start_agent_session` command in `src-tauri/src/lib.rs` so after creating the session it spawns a task that:

1. Runs `hostname && uptime && df -hP /`.
2. Redacts output.
3. Emits `agent-evidence-{agentSessionId}`.
4. Emits a local analysis delta if AI is not enabled.
5. Emits a local read-only `df -hP /` proposed action so the tool execution path
   can be verified without a model.

Use this helper and payload shape:

```rust
fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

let evidence = agent::types::AgentEvidence {
    id: uuid::Uuid::new_v4().to_string(),
    source: "ssh_exec".into(),
    label: "Initial health probe".into(),
    body: agent::redaction::redact_secrets(&output),
    created_at: now_secs(),
};
```

Emit the local analysis message when AI is disabled:

```rust
let _ = app_handle.emit(
    &agent::manager::event_name("analysis-delta", &info.id),
    serde_json::json!({
        "textDelta": "AI provider is disabled. Collected initial server evidence and local rules are available.\n"
    }),
);
```

Emit a local read-only action:

```rust
let action = agent::types::AgentToolCall {
    id: uuid::Uuid::new_v4().to_string(),
    tool: agent::types::AgentToolName::RunCommand,
    target_session_id: info.target_session_id.clone(),
    payload: serde_json::json!({ "command": "df -hP /" }),
    risk: agent::types::AgentRisk::ReadOnly,
    reason: "Inspect root filesystem usage".into(),
    expected_result: Some("Shows current root filesystem capacity and usage".into()),
    verify: None,
};
let _ = app_handle.emit(&agent::manager::event_name("action-proposed", &info.id), action);
```

- [ ] **Step 2: Add provider test IPC behavior**

Implement `test_ai_provider()` in `src-tauri/src/lib.rs`:

```rust
#[tauri::command]
async fn test_ai_provider(state: State<'_, Arc<AppState>>) -> Result<String, String> {
    let settings = agent::provider::load_settings(&state.db)?;
    if !settings.enabled {
        return Err("AI provider is disabled".into());
    }
    if agent::provider::load_api_key(&state.db)?.is_none() {
        return Err("AI API key is not configured".into());
    }
    Ok(format!("Configured: {} {}", settings.base_url, settings.model))
}
```

This first test validates settings/key plumbing. A real network test is added after the streaming client is complete.

- [ ] **Step 3: Run backend check**

Run:

```bash
cd src-tauri
cargo check
```

Expected: backend compiles.

- [ ] **Step 4: Run frontend build**

Run:

```bash
npm run build
```

Expected: frontend compiles.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/agent/manager.rs src-tauri/src/agent/provider.rs src-tauri/src/lib.rs
git commit -m "feat: emit initial agent evidence"
```

### Task 12: Action Approval And Execution IPC

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/components/Agent/AgentActionQueue.tsx`
- Modify: `src/stores/agentStore.ts`

- [ ] **Step 1: Add execute_agent_action IPC**

Add command:

```rust
#[tauri::command]
async fn execute_agent_action(
    action: agent::types::AgentToolCall,
    state: State<'_, Arc<AppState>>,
) -> Result<agent::types::AgentToolResult, String> {
    let result = agent::tools::execute_tool(state.ssh_manager.clone(), action).await;
    Ok(result)
}
```

Register it in `generate_handler`.

- [ ] **Step 2: Add frontend action execution**

Modify `AgentActionQueue.tsx`:

```tsx
import { invoke } from '@tauri-apps/api/core';
import type { AgentToolResult } from '../../types/agent';
```

Add execute button:

```tsx
const runAction = async (action: AgentToolCall) => {
  if (action.risk !== 'read_only' && !window.confirm(`Run ${action.risk} action?`)) return;
  const result = await invoke<AgentToolResult>('execute_agent_action', { action });
  useAgentStore.getState().pushResult(result);
};
```

Render:

```tsx
<button className="settings-btn-outline" onClick={() => void runAction(action)}>
  {action.risk === 'read_only' ? 'Run' : 'Review and run'}
</button>
```

- [ ] **Step 3: Run builds**

Run:

```bash
cd src-tauri
cargo check
cd ..
npm run build
```

Expected: both backend and frontend compile.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs src/components/Agent/AgentActionQueue.tsx src/stores/agentStore.ts
git commit -m "feat: execute agent actions with approval"
```

### Task 13: Verification, Audit Save, And Final Build

**Files:**
- Modify: `src-tauri/src/agent/tools.rs`
- Modify: `src-tauri/src/agent/audit.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/components/Agent/AgentAuditTimeline.tsx`
- Modify: `src/components/Agent/AgentPanel.tsx`

- [ ] **Step 1: Execute verification action**

Modify `execute_tool` in `src-tauri/src/agent/tools.rs` so when `call.verify` exists and primary execution succeeds, it executes the verification call if the verification risk is not higher than `ReadOnly`.

Use:

```rust
if result.ok {
    if let Some(verify) = call.verify {
        if classify_tool_call(&verify) == AgentRisk::ReadOnly {
            let verification = Box::pin(execute_tool(ssh.clone(), *verify)).await;
            result.verification = Some(Box::new(verification));
        }
    }
}
```

Refactor `result` to be mutable before this block.

- [ ] **Step 2: Save audit command**

Add command in `src-tauri/src/lib.rs`:

```rust
#[tauri::command]
async fn save_agent_audit(
    record: agent::types::AgentAuditRecord,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    agent::audit::save_audit(&state.db, &record)
}
```

Register it.

- [ ] **Step 3: Add audit timeline component**

Add `src/components/Agent/AgentAuditTimeline.tsx`:

```tsx
import React from 'react';
import { useAgentStore } from '../../stores/agentStore';

export const AgentAuditTimeline: React.FC = () => {
  const results = useAgentStore((s) => s.results);
  return (
    <div className="agent-audit">
      {results.map((result) => (
        <div className="agent-audit-row" key={result.call_id}>
          <span>{result.ok ? 'OK' : 'FAIL'}</span>
          <pre>{result.output || result.error}</pre>
          {result.verification && <pre>Verification: {result.verification.output || result.verification.error}</pre>}
        </div>
      ))}
    </div>
  );
};
```

Render it in `AgentPanel.tsx` below `AgentActionQueue`.

- [ ] **Step 4: Run all validation**

Run:

```bash
cd src-tauri
cargo test agent
cargo check
cd ..
npm run build
npm run smoke:check
```

Expected:

- Agent Rust tests pass.
- `cargo check` passes.
- TypeScript/Vite build passes.
- `npm run smoke:check` passes if the script exists in `package.json`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/agent/tools.rs src-tauri/src/agent/audit.rs src-tauri/src/lib.rs src/components/Agent/AgentAuditTimeline.tsx src/components/Agent/AgentPanel.tsx
git commit -m "feat: verify and audit agent actions"
```

### Task 14: Manual End-To-End Verification

**Files:**
- No source files unless bugs are found.

- [ ] **Step 1: Start the app**

Run:

```bash
npm run tauri dev
```

Expected: Tauri app launches.

- [ ] **Step 2: Configure AI provider**

In Settings -> Agent / AI:

- Enable Agent.
- Set Base URL.
- Set model.
- Enter API key.
- Save.

Expected: settings save without exposing the API key in frontend JSON.

- [ ] **Step 3: Connect an SSH session**

Open an existing SSH asset.

Expected: terminal connects and tab shows connected.

- [ ] **Step 4: Start Agent**

Open the Agent panel and enter:

```text
Analyze this server for nginx or system health problems.
```

Expected:

- Agent session starts.
- Initial evidence appears.
- Analysis area updates.
- No mutating command runs automatically.

- [ ] **Step 5: Run a read-only action**

Use a proposed read-only action. If the configured model does not propose one, type an objective that asks for a disk check so the local startup path proposes `df -hP /`.

Expected:

- Action executes.
- Result appears.
- Verification appears when configured.

- [ ] **Step 6: Confirm risk gate**

Try an action with `systemctl restart nginx`.

Expected:

- UI requires confirmation.
- Action is not run if confirmation is cancelled.

- [ ] **Step 7: Stop dev server**

Terminate `npm run tauri dev`.

- [ ] **Step 8: Final status**

Run:

```bash
git status --short
```

Expected: only intentional changes remain.

---

## Self-Review Checklist

- Spec coverage:
  - AI provider settings: Tasks 3 and 9.
  - Encrypted API key: Task 3.
  - Agent runtime boundary: Tasks 1, 5, 8, 10.
  - Real-time logs: Task 6.
  - Streaming AI parser/prompt: Task 4.
  - Tool registry: Task 5.
  - Risk policy: Task 2 and Task 12.
  - Verification/audit: Task 13.
- Type consistency:
  - Rust serde uses snake_case enums; TypeScript types use matching snake_case strings.
  - IPC names match frontend invocations.
  - Agent event names are `agent-<kind>-<agentSessionId>`.
- Deliberate deferrals:
  - L3 automatic maintenance.
  - Runbook generation.
  - Fleet/background mode.
  - Provider/key plumbing is validated first; full external-model reliability tests belong to the provider hardening plan.
