use super::redaction::redact_secrets;
use super::risk::classify_tool_call;
use super::types::{AgentRisk, AgentToolCall, AgentToolName, AgentToolResult};
use crate::ssh::SshManager;
use std::sync::Arc;
use tokio::time::{timeout, Duration};

pub async fn execute_tool(ssh: Arc<SshManager>, call: AgentToolCall) -> AgentToolResult {
    let actual_risk = classify_tool_call(&call);
    if actual_risk == AgentRisk::Blocked || actual_risk == AgentRisk::High {
        return failed_result(call.id, format!("blocked by policy: {:?}", actual_risk));
    }

    match call.tool {
        AgentToolName::RunCommand => {
            let command = call
                .payload
                .get("command")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            match timeout(
                Duration::from_secs(20),
                ssh.ssh_exec(&call.target_session_id, command),
            )
            .await
            {
                Ok(Ok(output)) => AgentToolResult {
                    call_id: call.id,
                    ok: true,
                    output: redact_secrets(&output),
                    error: None,
                    verification: None,
                },
                Ok(Err(error)) => failed_result(call.id, error),
                Err(_) => failed_result(call.id, "tool execution timed out".to_string()),
            }
        }
        _ => failed_result(call.id, "unsupported tool for this action path".to_string()),
    }
}

fn failed_result(call_id: String, error: String) -> AgentToolResult {
    AgentToolResult {
        call_id,
        ok: false,
        output: String::new(),
        error: Some(error),
        verification: None,
    }
}

#[cfg(test)]
mod tests {
    use super::super::types::{AgentRisk, AgentToolCall, AgentToolName};
    use super::*;
    use crate::ssh::SshManager;
    use std::sync::Arc;

    #[tokio::test]
    async fn high_risk_command_is_blocked_before_ssh_execution() {
        let call = AgentToolCall {
            id: "call-1".into(),
            tool: AgentToolName::RunCommand,
            target_session_id: "missing-session".into(),
            payload: serde_json::json!({ "command": "rm temp.txt" }),
            risk: AgentRisk::ReadOnly,
            reason: "attempt delete".into(),
            expected_result: None,
            verify: None,
        };

        let result = execute_tool(Arc::new(SshManager::new()), call).await;

        assert!(!result.ok);
        assert_eq!(result.call_id, "call-1");
        assert_eq!(result.output, "");
        assert_eq!(result.error.as_deref(), Some("blocked by policy: High"));
        assert!(result.verification.is_none());
    }
}
