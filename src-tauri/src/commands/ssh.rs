use crate::session;
use crate::ssh;
use crate::state::AppState;
use crate::totp;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn ssh_connect(
    session_id: String,
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key_path: Option<String>,
    auth_method: Option<String>,
    totp_code: Option<String>,
    jump_host: Option<String>,
    jump_port: Option<u16>,
    jump_username: Option<String>,
    jump_password: Option<String>,
    jump_private_key_path: Option<String>,
    proxy_type: Option<String>,
    proxy_host: Option<String>,
    proxy_port: Option<u16>,
    proxy_username: Option<String>,
    proxy_password: Option<String>,
    connection_timeout: Option<u32>,
    idle_disconnect_minutes: Option<u32>,
    agent_forward: Option<bool>,
    keepalive_interval: Option<u64>,
    server_alive_count_max: Option<u32>,
    compression: Option<bool>,
    env_vars: Option<String>,
    rows: u32,
    cols: u32,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let params = ssh::ConnectParams {
        host,
        port,
        username,
        password,
        private_key_path,
        auth_method: auth_method.unwrap_or_else(|| "password".to_string()),
        totp_code,
        jump_host,
        jump_port: jump_port.unwrap_or(22),
        jump_username,
        jump_password,
        jump_private_key_path,
        proxy_type,
        proxy_host,
        proxy_port: proxy_port.unwrap_or(1080),
        proxy_username,
        proxy_password,
        connection_timeout: connection_timeout.unwrap_or(30),
        idle_disconnect_minutes: idle_disconnect_minutes.unwrap_or(0),
        agent_forward: agent_forward.unwrap_or(false),
        keepalive_interval,
        server_alive_count_max,
        compression: compression.unwrap_or(false),
        env_vars,
    };
    state
        .ssh_manager
        .connect(&session_id, params, rows, cols, app_handle)
        .await
}

/// Apply non-secret group default overrides from the frontend onto a saved
/// session copy (only filling fields left blank/unset on the session itself).
fn apply_group_defaults_json(config: &mut session::SessionConfig, defaults: &serde_json::Value) {
    let Some(obj) = defaults.as_object() else {
        return;
    };
    let str_field = |k: &str| {
        obj.get(k)
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from)
    };
    let is_blank = |opt: &Option<String>| opt.as_deref().map_or(true, |s| s.trim().is_empty());
    if is_blank(&config.username) {
        if let Some(v) = str_field("username") {
            config.username = Some(v);
        }
    }
    if config.port.is_none() {
        if let Some(p) = obj.get("port").and_then(|v| v.as_u64()) {
            if let Ok(p) = u16::try_from(p) {
                config.port = Some(p);
            }
        }
    }
    if is_blank(&config.private_key_path) {
        if let Some(v) = str_field("private_key_path") {
            config.private_key_path = Some(v);
        }
    }
    if is_blank(&config.jump_host) {
        if let Some(v) = str_field("jump_host") {
            config.jump_host = Some(v);
        }
    }
    if config.jump_port.is_none() {
        if let Some(p) = obj.get("jump_port").and_then(|v| v.as_u64()) {
            if let Ok(p) = u16::try_from(p) {
                config.jump_port = Some(p);
            }
        }
    }
    if is_blank(&config.jump_username) {
        if let Some(v) = str_field("jump_username") {
            config.jump_username = Some(v);
        }
    }
    if is_blank(&config.jump_private_key_path) {
        if let Some(v) = str_field("jump_private_key_path") {
            config.jump_private_key_path = Some(v);
        }
    }
    if config
        .proxy_type
        .as_deref()
        .map_or(true, |s| s.trim().is_empty() || s == "none")
    {
        if let Some(v) = str_field("proxy_type") {
            config.proxy_type = Some(v);
        }
    }
    if is_blank(&config.proxy_host) {
        if let Some(v) = str_field("proxy_host") {
            config.proxy_host = Some(v);
        }
    }
    if config.proxy_port.is_none() {
        if let Some(p) = obj.get("proxy_port").and_then(|v| v.as_u64()) {
            if let Ok(p) = u16::try_from(p) {
                config.proxy_port = Some(p);
            }
        }
    }
    if config.keepalive_interval.is_none() {
        if let Some(k) = obj.get("keepalive_interval").and_then(|v| v.as_u64()) {
            if let Ok(k) = u32::try_from(k) {
                config.keepalive_interval = Some(k);
            }
        }
    }
    if config.agent_forward.is_none() {
        if let Some(b) = obj.get("agent_forward").and_then(|v| v.as_bool()) {
            config.agent_forward = Some(b);
        }
    }
    if is_blank(&config.env_vars) {
        if let Some(v) = str_field("env_vars") {
            config.env_vars = Some(v);
        }
    }
}

#[tauri::command]
pub async fn ssh_connect_saved(
    session_id: String,
    rows: u32,
    cols: u32,
    group_defaults: Option<serde_json::Value>,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let mut config = {
        let sessions = state.sessions.lock();
        sessions
            .iter()
            .find(|session| session.id == session_id)
            .cloned()
            .ok_or_else(|| "Session not found".to_string())?
    };
    if let Some(defaults) = group_defaults.as_ref() {
        apply_group_defaults_json(&mut config, defaults);
    }
    let has_one_time_totp = config
        .totp_code
        .as_deref()
        .is_some_and(totp::is_one_time_code);
    let params = crate::ssh::params::connect_params_from_session(&config);
    if params.host.trim().is_empty() {
        return Err("SSH host is empty".to_string());
    }
    let result = state
        .ssh_manager
        .connect(&session_id, params, rows, cols, app_handle)
        .await;
    // Only consume a one-time MFA code AFTER connect succeeds so a first-contact
    // host-key trust retry still has the code available.
    if result.is_ok() && has_one_time_totp {
        let mut sessions = state.sessions.lock();
        if let Some(session) = sessions.iter_mut().find(|s| s.id == session_id) {
            if session
                .totp_code
                .as_deref()
                .is_some_and(totp::is_one_time_code)
            {
                session.totp_code = None;
            }
        }
    }
    result
}

#[tauri::command]
pub async fn ssh_trust_host(
    host: String,
    port: u16,
    fingerprint: String,
    key_type: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || ssh::trust_host(&host, port, &fingerprint, &key_type))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
#[allow(unused_variables)]
pub async fn start_tunnel(
    session_id: String,
    // Connection params are retained in the IPC contract for backwards
    // compatibility with the frontend, but the russh backend forwards over the
    // already-established session connection rather than dialing a new one.
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key_path: Option<String>,
    auth_method: Option<String>,
    jump_host: Option<String>,
    jump_port: Option<u16>,
    jump_username: Option<String>,
    jump_password: Option<String>,
    jump_private_key_path: Option<String>,
    proxy_type: Option<String>,
    proxy_host: Option<String>,
    proxy_port: Option<u16>,
    proxy_username: Option<String>,
    proxy_password: Option<String>,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
    tunnel_type: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<u16, String> {
    match tunnel_type.as_deref() {
        // Remote (-R): server listens on `local_port` (server bind port), and
        // forwards each inbound connection back to `remote_host:remote_port`.
        Some("remote") => {
            state
                .ssh_manager
                .start_remote_forward(&session_id, local_port, &remote_host, remote_port)
                .await
        }
        // Dynamic (-D): SOCKS5 proxy on local_port; remote_host/remote_port unused.
        Some("dynamic") => {
            state
                .ssh_manager
                .start_socks_forward(&session_id, local_port)
                .await
        }
        // Local (-L) — default and any other value.
        _ => {
            state
                .ssh_manager
                .start_local_forward(&session_id, local_port, &remote_host, remote_port)
                .await
        }
    }
}

#[tauri::command]
pub async fn write_to_ssh(
    session_id: String,
    data: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .ssh_manager
        .write_to_ssh(&session_id, data.as_bytes())
        .await
}

#[tauri::command]
pub async fn resize_ssh(
    session_id: String,
    cols: u32,
    rows: u32,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state.ssh_manager.resize_ssh(&session_id, cols, rows).await
}

#[tauri::command]
pub async fn close_ssh(session_id: String, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let state = state.inner().clone();
    // Force-stop the metrics poller unconditionally regardless of remaining
    // subscriber ref-counts (e.g. ServerPanel + AssetDashboard) so it cannot
    // keep issuing exec probes against a closed connection.
    state.metrics.force_stop(&session_id);
    state.ssh_manager.close_ssh(&session_id).await;
    Ok(())
}
