use crate::agent::redaction::redact_secrets;
use crate::agent::types::{AgentToolResult, ChatMessage};
use crate::state::{terminal_ai_requests, AppState, TerminalAiRequestGuard};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::time::{timeout, Duration};

/// Safety cap on one terminal AI answer.
const TERMINAL_AI_MAX_DURATION_SECS: u64 = 15 * 60;
const SSH_CMD_TIMEOUT_SECS: u64 = 30;
const SSH_CMD_OUTPUT_LIMIT: usize = 32 * 1024;

#[tauri::command]
pub fn cancel_terminal_ai_chat(request_id: String) {
    if let Some(flag) = terminal_ai_requests().lock().get(&request_id) {
        flag.store(true, std::sync::atomic::Ordering::Relaxed);
    }
}

fn terminal_ai_event_name(kind: &str, request_id: &str) -> String {
    format!("terminal-ai-{}-{}", kind, request_id)
}

#[tauri::command]
pub async fn run_terminal_ai_chat(
    request: crate::agent::types::TerminalAiChatRequest,
    state: State<'_, Arc<AppState>>,
    app_handle: AppHandle,
) -> Result<String, String> {
    if request.request_id.trim().is_empty() {
        return Err("AI request id is required".to_string());
    }
    if request.question.trim().is_empty() {
        return Err("Question is required".to_string());
    }

    let (settings, api_key) = match crate::agent::runtime::load_provider_for_runtime(state.inner())
        .await?
    {
        crate::agent::runtime::LoadedProvider::Ready { settings, api_key } => (settings, api_key),
        crate::agent::runtime::LoadedProvider::Disabled => {
            return Err("AI provider is disabled".to_string());
        }
        crate::agent::runtime::LoadedProvider::MissingApiKey => {
            return Err("AI API key is not configured".to_string());
        }
    };

    let request_id = request.request_id.clone();
    let system_prompt = crate::agent::prompt::build_terminal_ai_system_prompt(&request);
    let user_prompt = crate::agent::prompt::build_terminal_ai_chat_prompt(&request);

    let mut messages: Vec<ChatMessage> = request
        .history
        .iter()
        .filter(|m| !m.content.trim().is_empty())
        .map(|m| ChatMessage {
            role: if m.role == "assistant" {
                "assistant".to_string()
            } else {
                "user".to_string()
            },
            content: redact_secrets(&m.content),
        })
        .collect();
    messages.push(ChatMessage {
        role: "user".to_string(),
        content: user_prompt,
    });

    let delta_event = terminal_ai_event_name("delta", &request_id);
    let thinking_event = delta_event.clone();
    let done_event = terminal_ai_event_name("done", &request_id);
    let error_event = terminal_ai_event_name("error", &request_id);
    let delta_handle = app_handle.clone();
    let thinking_handle = app_handle.clone();
    let guard = TerminalAiRequestGuard::register(&request_id);
    let cancelled = guard.cancelled.clone();

    let requested_model = settings.model.trim().to_string();
    let result = match timeout(
        Duration::from_secs(TERMINAL_AI_MAX_DURATION_SECS),
        crate::agent::provider::stream_chat_messages_with_meta(
            settings,
            api_key,
            system_prompt,
            messages,
            move |delta| {
                let _ = delta_handle.emit(&delta_event, serde_json::json!({ "textDelta": delta }));
            },
            move |thinking| {
                let _ = thinking_handle.emit(
                    &thinking_event,
                    serde_json::json!({ "thinkingDelta": thinking }),
                );
            },
            move || cancelled.load(std::sync::atomic::Ordering::Relaxed),
        ),
    )
    .await
    {
        Ok(result) => result,
        Err(_) => Err(format!(
            "AI request timed out after {} minutes",
            TERMINAL_AI_MAX_DURATION_SECS / 60
        )),
    };
    drop(guard);

    match result {
        Ok(outcome) => {
            let _ = app_handle.emit(
                &done_event,
                serde_json::json!({
                    "text": outcome.text.clone(),
                    "requestedModel": requested_model,
                    "responseModel": outcome.response_model,
                }),
            );
            Ok(outcome.text)
        }
        Err(error) => {
            let _ = app_handle.emit(
                &error_event,
                serde_json::json!({ "message": error.clone() }),
            );
            Err(error)
        }
    }
}

/// Execute a single human-approved shell command on a connected SSH session and
/// return its redacted stdout/stderr so the AI Agent can analyze the output.
#[tauri::command]
pub async fn run_agent_ssh_command(
    target_session_id: String,
    command: String,
    state: State<'_, Arc<AppState>>,
) -> Result<AgentToolResult, String> {
    let command = command.trim().to_string();
    if target_session_id.trim().is_empty() {
        return Err("SSH session id is required".to_string());
    }
    if command.is_empty() {
        return Err("Command is required".to_string());
    }
    let call_id = uuid::Uuid::new_v4().to_string();
    match timeout(
        Duration::from_secs(SSH_CMD_TIMEOUT_SECS),
        state
            .ssh_manager
            .ssh_exec_with_status(&target_session_id, &command),
    )
    .await
    {
        Ok(Ok(exec_out)) => {
            let combined = match (exec_out.stdout.is_empty(), exec_out.stderr.is_empty()) {
                (false, false) => format!("{}\n[stderr]\n{}", exec_out.stdout, exec_out.stderr),
                (false, true) => exec_out.stdout,
                (true, false) => exec_out.stderr.clone(),
                (true, true) => String::new(),
            };
            let redacted = redact_secrets(&combined);
            let output = if redacted.len() > SSH_CMD_OUTPUT_LIMIT {
                let mut end = SSH_CMD_OUTPUT_LIMIT;
                while end > 0 && !redacted.is_char_boundary(end) {
                    end -= 1;
                }
                format!("{}\n[...output truncated...]", &redacted[..end])
            } else {
                redacted
            };
            let ok = exec_out.exit_code.map_or(true, |c| c == 0);
            let error = if ok {
                None
            } else {
                Some(format!(
                    "Exited with status {}",
                    exec_out.exit_code.unwrap_or(1)
                ))
            };
            Ok(AgentToolResult {
                call_id,
                ok,
                output,
                error,
                verification: None,
            })
        }
        Ok(Err(err)) => Ok(AgentToolResult {
            call_id,
            ok: false,
            output: String::new(),
            error: Some(err),
            verification: None,
        }),
        Err(_) => Ok(AgentToolResult {
            call_id,
            ok: false,
            output: String::new(),
            error: Some(format!("Command timed out after {}s", SSH_CMD_TIMEOUT_SECS)),
            verification: None,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_ai_event_name_uses_tauri_safe_channel_names() {
        assert_eq!(
            terminal_ai_event_name("delta", "request-1"),
            "terminal-ai-delta-request-1"
        );
    }
}
