use crate::agent::runtime::{
    emit_agent_delta, finish_agent_session, normalize_agent_tool_call, spawn_agent_continuation,
    spawn_agent_log_stream, spawn_agent_plan_draft, spawn_agent_session_run,
    validate_agent_session_start,
};
use crate::state::AppState;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Notify;

#[tauri::command]
pub async fn load_ai_provider_settings(
    state: State<'_, Arc<AppState>>,
) -> Result<crate::agent::types::AiProviderSettings, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || crate::agent::provider::load_settings(&state.db))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
pub async fn save_ai_provider_settings(
    settings: crate::agent::types::AiProviderSettings,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || crate::agent::provider::save_settings(&state.db, settings))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
pub async fn load_agent_policy_settings(
    state: State<'_, Arc<AppState>>,
) -> Result<crate::agent::types::AgentPolicySettings, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || crate::agent::policy::load_settings(&state.db))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
pub async fn save_agent_policy_settings(
    settings: crate::agent::types::AgentPolicySettings,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || crate::agent::policy::save_settings(&state.db, settings))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
pub async fn set_ai_provider_api_key(
    api_key: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || crate::agent::provider::set_api_key(&state.db, &api_key))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
pub async fn clear_ai_provider_api_key(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || crate::agent::provider::clear_api_key(&state.db))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

/// Pick the key for a "test connection" run with (possibly unsaved) settings.
/// The SAVED key is only ever sent to the SAVED endpoint: otherwise any caller
/// of `test_ai_provider_with_settings` could point `base_url` at an arbitrary
/// server and receive the stored key in the Authorization header, defeating
/// "the API key never leaves the backend except to the configured provider".
fn resolve_ai_provider_test_api_key(
    inline_api_key: Option<String>,
    stored_api_key: Option<String>,
    stored_key_matches_endpoint: bool,
) -> String {
    inline_api_key
        .filter(|key| !key.trim().is_empty())
        .map(|key| key.trim().to_string())
        .or(stored_api_key.filter(|_| stored_key_matches_endpoint))
        .unwrap_or_default()
}

/// Whether two provider configs address the same endpoint (provider kind +
/// base URL, ignoring surrounding whitespace, trailing slashes and case).
fn same_ai_provider_endpoint(
    a: &crate::agent::types::AiProviderSettings,
    b: &crate::agent::types::AiProviderSettings,
) -> bool {
    let norm = |url: &str| url.trim().trim_end_matches('/').to_ascii_lowercase();
    a.provider == b.provider && norm(&a.base_url) == norm(&b.base_url)
}

#[tauri::command]
pub async fn list_agent_audits(
    target_session_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<crate::agent::types::AgentAuditRecord>, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        let rows = state.db.list_agent_audits_raw(&target_session_id)?;
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                serde_json::from_str::<crate::agent::types::AgentAuditRecord>(&row).ok()
            })
            .collect())
    })
    .await
    .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
pub async fn test_ai_provider_with_settings(
    settings: crate::agent::types::AiProviderSettings,
    api_key: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    let state = state.inner().clone();
    let (saved_settings, stored_api_key) =
        tokio::task::spawn_blocking(move || -> Result<_, String> {
            Ok((
                crate::agent::provider::load_settings(&state.db)?,
                crate::agent::provider::load_api_key(&state.db)?,
            ))
        })
        .await
        .map_err(|e| format!("task join: {}", e))??;
    let matches_saved = same_ai_provider_endpoint(&settings, &saved_settings);
    let has_inline_key = api_key.as_deref().is_some_and(|k| !k.trim().is_empty());
    let api_key = resolve_ai_provider_test_api_key(api_key, stored_api_key, matches_saved);
    if crate::agent::provider::provider_requires_api_key(&settings) && api_key.trim().is_empty() {
        if !matches_saved && !has_inline_key {
            return Err(
                "Enter the API key to test this endpoint: the saved key is only sent to the saved provider URL"
                    .to_string(),
            );
        }
        return Err("AI API key is not configured".to_string());
    }

    crate::agent::provider::test_provider_connectivity(settings, api_key).await
}

#[tauri::command]
pub async fn start_agent_session(
    request: crate::agent::types::AgentSessionStart,
    state: State<'_, Arc<AppState>>,
) -> Result<crate::agent::types::AgentSessionInfo, String> {
    validate_agent_session_start(&request)?;
    let state = state.inner().clone();
    let info = state.agent_manager.start_session(request);
    Ok(info)
}

#[tauri::command]
pub async fn run_agent_session(
    agent_session_id: String,
    state: State<'_, Arc<AppState>>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let state = state.inner().clone();
    let info = state
        .agent_manager
        .get_session(&agent_session_id)
        .ok_or_else(|| "Agent session not found".to_string())?;
    if info.status != crate::agent::types::AgentSessionStatus::Running {
        return Err("Agent session is not running".into());
    }
    spawn_agent_session_run(state, app_handle, info);
    Ok(())
}

#[tauri::command]
pub async fn list_agent_sessions(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<crate::agent::types::AgentSessionInfo>, String> {
    Ok(state.agent_manager.list_sessions())
}

#[tauri::command]
pub async fn draft_agent_plan(
    request: crate::agent::types::AgentSessionStart,
    state: State<'_, Arc<AppState>>,
    app_handle: AppHandle,
) -> Result<crate::agent::types::AgentSessionInfo, String> {
    validate_agent_session_start(&request)?;
    let state = state.inner().clone();
    let info = state.agent_manager.start_session(request);
    spawn_agent_plan_draft(state, app_handle, info.clone());
    Ok(info)
}

#[tauri::command]
pub async fn continue_agent_session(
    request: crate::agent::types::AgentContinuationRequest,
    state: State<'_, Arc<AppState>>,
    app_handle: AppHandle,
) -> Result<(), String> {
    if request.agent_session_id.trim().is_empty() {
        return Err("Agent session is required".into());
    }
    if request.results.is_empty() && request.evidence.is_empty() {
        return Err("Evidence or tool result is required".into());
    }

    let state = state.inner().clone();
    let info = state
        .agent_manager
        .get_session(&request.agent_session_id)
        .ok_or_else(|| "Agent session not found".to_string())?;
    if info.status == crate::agent::types::AgentSessionStatus::Cancelled {
        return Err("Agent session is cancelled".into());
    }

    finish_agent_session(
        &state,
        &app_handle,
        &info.id,
        crate::agent::types::AgentSessionStatus::Running,
    );
    spawn_agent_continuation(state, app_handle, info, request);
    Ok(())
}

#[tauri::command]
pub async fn start_agent_log_stream(
    agent_session_id: String,
    action: crate::agent::types::AgentToolCall,
    state: State<'_, Arc<AppState>>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let state = state.inner().clone();
    let info = state
        .agent_manager
        .get_session(&agent_session_id)
        .ok_or_else(|| "Agent session not found".to_string())?;
    if info.status == crate::agent::types::AgentSessionStatus::Cancelled {
        return Err("Agent session is cancelled".into());
    }
    if action.target_session_id != info.target_session_id {
        return Err("Stream action target does not match agent session".into());
    }
    if crate::agent::risk::classify_tool_call(&action) != crate::agent::types::AgentRisk::ReadOnly {
        return Err("Only read-only log streams can be started".into());
    }
    let command = crate::agent::tools::build_stream_command(&action)?;
    let stream_id = uuid::Uuid::new_v4().to_string();
    let stop = Arc::new(Notify::new());
    let policy = crate::agent::policy::load_settings(&state.db).unwrap_or_default();
    state
        .agent_log_streams
        .lock()
        .insert(stream_id.clone(), stop.clone());

    emit_agent_delta(
        &app_handle,
        &info.id,
        "Live log stream started. New log chunks will appear as evidence.\n",
    );
    spawn_agent_log_stream(
        state,
        app_handle,
        info,
        stream_id.clone(),
        action,
        command,
        stop,
        policy,
    );
    Ok(stream_id)
}

#[tauri::command]
pub async fn stop_agent_log_stream(
    stream_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<bool, String> {
    let Some(stop) = state.agent_log_streams.lock().remove(&stream_id) else {
        return Ok(false);
    };
    stop.notify_waiters();
    Ok(true)
}

#[tauri::command]
pub async fn cancel_agent_session(
    agent_session_id: String,
    state: State<'_, Arc<AppState>>,
    app_handle: AppHandle,
) -> Result<bool, String> {
    let cancelled = state.agent_manager.cancel_session(&agent_session_id);
    if cancelled {
        if let Some(info) = state.agent_manager.get_session(&agent_session_id) {
            let _ = app_handle.emit(
                &crate::agent::manager::event_name("session-update", &agent_session_id),
                info,
            );
        }
    }
    Ok(cancelled)
}

#[tauri::command]
pub async fn execute_agent_action(
    mut action: crate::agent::types::AgentToolCall,
    agent_session_id: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<crate::agent::types::AgentToolResult, String> {
    let target_session_id = action.target_session_id.clone();
    normalize_agent_tool_call(&mut action, &target_session_id);
    if let Some(sid) = agent_session_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if let Some(info) = state.agent_manager.get_session(sid) {
            if info.autonomy == crate::agent::types::AgentAutonomyLevel::Observe
                && action.risk != crate::agent::types::AgentRisk::ReadOnly
            {
                return Ok(crate::agent::types::AgentToolResult {
                    call_id: action.id,
                    ok: false,
                    output: String::new(),
                    error: Some(
                        "Session is in observe-only mode; only read-only actions are allowed"
                            .to_string(),
                    ),
                    verification: None,
                });
            }
        }
    }
    let result = crate::agent::tools::execute_tool(state.ssh_manager.clone(), action).await;
    Ok(result)
}

#[tauri::command]
pub async fn save_agent_audit(
    record: crate::agent::types::AgentAuditRecord,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || crate::agent::audit::save_audit(&state.db, &record))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ai_provider_test_uses_inline_key_before_saved_key() {
        assert_eq!(
            resolve_ai_provider_test_api_key(
                Some("  sk-inline  ".to_string()),
                Some("sk-saved".to_string()),
                true
            ),
            "sk-inline"
        );
        assert_eq!(
            resolve_ai_provider_test_api_key(
                Some("  ".to_string()),
                Some("sk-saved".to_string()),
                true
            ),
            "sk-saved"
        );
    }

    #[test]
    fn ai_provider_test_never_sends_saved_key_to_another_endpoint() {
        assert_eq!(
            resolve_ai_provider_test_api_key(None, Some("sk-saved".to_string()), false),
            ""
        );
        let saved = crate::agent::types::AiProviderSettings {
            base_url: "https://api.example.com/v1/".into(),
            ..Default::default()
        };
        let same = crate::agent::types::AiProviderSettings {
            base_url: " HTTPS://api.example.com/v1".into(),
            ..saved.clone()
        };
        let other = crate::agent::types::AiProviderSettings {
            base_url: "https://attacker.example/v1".into(),
            ..saved.clone()
        };
        assert!(same_ai_provider_endpoint(&saved, &same));
        assert!(!same_ai_provider_endpoint(&saved, &other));
    }
}
