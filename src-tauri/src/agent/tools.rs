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

    let command = if call.tool == AgentToolName::RunCommand {
        match call.payload.get("command").and_then(|value| value.as_str()) {
            Some(command) if !command.trim().is_empty() => Some(command.to_string()),
            _ => return failed_result(call.id, "missing or invalid command".to_string()),
        }
    } else {
        None
    };

    let mut result = match call.tool {
        AgentToolName::RunCommand => {
            let command = command.unwrap_or_default();
            match timeout(
                Duration::from_secs(20),
                ssh.ssh_exec(&call.target_session_id, &command),
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
    };

    if result.ok {
        if let Some(verify) = call.verify {
            if classify_tool_call(&verify) == AgentRisk::ReadOnly {
                let verification = Box::pin(execute_tool(ssh.clone(), *verify)).await;
                result.verification = Some(Box::new(verification));
            }
        }
    }

    result
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

    #[tokio::test]
    async fn invalid_run_command_payload_is_policy_blocked_before_ssh_execution() {
        let payloads = [
            serde_json::json!({}),
            serde_json::json!({ "command": 42 }),
            serde_json::json!({ "command": "   " }),
        ];

        for (idx, payload) in payloads.into_iter().enumerate() {
            let call_id = format!("call-invalid-{}", idx);
            let call = AgentToolCall {
                id: call_id.clone(),
                tool: AgentToolName::RunCommand,
                target_session_id: "missing-session".into(),
                payload,
                risk: AgentRisk::ReadOnly,
                reason: "invalid command".into(),
                expected_result: None,
                verify: None,
            };

            let result = execute_tool(Arc::new(SshManager::new()), call).await;

            assert!(!result.ok);
            assert_eq!(result.call_id, call_id);
            assert_eq!(result.output, "");
            assert_eq!(result.error.as_deref(), Some("blocked by policy: Blocked"));
            assert!(result.verification.is_none());
        }
    }

    #[tokio::test]
    async fn unsupported_tool_fails_without_ssh_execution() {
        let call = AgentToolCall {
            id: "call-3".into(),
            tool: AgentToolName::StreamLog,
            target_session_id: "missing-session".into(),
            payload: serde_json::json!({}),
            risk: AgentRisk::ReadOnly,
            reason: "stream logs".into(),
            expected_result: None,
            verify: None,
        };

        let result = execute_tool(Arc::new(SshManager::new()), call).await;

        assert!(!result.ok);
        assert_eq!(result.call_id, "call-3");
        assert_eq!(result.output, "");
        assert_eq!(
            result.error.as_deref(),
            Some("unsupported tool for this action path")
        );
        assert!(result.verification.is_none());
    }
}
