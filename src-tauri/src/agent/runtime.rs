use crate::ssh::SshManager;
use crate::state::AppState;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Notify;
use tokio::time::{timeout, Duration};

pub enum LoadedProvider {
    Ready {
        settings: crate::agent::types::AiProviderSettings,
        api_key: String,
    },
    Disabled,
    MissingApiKey,
}

/// Load AI provider settings and API key off the async worker thread.
pub async fn load_provider_for_runtime(state: &Arc<AppState>) -> Result<LoadedProvider, String> {
    let state = state.clone();
    tokio::task::spawn_blocking(move || -> Result<LoadedProvider, String> {
        let settings = crate::agent::provider::load_settings(&state.db)?;
        if !settings.enabled {
            return Ok(LoadedProvider::Disabled);
        }
        let api_key = match crate::agent::provider::load_api_key(&state.db)? {
            Some(key) if !key.trim().is_empty() => key,
            _ if crate::agent::provider::provider_requires_api_key(&settings) => {
                return Ok(LoadedProvider::MissingApiKey);
            }
            _ => String::new(),
        };
        Ok(LoadedProvider::Ready { settings, api_key })
    })
    .await
    .map_err(|e| format!("task join: {}", e))?
}

pub fn spawn_agent_session_run(
    state: Arc<AppState>,
    app_handle: AppHandle,
    info: crate::agent::types::AgentSessionInfo,
) {
    tauri::async_runtime::spawn(async move {
        let mut evidence_items = Vec::new();
        for (label, command) in initial_agent_probe_commands() {
            if state.agent_manager.is_cancelled(&info.id) {
                finish_agent_session(
                    &state,
                    &app_handle,
                    &info.id,
                    crate::agent::types::AgentSessionStatus::Cancelled,
                );
                return;
            }

            let output =
                run_agent_probe(state.ssh_manager.clone(), &info.target_session_id, command).await;
            let evidence = crate::agent::types::AgentEvidence {
                id: uuid::Uuid::new_v4().to_string(),
                source: "ssh_exec".into(),
                label: label.to_string(),
                body: crate::agent::redaction::redact_secrets(&output),
                created_at: now_secs(),
            };
            let _ = app_handle.emit(
                &crate::agent::manager::event_name("evidence", &info.id),
                evidence.clone(),
            );
            evidence_items.push(evidence);
        }

        let policy_state = state.clone();
        let policy = tokio::task::spawn_blocking(move || {
            crate::agent::policy::load_settings(&policy_state.db).unwrap_or_default()
        })
        .await
        .unwrap_or_default();
        let alerts = crate::agent::alerts::detect_alerts(&evidence_items, &policy);
        if !alerts.is_empty() {
            let evidence = crate::agent::types::AgentEvidence {
                id: uuid::Uuid::new_v4().to_string(),
                source: "alert_rules".into(),
                label: "Agent alert rules".into(),
                body: alerts.join("\n"),
                created_at: now_secs(),
            };
            let _ = app_handle.emit(
                &crate::agent::manager::event_name("evidence", &info.id),
                evidence.clone(),
            );
            evidence_items.push(evidence);
            if policy.alert_auto_start_agent {
                emit_agent_delta(
                    &app_handle,
                    &info.id,
                    "Alert rules matched current evidence; AI analysis will include these alerts.\n",
                );
            }
        }

        let (settings, api_key) = match load_provider_for_runtime(&state).await {
            Ok(LoadedProvider::Ready { settings, api_key }) => (settings, api_key),
            Ok(LoadedProvider::Disabled) => {
                emit_agent_delta(
                    &app_handle,
                    &info.id,
                    "AI provider is disabled. Collected initial server evidence and local read-only actions are available.\n",
                );
                emit_default_agent_actions(&app_handle, &info);
                finish_agent_session(
                    &state,
                    &app_handle,
                    &info.id,
                    crate::agent::types::AgentSessionStatus::Completed,
                );
                return;
            }
            Ok(LoadedProvider::MissingApiKey) => {
                emit_agent_error(&app_handle, &info.id, "AI API key is not configured");
                emit_default_agent_actions(&app_handle, &info);
                finish_agent_session(
                    &state,
                    &app_handle,
                    &info.id,
                    crate::agent::types::AgentSessionStatus::Failed,
                );
                return;
            }
            Err(error) => {
                emit_agent_error(&app_handle, &info.id, error);
                finish_agent_session(
                    &state,
                    &app_handle,
                    &info.id,
                    crate::agent::types::AgentSessionStatus::Failed,
                );
                return;
            }
        };

        let prompt = crate::agent::prompt::build_user_prompt(&info.objective, &evidence_items, &[]);
        let analysis_event = crate::agent::manager::event_name("analysis-delta", &info.id);
        let stream_app_handle = app_handle.clone();
        let cancel_manager = state.agent_manager.clone();
        let cancel_session_id = info.id.clone();
        let stream_result = crate::agent::provider::stream_chat_completion(
            settings,
            api_key,
            crate::agent::prompt::AGENT_SYSTEM_PROMPT.to_string(),
            prompt,
            move |delta| {
                let _ = stream_app_handle
                    .emit(&analysis_event, serde_json::json!({ "textDelta": delta }));
            },
            move || cancel_manager.is_cancelled(&cancel_session_id),
        )
        .await;

        let full_text = match stream_result {
            Ok(full_text) => full_text,
            Err(error) => {
                if state.agent_manager.is_cancelled(&info.id) {
                    finish_agent_session(
                        &state,
                        &app_handle,
                        &info.id,
                        crate::agent::types::AgentSessionStatus::Cancelled,
                    );
                    return;
                }
                emit_agent_error(&app_handle, &info.id, error);
                emit_default_agent_actions(&app_handle, &info);
                finish_agent_session(
                    &state,
                    &app_handle,
                    &info.id,
                    crate::agent::types::AgentSessionStatus::Failed,
                );
                return;
            }
        };

        if state.agent_manager.is_cancelled(&info.id) {
            finish_agent_session(
                &state,
                &app_handle,
                &info.id,
                crate::agent::types::AgentSessionStatus::Cancelled,
            );
            return;
        }

        match crate::agent::prompt::extract_final_analysis_update(&full_text) {
            Some(update) => {
                let update = normalize_analysis_update(update, &info.target_session_id);
                let _ = app_handle.emit(
                    &crate::agent::manager::event_name("analysis-update", &info.id),
                    update.clone(),
                );
                emit_agent_actions(&state, &app_handle, &info, update.proposed_actions).await;
                finish_agent_session(
                    &state,
                    &app_handle,
                    &info.id,
                    crate::agent::types::AgentSessionStatus::Completed,
                );
            }
            None => {
                emit_agent_error(
                    &app_handle,
                    &info.id,
                    "AI response did not include a valid final analysis JSON object",
                );
                emit_default_agent_actions(&app_handle, &info);
                finish_agent_session(
                    &state,
                    &app_handle,
                    &info.id,
                    crate::agent::types::AgentSessionStatus::Failed,
                );
            }
        }
    });
}

pub fn spawn_agent_plan_draft(
    state: Arc<AppState>,
    app_handle: AppHandle,
    info: crate::agent::types::AgentSessionInfo,
) {
    tauri::async_runtime::spawn(async move {
        let (settings, api_key) = match load_provider_for_runtime(&state).await {
            Ok(LoadedProvider::Ready { settings, api_key }) => (settings, api_key),
            Ok(LoadedProvider::Disabled) => {
                emit_agent_delta(
                    &app_handle,
                    &info.id,
                    "Plan mode: collect host overview, check recent errors, inspect resource pressure, then propose low-risk actions.\n",
                );
                finish_agent_session(
                    &state,
                    &app_handle,
                    &info.id,
                    crate::agent::types::AgentSessionStatus::Completed,
                );
                return;
            }
            Ok(LoadedProvider::MissingApiKey) => {
                emit_agent_error(&app_handle, &info.id, "AI API key is not configured");
                finish_agent_session(
                    &state,
                    &app_handle,
                    &info.id,
                    crate::agent::types::AgentSessionStatus::Failed,
                );
                return;
            }
            Err(error) => {
                emit_agent_error(&app_handle, &info.id, error);
                finish_agent_session(
                    &state,
                    &app_handle,
                    &info.id,
                    crate::agent::types::AgentSessionStatus::Failed,
                );
                return;
            }
        };
        let prompt = format!(
            "Objective:\n{}\n\nCreate a concise troubleshooting plan only. Do not propose executable tool calls yet. Include evidence you would collect first and safety checks before actions.",
            info.objective
        );
        let analysis_event = crate::agent::manager::event_name("analysis-delta", &info.id);
        let stream_app_handle = app_handle.clone();
        let cancel_manager = state.agent_manager.clone();
        let cancel_session_id = info.id.clone();
        let result = crate::agent::provider::stream_chat_completion(
            settings,
            api_key,
            crate::agent::prompt::AGENT_SYSTEM_PROMPT.to_string(),
            prompt,
            move |delta| {
                let _ = stream_app_handle
                    .emit(&analysis_event, serde_json::json!({ "textDelta": delta }));
            },
            move || cancel_manager.is_cancelled(&cancel_session_id),
        )
        .await;
        match result {
            Ok(_) => {
                let status = if state.agent_manager.is_cancelled(&info.id) {
                    crate::agent::types::AgentSessionStatus::Cancelled
                } else {
                    crate::agent::types::AgentSessionStatus::Completed
                };
                finish_agent_session(&state, &app_handle, &info.id, status);
            }
            Err(error) => {
                if state.agent_manager.is_cancelled(&info.id) {
                    finish_agent_session(
                        &state,
                        &app_handle,
                        &info.id,
                        crate::agent::types::AgentSessionStatus::Cancelled,
                    );
                } else {
                    emit_agent_error(&app_handle, &info.id, error);
                    finish_agent_session(
                        &state,
                        &app_handle,
                        &info.id,
                        crate::agent::types::AgentSessionStatus::Failed,
                    );
                }
            }
        }
    });
}

pub fn spawn_agent_continuation(
    state: Arc<AppState>,
    app_handle: AppHandle,
    info: crate::agent::types::AgentSessionInfo,
    request: crate::agent::types::AgentContinuationRequest,
) {
    tauri::async_runtime::spawn(async move {
        let (settings, api_key) = match load_provider_for_runtime(&state).await {
            Ok(LoadedProvider::Ready { settings, api_key }) => (settings, api_key),
            Ok(LoadedProvider::Disabled) => {
                emit_agent_delta(
                    &app_handle,
                    &info.id,
                    "AI provider is disabled. Tool result was recorded, but no follow-up analysis was run.\n",
                );
                finish_agent_session(
                    &state,
                    &app_handle,
                    &info.id,
                    crate::agent::types::AgentSessionStatus::Completed,
                );
                return;
            }
            Ok(LoadedProvider::MissingApiKey) => {
                emit_agent_error(&app_handle, &info.id, "AI API key is not configured");
                finish_agent_session(
                    &state,
                    &app_handle,
                    &info.id,
                    crate::agent::types::AgentSessionStatus::Failed,
                );
                return;
            }
            Err(error) => {
                emit_agent_error(&app_handle, &info.id, error);
                finish_agent_session(
                    &state,
                    &app_handle,
                    &info.id,
                    crate::agent::types::AgentSessionStatus::Failed,
                );
                return;
            }
        };

        let prompt = crate::agent::prompt::build_continuation_prompt(
            &info.objective,
            &request.evidence,
            request.latest_update.as_ref(),
            &request.results,
        );
        let analysis_event = crate::agent::manager::event_name("analysis-delta", &info.id);
        let stream_app_handle = app_handle.clone();
        let cancel_manager = state.agent_manager.clone();
        let cancel_session_id = info.id.clone();
        let stream_result = crate::agent::provider::stream_chat_completion(
            settings,
            api_key,
            crate::agent::prompt::AGENT_SYSTEM_PROMPT.to_string(),
            prompt,
            move |delta| {
                let _ = stream_app_handle
                    .emit(&analysis_event, serde_json::json!({ "textDelta": delta }));
            },
            move || cancel_manager.is_cancelled(&cancel_session_id),
        )
        .await;

        let full_text = match stream_result {
            Ok(full_text) => full_text,
            Err(error) => {
                if state.agent_manager.is_cancelled(&info.id) {
                    finish_agent_session(
                        &state,
                        &app_handle,
                        &info.id,
                        crate::agent::types::AgentSessionStatus::Cancelled,
                    );
                    return;
                }
                emit_agent_error(&app_handle, &info.id, error);
                finish_agent_session(
                    &state,
                    &app_handle,
                    &info.id,
                    crate::agent::types::AgentSessionStatus::Failed,
                );
                return;
            }
        };

        if state.agent_manager.is_cancelled(&info.id) {
            finish_agent_session(
                &state,
                &app_handle,
                &info.id,
                crate::agent::types::AgentSessionStatus::Cancelled,
            );
            return;
        }

        match crate::agent::prompt::extract_final_analysis_update(&full_text) {
            Some(update) => {
                let update = normalize_analysis_update(update, &info.target_session_id);
                let _ = app_handle.emit(
                    &crate::agent::manager::event_name("analysis-update", &info.id),
                    update.clone(),
                );
                emit_agent_actions(&state, &app_handle, &info, update.proposed_actions).await;
                finish_agent_session(
                    &state,
                    &app_handle,
                    &info.id,
                    crate::agent::types::AgentSessionStatus::Completed,
                );
            }
            None => {
                emit_agent_error(
                    &app_handle,
                    &info.id,
                    "AI response did not include a valid final analysis JSON object",
                );
                finish_agent_session(
                    &state,
                    &app_handle,
                    &info.id,
                    crate::agent::types::AgentSessionStatus::Failed,
                );
            }
        }
    });
}

// 8 params: all distinct agent log-stream setup values.
#[allow(clippy::too_many_arguments)]
pub fn spawn_agent_log_stream(
    state: Arc<AppState>,
    app_handle: AppHandle,
    info: crate::agent::types::AgentSessionInfo,
    stream_id: String,
    action: crate::agent::types::AgentToolCall,
    command: String,
    stop: Arc<Notify>,
    policy: crate::agent::types::AgentPolicySettings,
) {
    tauri::async_runtime::spawn(async move {
        let event_name = crate::agent::manager::event_name("evidence", &info.id);
        let stream_label = format!("Live {:?} stream", action.tool);
        let stream_app = app_handle.clone();
        let mut chunk_index = 0usize;
        let result = state
            .ssh_manager
            .ssh_exec_stream(
                &info.target_session_id,
                &command,
                move |chunk| {
                    let raw = String::from_utf8_lossy(&chunk);
                    let Some(filtered) = crate::agent::log_filter::filter_log_chunk(&raw, &policy)
                    else {
                        return;
                    };
                    let body = crate::agent::redaction::redact_secrets(&filtered);
                    if body.trim().is_empty() {
                        return;
                    }
                    chunk_index += 1;
                    let evidence = crate::agent::types::AgentEvidence {
                        id: uuid::Uuid::new_v4().to_string(),
                        source: "live_log".into(),
                        label: format!("{} #{}", stream_label, chunk_index),
                        body,
                        created_at: now_secs(),
                    };
                    let _ = stream_app.emit(&event_name, evidence);
                },
                stop,
            )
            .await;

        state.agent_log_streams.lock().remove(&stream_id);
        match result {
            Ok(()) => emit_agent_delta(&app_handle, &info.id, "Live log stream stopped.\n"),
            Err(error) => emit_agent_error(&app_handle, &info.id, error),
        }
    });
}

fn initial_agent_probe_commands() -> &'static [(&'static str, &'static str)] {
    &[
        (
            "Host, uptime, and filesystem overview",
            "hostname && uptime && uname -a && df -hP",
        ),
        (
            "Memory overview",
            "free -m 2>/dev/null || vm_stat 2>/dev/null || true",
        ),
        (
            "Top CPU processes",
            "(ps -eo pid,ppid,stat,pcpu,pmem,comm --sort=-pcpu 2>/dev/null || ps aux 2>/dev/null) | head -20",
        ),
        ("Filesystem inode overview", "df -ihP 2>/dev/null || true"),
        (
            "Network listeners",
            "ss -tulpn 2>/dev/null | head -60 || netstat -tulpn 2>/dev/null | head -60 || lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | head -60 || true",
        ),
        (
            "Container overview",
            "docker ps --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}' 2>/dev/null | head -40 || true",
        ),
    ]
}

async fn run_agent_probe(ssh: Arc<SshManager>, target_session_id: &str, command: &str) -> String {
    match timeout(
        Duration::from_secs(20),
        ssh.ssh_exec(target_session_id, command),
    )
    .await
    {
        Ok(Ok(output)) => output,
        Ok(Err(error)) => format!("Probe failed: {}", error),
        Err(_) => "Probe timed out after 20 seconds".to_string(),
    }
}

pub fn emit_agent_delta(app_handle: &AppHandle, agent_session_id: &str, text_delta: &str) {
    let _ = app_handle.emit(
        &crate::agent::manager::event_name("analysis-delta", agent_session_id),
        serde_json::json!({ "textDelta": text_delta }),
    );
}

fn emit_agent_error(app_handle: &AppHandle, agent_session_id: &str, message: impl Into<String>) {
    let _ = app_handle.emit(
        &crate::agent::manager::event_name("error", agent_session_id),
        serde_json::json!({ "message": message.into() }),
    );
}

fn emit_default_agent_actions(
    app_handle: &AppHandle,
    info: &crate::agent::types::AgentSessionInfo,
) {
    for action in default_agent_actions(&info.target_session_id) {
        let _ = app_handle.emit(
            &crate::agent::manager::event_name("action-proposed", &info.id),
            action,
        );
    }
}

async fn emit_agent_actions(
    state: &Arc<AppState>,
    app_handle: &AppHandle,
    info: &crate::agent::types::AgentSessionInfo,
    actions: Vec<crate::agent::types::AgentToolCall>,
) {
    let policy = crate::agent::policy::load_settings(&state.db).unwrap_or_default();
    for action in actions {
        let _ = app_handle.emit(
            &crate::agent::manager::event_name("action-proposed", &info.id),
            action.clone(),
        );
        if should_auto_execute_agent_action_with_policy(info, &action, &policy) {
            let result = crate::agent::tools::execute_tool(state.ssh_manager.clone(), action).await;
            let _ = app_handle.emit(
                &crate::agent::manager::event_name("action-result", &info.id),
                result,
            );
        }
    }
}

#[cfg(test)]
fn should_auto_execute_agent_action(
    info: &crate::agent::types::AgentSessionInfo,
    risk: crate::agent::types::AgentRisk,
) -> bool {
    let action = crate::agent::types::AgentToolCall {
        id: "policy-check".into(),
        tool: crate::agent::types::AgentToolName::RunCommand,
        target_session_id: info.target_session_id.clone(),
        payload: serde_json::json!({ "command": "" }),
        risk,
        reason: "policy check".into(),
        expected_result: None,
        verify: None,
    };
    should_auto_execute_agent_action_with_policy(
        info,
        &action,
        &crate::agent::types::AgentPolicySettings::default(),
    )
}

fn should_auto_execute_agent_action_with_policy(
    info: &crate::agent::types::AgentSessionInfo,
    action: &crate::agent::types::AgentToolCall,
    policy: &crate::agent::types::AgentPolicySettings,
) -> bool {
    if info.autonomy != crate::agent::types::AgentAutonomyLevel::PolicyAutoMaintain {
        return false;
    }
    if policy.maintenance_window_enabled && !is_current_maintenance_window(policy) {
        return false;
    }
    let command = action
        .payload
        .get("command")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    if !policy.auto_execute_service_denylist.is_empty() {
        // The denylist protects a service from being touched automatically by
        // ANY route: the RestartService tool, or a RunCommand that reloads /
        // restarts it via systemctl (`systemctl reload x` is Low risk and
        // would otherwise auto-execute regardless of the denylist).
        let service = match action.tool {
            crate::agent::types::AgentToolName::RestartService => action
                .payload
                .get("service")
                .and_then(|value| value.as_str())
                .map(str::to_string),
            crate::agent::types::AgentToolName::RunCommand => crate::agent::risk::systemctl_unit(
                command,
                &[
                    "reload",
                    "restart",
                    "try-restart",
                    "reload-or-restart",
                    "try-reload-or-restart",
                    "stop",
                    "kill",
                ],
            ),
            _ => None,
        };
        if let Some(service) = service {
            let service = service.to_ascii_lowercase();
            if policy.auto_execute_service_denylist.iter().any(|blocked| {
                let blocked = blocked.trim().to_ascii_lowercase();
                !blocked.is_empty() && service.contains(&blocked)
            }) {
                return false;
            }
        }
    }
    if !policy.auto_execute_command_allowlist.is_empty()
        && action.tool == crate::agent::types::AgentToolName::RunCommand
    {
        // Word-prefix match after sudo/env stripping: allowing `systemctl
        // status` admits `systemctl status nginx`, not any command that merely
        // contains those words somewhere.
        if !policy
            .auto_execute_command_allowlist
            .iter()
            .any(|allowed| crate::agent::risk::command_matches_prefix(command, allowed))
        {
            return false;
        }
    }

    match action.risk {
        crate::agent::types::AgentRisk::ReadOnly => policy.auto_execute_read_only,
        crate::agent::types::AgentRisk::Low => policy.auto_execute_low_risk,
        _ => false,
    }
}

fn is_current_maintenance_window(policy: &crate::agent::types::AgentPolicySettings) -> bool {
    // The settings UI takes the window as local wall-clock HH:MM, so compare
    // against LOCAL time (previously UTC, shifting the window by the user's
    // UTC offset — 8 hours for UTC+8).
    let now = jiff::ZonedDateTime::now();
    let now_minutes = (now.hour() as u16) * 60 + now.minute() as u16;
    is_minute_in_maintenance_window(
        now_minutes,
        &policy.maintenance_window_start,
        &policy.maintenance_window_end,
    )
}

fn is_minute_in_maintenance_window(now_minutes: u16, start: &str, end: &str) -> bool {
    let Some(start) = parse_hhmm_minutes(start) else {
        return false;
    };
    let Some(end) = parse_hhmm_minutes(end) else {
        return false;
    };
    if start <= end {
        now_minutes >= start && now_minutes <= end
    } else {
        now_minutes >= start || now_minutes <= end
    }
}

fn parse_hhmm_minutes(value: &str) -> Option<u16> {
    let (hours, minutes) = value.split_once(':')?;
    let hours = hours.parse::<u16>().ok()?;
    let minutes = minutes.parse::<u16>().ok()?;
    if hours > 23 || minutes > 59 {
        return None;
    }
    Some(hours * 60 + minutes)
}

fn default_agent_actions(target_session_id: &str) -> Vec<crate::agent::types::AgentToolCall> {
    vec![
        crate::agent::types::AgentToolCall {
            id: uuid::Uuid::new_v4().to_string(),
            tool: crate::agent::types::AgentToolName::RunCommand,
            target_session_id: target_session_id.to_string(),
            payload: serde_json::json!({ "command": "df -hP /" }),
            risk: crate::agent::types::AgentRisk::ReadOnly,
            reason: "Inspect root filesystem usage".into(),
            expected_result: Some("Shows current root filesystem capacity and usage".into()),
            verify: None,
        },
        crate::agent::types::AgentToolCall {
            id: uuid::Uuid::new_v4().to_string(),
            tool: crate::agent::types::AgentToolName::RunCommand,
            target_session_id: target_session_id.to_string(),
            payload: serde_json::json!({ "command": "uptime" }),
            risk: crate::agent::types::AgentRisk::ReadOnly,
            reason: "Inspect load average and uptime".into(),
            expected_result: Some("Shows whether the host is under sustained load".into()),
            verify: None,
        },
    ]
}

fn normalize_analysis_update(
    mut update: crate::agent::types::AgentAnalysisUpdate,
    target_session_id: &str,
) -> crate::agent::types::AgentAnalysisUpdate {
    for finding in &mut update.findings {
        if finding.id.trim().is_empty() {
            finding.id = uuid::Uuid::new_v4().to_string();
        }
    }
    for action in &mut update.proposed_actions {
        normalize_agent_tool_call(action, target_session_id);
    }
    update
}

pub fn normalize_agent_tool_call(
    call: &mut crate::agent::types::AgentToolCall,
    target_session_id: &str,
) {
    if call.id.trim().is_empty() {
        call.id = uuid::Uuid::new_v4().to_string();
    }
    call.target_session_id = target_session_id.to_string();
    if call.reason.trim().is_empty() {
        call.reason = "Model proposed action".into();
    }
    if let Some(expected_result) = &call.expected_result {
        if expected_result.trim().is_empty() {
            call.expected_result = None;
        }
    }
    if let Some(verify) = call.verify.as_mut() {
        normalize_agent_tool_call(verify, target_session_id);
        if verify.risk != crate::agent::types::AgentRisk::ReadOnly {
            call.verify = None;
        }
    }
    call.risk = crate::agent::risk::classify_tool_call(call);
}

pub fn finish_agent_session(
    state: &Arc<AppState>,
    app_handle: &AppHandle,
    agent_session_id: &str,
    status: crate::agent::types::AgentSessionStatus,
) {
    if let Some(info) = state.agent_manager.finish_session(agent_session_id, status) {
        let _ = app_handle.emit(
            &crate::agent::manager::event_name("session-update", agent_session_id),
            info,
        );
    }
}

pub fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn validate_agent_session_start(
    request: &crate::agent::types::AgentSessionStart,
) -> Result<(), String> {
    if request.target_session_id.trim().is_empty() {
        return Err("Target session is required".into());
    }
    if request.objective.trim().is_empty() {
        return Err("Objective is required".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::types::{AgentAutonomyLevel, AgentSessionInfo, AgentSessionStart};

    #[test]
    fn agent_session_start_validation_rejects_blank_target_session() {
        let request = AgentSessionStart {
            target_session_id: "  ".into(),
            objective: "inspect disk".into(),
            autonomy: AgentAutonomyLevel::Observe,
        };

        assert_eq!(
            validate_agent_session_start(&request),
            Err("Target session is required".to_string())
        );
    }

    #[test]
    fn agent_initial_probes_include_monitoring_evidence() {
        let labels: Vec<&str> = initial_agent_probe_commands()
            .iter()
            .map(|(label, _)| *label)
            .collect();

        assert!(labels.contains(&"Filesystem inode overview"));
        assert!(labels.contains(&"Network listeners"));
        assert!(labels.contains(&"Container overview"));
    }

    #[test]
    fn policy_auto_maintenance_only_auto_executes_low_risk_actions() {
        let mut info = AgentSessionInfo {
            id: "agent-1".into(),
            target_session_id: "ssh-1".into(),
            objective: "maintain".into(),
            autonomy: AgentAutonomyLevel::PolicyAutoMaintain,
            started_at: 1,
            status: crate::agent::types::AgentSessionStatus::Running,
        };

        assert!(should_auto_execute_agent_action(
            &info,
            crate::agent::types::AgentRisk::ReadOnly
        ));
        assert!(should_auto_execute_agent_action(
            &info,
            crate::agent::types::AgentRisk::Low
        ));
        assert!(!should_auto_execute_agent_action(
            &info,
            crate::agent::types::AgentRisk::Medium
        ));
        assert!(!should_auto_execute_agent_action(
            &info,
            crate::agent::types::AgentRisk::High
        ));
        assert!(!should_auto_execute_agent_action(
            &info,
            crate::agent::types::AgentRisk::Blocked
        ));

        info.autonomy = AgentAutonomyLevel::Recommend;
        assert!(!should_auto_execute_agent_action(
            &info,
            crate::agent::types::AgentRisk::ReadOnly
        ));
    }

    fn run_command_action(
        command: &str,
        risk: crate::agent::types::AgentRisk,
    ) -> crate::agent::types::AgentToolCall {
        crate::agent::types::AgentToolCall {
            id: "a".into(),
            tool: crate::agent::types::AgentToolName::RunCommand,
            target_session_id: "ssh-1".into(),
            payload: serde_json::json!({ "command": command }),
            risk,
            reason: "test".into(),
            expected_result: None,
            verify: None,
        }
    }

    fn auto_info() -> AgentSessionInfo {
        AgentSessionInfo {
            id: "agent-1".into(),
            target_session_id: "ssh-1".into(),
            objective: "maintain".into(),
            autonomy: AgentAutonomyLevel::PolicyAutoMaintain,
            started_at: 1,
            status: crate::agent::types::AgentSessionStatus::Running,
        }
    }

    #[test]
    fn command_allowlist_uses_word_prefix_not_substring() {
        let policy = crate::agent::types::AgentPolicySettings {
            auto_execute_command_allowlist: vec!["df".into(), "systemctl status".into()],
            ..Default::default()
        };
        let info = auto_info();
        let ro = crate::agent::types::AgentRisk::ReadOnly;
        assert!(should_auto_execute_agent_action_with_policy(
            &info,
            &run_command_action("df -hP /", ro),
            &policy
        ));
        assert!(should_auto_execute_agent_action_with_policy(
            &info,
            &run_command_action("systemctl status nginx", ro),
            &policy
        ));
        // Merely containing an allowed word is not enough.
        assert!(!should_auto_execute_agent_action_with_policy(
            &info,
            &run_command_action("journalctl -u pdf-render", ro),
            &policy
        ));
    }

    #[test]
    fn service_denylist_also_covers_systemctl_run_commands() {
        let policy = crate::agent::types::AgentPolicySettings {
            auto_execute_service_denylist: vec!["nginx".into()],
            ..Default::default()
        };
        let info = auto_info();
        let low = crate::agent::types::AgentRisk::Low;
        assert!(!should_auto_execute_agent_action_with_policy(
            &info,
            &run_command_action("systemctl reload nginx.service", low),
            &policy
        ));
        assert!(should_auto_execute_agent_action_with_policy(
            &info,
            &run_command_action("systemctl reload postfix", low),
            &policy
        ));
    }

    #[test]
    fn maintenance_window_wraps_midnight() {
        assert!(is_minute_in_maintenance_window(
            23 * 60 + 30,
            "23:00",
            "02:00"
        ));
        assert!(is_minute_in_maintenance_window(60, "23:00", "02:00"));
        assert!(!is_minute_in_maintenance_window(12 * 60, "23:00", "02:00"));
        assert!(is_minute_in_maintenance_window(3 * 60, "02:00", "04:00"));
        assert!(!is_minute_in_maintenance_window(5 * 60, "02:00", "04:00"));
        // The live local-clock path works (tz lookup must not fail/panic).
        let all_day = crate::agent::types::AgentPolicySettings {
            maintenance_window_enabled: true,
            maintenance_window_start: "00:00".into(),
            maintenance_window_end: "23:59".into(),
            ..Default::default()
        };
        assert!(is_current_maintenance_window(&all_day));
    }
}
