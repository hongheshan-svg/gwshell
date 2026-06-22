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
pub struct AgentContinuationRequest {
    pub agent_session_id: String,
    pub evidence: Vec<AgentEvidence>,
    pub latest_update: Option<AgentAnalysisUpdate>,
    pub results: Vec<AgentToolResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalAiChatRequest {
    pub request_id: String,
    pub tab_id: String,
    pub target_session_id: String,
    pub tab_title: String,
    pub question: String,
    pub cwd: Option<String>,
    pub prompt: Option<String>,
    pub selected_text: Option<String>,
    pub recent_output: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentPolicySettings {
    #[serde(default = "default_true")]
    pub auto_continue_enabled: bool,
    #[serde(default = "default_true")]
    pub live_log_auto_analysis: bool,
    #[serde(default = "default_max_auto_continuations")]
    pub max_auto_continuations: u8,
    #[serde(default = "default_true")]
    pub auto_execute_read_only: bool,
    #[serde(default = "default_true")]
    pub auto_execute_low_risk: bool,
    #[serde(default)]
    pub auto_execute_command_allowlist: Vec<String>,
    #[serde(default)]
    pub auto_execute_service_denylist: Vec<String>,
    #[serde(default)]
    pub maintenance_window_enabled: bool,
    #[serde(default = "default_maintenance_window_start")]
    pub maintenance_window_start: String,
    #[serde(default = "default_maintenance_window_end")]
    pub maintenance_window_end: String,
    #[serde(default = "default_true")]
    pub log_filter_enabled: bool,
    #[serde(default = "default_log_keywords")]
    pub log_interest_keywords: Vec<String>,
    #[serde(default = "default_disk_alert_percent")]
    pub disk_alert_percent: u8,
    #[serde(default = "default_memory_alert_percent")]
    pub memory_alert_percent: u8,
    #[serde(default = "default_true")]
    pub alert_auto_start_agent: bool,
}

impl Default for AgentPolicySettings {
    fn default() -> Self {
        Self {
            auto_continue_enabled: true,
            live_log_auto_analysis: true,
            max_auto_continuations: 8,
            auto_execute_read_only: true,
            auto_execute_low_risk: true,
            auto_execute_command_allowlist: Vec::new(),
            auto_execute_service_denylist: Vec::new(),
            maintenance_window_enabled: false,
            maintenance_window_start: "00:00".to_string(),
            maintenance_window_end: "23:59".to_string(),
            log_filter_enabled: true,
            log_interest_keywords: default_log_keywords(),
            disk_alert_percent: 90,
            memory_alert_percent: 90,
            alert_auto_start_agent: true,
        }
    }
}

fn default_true() -> bool {
    true
}

fn default_max_auto_continuations() -> u8 {
    8
}

fn default_maintenance_window_start() -> String {
    "00:00".to_string()
}

fn default_maintenance_window_end() -> String {
    "23:59".to_string()
}

fn default_log_keywords() -> Vec<String> {
    [
        "error",
        "warn",
        "panic",
        "fatal",
        "oom",
        "timeout",
        "exception",
        "failed",
        "denied",
        "refused",
        "unavailable",
    ]
    .into_iter()
    .map(ToString::to_string)
    .collect()
}

fn default_disk_alert_percent() -> u8 {
    90
}

fn default_memory_alert_percent() -> u8 {
    90
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
