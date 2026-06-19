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
