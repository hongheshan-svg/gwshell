use crate::state::{terminal_ai_requests, AppState, TerminalAiRequestGuard};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::time::{timeout, Duration};

/// Safety cap on one terminal AI answer.
const TERMINAL_AI_MAX_DURATION_SECS: u64 = 15 * 60;

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
    let user_prompt = crate::agent::prompt::build_terminal_ai_chat_prompt(&request);
    let delta_event = terminal_ai_event_name("delta", &request_id);
    let done_event = terminal_ai_event_name("done", &request_id);
    let error_event = terminal_ai_event_name("error", &request_id);
    let delta_handle = app_handle.clone();
    let guard = TerminalAiRequestGuard::register(&request_id);
    let cancelled = guard.cancelled.clone();

    let result = match timeout(
        Duration::from_secs(TERMINAL_AI_MAX_DURATION_SECS),
        crate::agent::provider::stream_chat_completion(
            settings,
            api_key,
            "You are GWShell's terminal AI assistant. You help diagnose terminal output and suggest safe next commands, but you never execute anything.".to_string(),
            user_prompt,
            move |delta| {
                let _ = delta_handle.emit(&delta_event, serde_json::json!({ "textDelta": delta }));
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
        Ok(full_text) => {
            let _ = app_handle.emit(
                &done_event,
                serde_json::json!({ "text": full_text.clone() }),
            );
            Ok(full_text)
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
