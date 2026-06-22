use super::redaction::redact_secrets;
use super::risk::classify_tool_call;
use super::stream::{
    docker_logs_tail_command, file_tail_command, journal_tail_command, read_file_head_command,
    restart_service_command, service_status_command,
};
use super::types::{AgentRisk, AgentToolCall, AgentToolName, AgentToolResult};
use crate::ssh::SshManager;
use parking_lot::Mutex;
use std::sync::Arc;
use tokio::sync::Notify;
use tokio::time::{sleep, timeout, Duration};

const EXEC_TIMEOUT_SECS: u64 = 20;
const STREAM_SNAPSHOT_SECS: u64 = 5;
const STREAM_STOP_GRACE_SECS: u64 = 3;
const MAX_TOOL_OUTPUT_BYTES: usize = 128 * 1024;

pub async fn execute_tool(ssh: Arc<SshManager>, call: AgentToolCall) -> AgentToolResult {
    let actual_risk = classify_tool_call(&call);
    if actual_risk == AgentRisk::Blocked || actual_risk == AgentRisk::High {
        return failed_result(call.id, format!("blocked by policy: {:?}", actual_risk));
    }

    let call_id = call.id.clone();
    let target_session_id = call.target_session_id.clone();
    let mut result = match call.tool {
        AgentToolName::RunCommand => {
            let Some(command) = string_payload(&call, "command") else {
                return failed_result(call.id, "missing or invalid command".to_string());
            };
            execute_ssh_command(ssh.clone(), target_session_id, command, call_id).await
        }
        AgentToolName::ReadFile => {
            let Some(path) = string_payload(&call, "path") else {
                return failed_result(call.id, "missing or invalid path".to_string());
            };
            let command = read_file_head_command(&path, lines_payload(&call, 200));
            execute_ssh_command(ssh.clone(), target_session_id, command, call_id).await
        }
        AgentToolName::StreamLog => match stream_log_command(&call) {
            Ok(command) => {
                execute_stream_snapshot(ssh.clone(), target_session_id, command, call_id).await
            }
            Err(error) => failed_result(call.id, error),
        },
        AgentToolName::DockerLogs => {
            let Some(container) = string_payload(&call, "container")
                .or_else(|| string_payload(&call, "container_id"))
                .or_else(|| string_payload(&call, "name"))
            else {
                return failed_result(call.id, "missing or invalid container".to_string());
            };
            let command = docker_logs_tail_command(&container, lines_payload(&call, 200));
            execute_stream_snapshot(ssh.clone(), target_session_id, command, call_id).await
        }
        AgentToolName::RestartService => {
            let Some(service) = string_payload(&call, "service") else {
                return failed_result(call.id, "missing or invalid service".to_string());
            };
            let command = restart_service_command(&service);
            let mut result =
                execute_ssh_command(ssh.clone(), target_session_id, command, call_id).await;
            if result.ok && result.verification.is_none() {
                let verify = AgentToolCall {
                    id: format!("{}-verify", call.id),
                    tool: AgentToolName::RunCommand,
                    target_session_id: call.target_session_id.clone(),
                    payload: serde_json::json!({ "command": service_status_command(&service) }),
                    risk: AgentRisk::ReadOnly,
                    reason: "Verify service status after restart".into(),
                    expected_result: Some(
                        "Service status is active or provides failure details".into(),
                    ),
                    verify: None,
                };
                let verification = Box::pin(execute_tool(ssh.clone(), verify)).await;
                result.verification = Some(Box::new(verification));
            }
            result
        }
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

pub fn build_stream_command(call: &AgentToolCall) -> Result<String, String> {
    match call.tool {
        AgentToolName::StreamLog => stream_log_command(call),
        AgentToolName::DockerLogs => {
            let Some(container) = string_payload(call, "container")
                .or_else(|| string_payload(call, "container_id"))
                .or_else(|| string_payload(call, "name"))
            else {
                return Err("missing or invalid container".to_string());
            };
            Ok(docker_logs_tail_command(
                &container,
                lines_payload(call, 200),
            ))
        }
        _ => Err("action is not a stream tool".to_string()),
    }
}

async fn execute_ssh_command(
    ssh: Arc<SshManager>,
    target_session_id: String,
    command: String,
    call_id: String,
) -> AgentToolResult {
    match timeout(
        Duration::from_secs(EXEC_TIMEOUT_SECS),
        ssh.ssh_exec(&target_session_id, &command),
    )
    .await
    {
        Ok(Ok(output)) => AgentToolResult {
            call_id,
            ok: true,
            output: redact_and_limit(&output),
            error: None,
            verification: None,
        },
        Ok(Err(error)) => failed_result(call_id, error),
        Err(_) => failed_result(call_id, "tool execution timed out".to_string()),
    }
}

async fn execute_stream_snapshot(
    ssh: Arc<SshManager>,
    target_session_id: String,
    command: String,
    call_id: String,
) -> AgentToolResult {
    let collected = Arc::new(Mutex::new(Vec::new()));
    let collected_for_stream = collected.clone();
    let stop = Arc::new(Notify::new());
    let stop_for_stream = stop.clone();
    let mut stream_task = tokio::spawn(async move {
        ssh.ssh_exec_stream(
            &target_session_id,
            &command,
            move |chunk| {
                let mut output = collected_for_stream.lock();
                let remaining = MAX_TOOL_OUTPUT_BYTES.saturating_sub(output.len());
                if remaining > 0 {
                    output.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
                }
            },
            stop_for_stream,
        )
        .await
    });

    sleep(Duration::from_secs(STREAM_SNAPSHOT_SECS)).await;
    stop.notify_waiters();

    let stream_result = timeout(
        Duration::from_secs(STREAM_STOP_GRACE_SECS),
        &mut stream_task,
    )
    .await;
    let output = {
        let collected = collected.lock();
        String::from_utf8_lossy(&collected).to_string()
    };
    let output = if output.trim().is_empty() {
        "(no log output captured during snapshot)".to_string()
    } else {
        redact_and_limit(&output)
    };

    match stream_result {
        Ok(Ok(Ok(()))) => AgentToolResult {
            call_id,
            ok: true,
            output,
            error: None,
            verification: None,
        },
        Ok(Ok(Err(error))) => failed_result(call_id, error),
        Ok(Err(error)) => failed_result(call_id, format!("stream task failed: {}", error)),
        Err(_) => {
            stream_task.abort();
            failed_result(call_id, "stream stop timed out".to_string())
        }
    }
}

fn stream_log_command(call: &AgentToolCall) -> Result<String, String> {
    let lines = lines_payload(call, 200);
    if let Some(path) = string_payload(call, "path") {
        return Ok(file_tail_command(&path, lines));
    }
    if let Some(unit) = string_payload(call, "unit") {
        return Ok(journal_tail_command(Some(&unit), lines));
    }
    if call
        .payload
        .get("source")
        .and_then(|value| value.as_str())
        .is_some_and(|source| source == "journal" || source == "systemd")
    {
        return Ok(journal_tail_command(None, lines));
    }
    Err("missing log path or journal unit".to_string())
}

fn string_payload(call: &AgentToolCall, key: &str) -> Option<String> {
    call.payload
        .get(key)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn lines_payload(call: &AgentToolCall, default: u32) -> u32 {
    call.payload
        .get("lines")
        .and_then(|value| value.as_u64())
        .and_then(|value| u32::try_from(value).ok())
        .unwrap_or(default)
}

fn redact_and_limit(output: &str) -> String {
    let redacted = redact_secrets(output);
    if redacted.len() <= MAX_TOOL_OUTPUT_BYTES {
        return redacted;
    }

    let mut truncated = String::new();
    for ch in redacted.chars() {
        if truncated.len() + ch.len_utf8() > MAX_TOOL_OUTPUT_BYTES {
            break;
        }
        truncated.push(ch);
    }
    truncated.push_str("\n[output truncated by GWShell]");
    truncated
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
            tool: AgentToolName::DockerLogs,
            target_session_id: "missing-session".into(),
            payload: serde_json::json!({}),
            risk: AgentRisk::ReadOnly,
            reason: "docker logs".into(),
            expected_result: None,
            verify: None,
        };

        let result = execute_tool(Arc::new(SshManager::new()), call).await;

        assert!(!result.ok);
        assert_eq!(result.call_id, "call-3");
        assert_eq!(result.output, "");
        assert_eq!(
            result.error.as_deref(),
            Some("missing or invalid container")
        );
        assert!(result.verification.is_none());
    }

    #[test]
    fn builds_stream_log_command_from_path_unit_or_journal_source() {
        let path_call = AgentToolCall {
            id: "call-path".into(),
            tool: AgentToolName::StreamLog,
            target_session_id: "ssh-1".into(),
            payload: serde_json::json!({ "path": "/var/log/app.log", "lines": 50 }),
            risk: AgentRisk::ReadOnly,
            reason: "stream logs".into(),
            expected_result: None,
            verify: None,
        };
        assert_eq!(
            stream_log_command(&path_call).unwrap(),
            "tail -n 50 -F -- '/var/log/app.log'"
        );

        let unit_call = AgentToolCall {
            payload: serde_json::json!({ "unit": "nginx.service" }),
            ..path_call.clone()
        };
        assert_eq!(
            stream_log_command(&unit_call).unwrap(),
            "journalctl -u 'nginx.service' -n 200 -f --no-pager"
        );

        let journal_call = AgentToolCall {
            payload: serde_json::json!({ "source": "journal" }),
            ..path_call
        };
        assert_eq!(
            stream_log_command(&journal_call).unwrap(),
            "journalctl -n 200 -f --no-pager"
        );
    }

    #[test]
    fn builds_public_stream_command_for_live_stream_tools() {
        let stream_call = AgentToolCall {
            id: "call-stream".into(),
            tool: AgentToolName::StreamLog,
            target_session_id: "ssh-1".into(),
            payload: serde_json::json!({ "path": "/var/log/app.log", "lines": 20 }),
            risk: AgentRisk::ReadOnly,
            reason: "stream logs".into(),
            expected_result: None,
            verify: None,
        };
        assert_eq!(
            build_stream_command(&stream_call).unwrap(),
            "tail -n 20 -F -- '/var/log/app.log'"
        );

        let docker_call = AgentToolCall {
            tool: AgentToolName::DockerLogs,
            payload: serde_json::json!({ "container": "web", "lines": 50 }),
            ..stream_call.clone()
        };
        assert_eq!(
            build_stream_command(&docker_call).unwrap(),
            "docker logs --tail=50 -f 'web'"
        );

        let command_call = AgentToolCall {
            tool: AgentToolName::RunCommand,
            payload: serde_json::json!({ "command": "df -hP" }),
            ..stream_call
        };
        assert_eq!(
            build_stream_command(&command_call),
            Err("action is not a stream tool".to_string())
        );
    }
}
