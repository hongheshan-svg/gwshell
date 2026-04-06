mod pty;
mod serial;
mod session;
mod ssh;

use parking_lot::Mutex;
use pty::PtyManager;
use serial::SerialManager;
use session::{SessionConfig, SessionGroup};
use ssh::SshManager;
use std::sync::Arc;
use tauri::State;

pub struct AppState {
    pub pty_manager: PtyManager,
    pub ssh_manager: SshManager,
    pub serial_manager: SerialManager,
    pub sessions: Mutex<Vec<SessionConfig>>,
    pub groups: Mutex<Vec<SessionGroup>>,
}

// ---- PTY Commands ----

#[tauri::command]
fn create_local_shell(
    session_id: String,
    rows: u16,
    cols: u16,
    shell_name: Option<String>,
    working_dir: Option<String>,
    charset: Option<String>,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    state
        .pty_manager
        .create_shell(&session_id, app_handle, rows, cols, shell_name, working_dir, charset)
}

#[tauri::command]
fn list_shells() -> Vec<pty::ShellEntry> {
    pty::list_available_shells()
}

#[tauri::command]
fn write_to_pty(
    session_id: String,
    data: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state.pty_manager.write_to_pty(&session_id, data.as_bytes())
}

#[tauri::command]
fn resize_pty(
    session_id: String,
    rows: u16,
    cols: u16,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state.pty_manager.resize_pty(&session_id, rows, cols)
}

#[tauri::command]
fn close_pty(session_id: String, state: State<'_, Arc<AppState>>) {
    state.pty_manager.close_pty(&session_id);
}

// ---- SSH Commands ----

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn ssh_connect(
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
    rows: u32,
    cols: u32,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    state.ssh_manager.connect(
        &session_id,
        &host,
        port,
        &username,
        password.as_deref(),
        private_key_path.as_deref(),
        auth_method.as_deref().unwrap_or("password"),
        totp_code.as_deref(),
        jump_host.as_deref(),
        jump_port.unwrap_or(22),
        jump_username.as_deref(),
        jump_password.as_deref(),
        jump_private_key_path.as_deref(),
        proxy_type.as_deref(),
        proxy_host.as_deref(),
        proxy_port.unwrap_or(1080),
        proxy_username.as_deref(),
        proxy_password.as_deref(),
        connection_timeout.unwrap_or(30),
        app_handle,
        rows,
        cols,
    )
}

#[tauri::command]
fn ssh_trust_host(host: String, port: u16, fingerprint: String, key_type: String) {
    ssh::trust_host(&host, port, &fingerprint, &key_type);
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn start_tunnel(
    _session_id: String,
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
    state: State<'_, Arc<AppState>>,
) -> Result<u16, String> {
    state.ssh_manager.start_local_forward(
        &host,
        port,
        &username,
        password.as_deref(),
        private_key_path.as_deref(),
        auth_method.as_deref().unwrap_or("password"),
        jump_host.as_deref(),
        jump_port.unwrap_or(22),
        jump_username.as_deref(),
        jump_password.as_deref(),
        jump_private_key_path.as_deref(),
        proxy_type.as_deref(),
        proxy_host.as_deref(),
        proxy_port.unwrap_or(1080),
        proxy_username.as_deref(),
        proxy_password.as_deref(),
        local_port,
        &remote_host,
        remote_port,
    )
}


#[tauri::command]
fn write_to_ssh(
    session_id: String,
    data: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state.ssh_manager.write_to_ssh(&session_id, data.as_bytes())
}

#[tauri::command]
fn resize_ssh(
    session_id: String,
    cols: u32,
    rows: u32,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state.ssh_manager.resize_ssh(&session_id, cols, rows)
}

#[tauri::command]
fn close_ssh(session_id: String, state: State<'_, Arc<AppState>>) {
    state.ssh_manager.close_ssh(&session_id);
}

// ---- Serial Commands ----

#[tauri::command]
fn serial_open(
    session_id: String,
    port_name: String,
    baud_rate: u32,
    data_bits: String,
    stop_bits: String,
    parity: String,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    state.serial_manager.open(
        &session_id,
        &port_name,
        baud_rate,
        &data_bits,
        &stop_bits,
        &parity,
        app_handle,
    )
}

#[tauri::command]
fn write_to_serial(
    session_id: String,
    data: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .serial_manager
        .write_to_serial(&session_id, data.as_bytes())
}

#[tauri::command]
fn close_serial(session_id: String, state: State<'_, Arc<AppState>>) {
    state.serial_manager.close_serial(&session_id);
}

#[tauri::command]
fn list_serial_ports() -> Vec<String> {
    serial::list_serial_ports()
}

// ---- Session Management Commands ----

#[tauri::command]
fn save_session(config: SessionConfig, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let mut sessions = state.sessions.lock();
    if let Some(existing) = sessions.iter_mut().find(|s| s.id == config.id) {
        *existing = config;
    } else {
        sessions.push(config);
    }
    Ok(())
}

#[tauri::command]
fn get_sessions(state: State<'_, Arc<AppState>>) -> Vec<SessionConfig> {
    state.sessions.lock().clone()
}

#[tauri::command]
fn delete_session(session_id: String, state: State<'_, Arc<AppState>>) {
    state.sessions.lock().retain(|s| s.id != session_id);
}

#[tauri::command]
fn save_group(group: SessionGroup, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let mut groups = state.groups.lock();
    if let Some(existing) = groups.iter_mut().find(|g| g.name == group.name) {
        *existing = group;
    } else {
        groups.push(group);
    }
    Ok(())
}

#[tauri::command]
fn get_groups(state: State<'_, Arc<AppState>>) -> Vec<SessionGroup> {
    state.groups.lock().clone()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = Arc::new(AppState {
        pty_manager: PtyManager::new(),
        ssh_manager: SshManager::new(),
        serial_manager: SerialManager::new(),
        sessions: Mutex::new(Vec::new()),
        groups: Mutex::new(Vec::new()),
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            create_local_shell,
            list_shells,
            write_to_pty,
            resize_pty,
            close_pty,
            ssh_connect,
            ssh_trust_host,
            start_tunnel,
            write_to_ssh,
            resize_ssh,
            close_ssh,
            serial_open,
            write_to_serial,
            close_serial,
            list_serial_ports,
            save_session,
            get_sessions,
            delete_session,
            save_group,
            get_groups,
        ])
        .run(tauri::generate_context!())
        .expect("error while running GWShell");
}
