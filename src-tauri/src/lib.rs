mod ai_config;
mod ai;
mod ai_platform;
mod database;
mod mcp_config;
mod prompt_config;
mod pty;
mod serial;
mod session;
mod ssh;
mod usage_tracker;

use database::Database;
use parking_lot::Mutex;
use pty::PtyManager;
use serial::SerialManager;
use session::{SessionConfig, SessionGroup};
use ssh::SshManager;
use std::sync::Arc;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    Manager, State,
};

/// Detect system locale and return true if Chinese
fn is_system_chinese() -> bool {
    if let Ok(lang) = std::env::var("LANG") {
        if lang.starts_with("zh") { return true; }
    }
    #[cfg(windows)]
    {
        // Use Windows API directly — instant, no subprocess
        use std::ffi::OsString;
        use std::os::windows::ffi::OsStringExt;
        extern "system" {
            fn GetUserDefaultLocaleName(lp_locale_name: *mut u16, cch_locale_name: i32) -> i32;
        }
        let mut buf = [0u16; 85]; // LOCALE_NAME_MAX_LENGTH
        let len = unsafe { GetUserDefaultLocaleName(buf.as_mut_ptr(), buf.len() as i32) };
        if len > 0 {
            let name = OsString::from_wide(&buf[..((len - 1) as usize)]);
            if let Some(s) = name.to_str() {
                if s.starts_with("zh") { return true; }
            }
        }
    }
    false
}

pub struct AppState {
    pub pty_manager: PtyManager,
    pub ssh_manager: SshManager,
    pub serial_manager: SerialManager,
    pub sessions: Mutex<Vec<SessionConfig>>,
    pub groups: Mutex<Vec<SessionGroup>>,
    pub db: Database,
}

// ---- Platform Info ----

use std::sync::OnceLock;

static OS_INFO: OnceLock<serde_json::Value> = OnceLock::new();

fn compute_os_info() -> serde_json::Value {
    let os = std::env::consts::OS;
    let mut info = serde_json::json!({ "os": os });

    #[cfg(target_os = "windows")]
    {
        // Parse the Windows build number from `cmd /c ver`
        // e.g. "Microsoft Windows [Version 10.0.22631.4780]"
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let build: u32 = std::process::Command::new("cmd")
            .args(["/c", "ver"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .and_then(|s| {
                let start = s.find('[')?;
                let end = s.find(']')?;
                let ver = &s[start + 1..end]; // "Version 10.0.22631.4780"
                let parts: Vec<&str> = ver.split('.').collect();
                parts.get(2)?.parse().ok()
            })
            .unwrap_or(0);
        info["windowsBuild"] = serde_json::json!(build);
    }

    info
}

#[tauri::command]
fn get_os_info() -> serde_json::Value {
    OS_INFO.get_or_init(compute_os_info).clone()
}

/// Called by the frontend once React has mounted and painted.
/// Shows the main window only when there is real content to display,
/// eliminating the white-flash that occurs when show() is called before
/// the webview finishes parsing HTML/CSS.
#[tauri::command]
async fn app_ready(window: tauri::WebviewWindow) {
    let _ = window.show();
    let _ = window.set_focus();
}

// ---- PTY Commands ----

#[tauri::command]
async fn create_local_shell(
    session_id: String,
    rows: u16,
    cols: u16,
    shell_name: Option<String>,
    working_dir: Option<String>,
    charset: Option<String>,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        state.pty_manager.create_shell(
            &session_id,
            app_handle,
            rows,
            cols,
            shell_name,
            working_dir,
            charset,
        )
    })
    .await
    .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn list_shells() -> Vec<pty::ShellEntry> {
    tokio::task::spawn_blocking(pty::list_available_shells)
        .await
        .unwrap_or_default()
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
async fn ssh_connect(
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
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
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
    })
    .await
    .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn ssh_trust_host(host: String, port: u16, fingerprint: String, key_type: String) {
    let _ = tokio::task::spawn_blocking(move || {
        ssh::trust_host(&host, port, &fingerprint, &key_type);
    })
    .await;
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn start_tunnel(
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
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || -> Result<u16, String> {
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
    })
    .await
    .map_err(|e| format!("task join: {}", e))?
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

// ---- SFTP Commands ----
//
// All SFTP/SSH operations are network I/O. They MUST run off the main thread or
// they will block the WebView's IPC and freeze the UI. Each command extracts an
// owned `Arc<AppState>` and dispatches the synchronous libssh2 work onto a
// `tokio::task::spawn_blocking` worker.

#[tauri::command]
async fn sftp_list(
    session_id: String,
    path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ssh::SftpEntry>, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || state.ssh_manager.sftp_list_dir(&session_id, &path))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn sftp_realpath(
    session_id: String,
    path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || state.ssh_manager.sftp_realpath(&session_id, &path))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn sftp_mkdir(
    session_id: String,
    path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || state.ssh_manager.sftp_mkdir(&session_id, &path))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn sftp_rmdir(
    session_id: String,
    path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || state.ssh_manager.sftp_rmdir(&session_id, &path))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn sftp_delete_file(
    session_id: String,
    path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || state.ssh_manager.sftp_delete_file(&session_id, &path))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn sftp_rename(
    session_id: String,
    old_path: String,
    new_path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state
            .ssh_manager
            .sftp_rename(&session_id, &old_path, &new_path)
    })
    .await
    .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn sftp_download(
    session_id: String,
    remote_path: String,
    local_path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state
            .ssh_manager
            .sftp_download(&session_id, &remote_path, &local_path)
    })
    .await
    .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn sftp_upload(
    session_id: String,
    remote_path: String,
    local_path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state
            .ssh_manager
            .sftp_upload(&session_id, &remote_path, &local_path)
    })
    .await
    .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn sftp_open_file(
    session_id: String,
    remote_path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || -> Result<String, String> {
        let file_name = std::path::Path::new(&remote_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("file")
            .to_string();
        let temp_dir = std::env::temp_dir().join("gwshell_sftp");
        std::fs::create_dir_all(&temp_dir)
            .map_err(|e| format!("Create temp dir failed: {}", e))?;
        let local_path = temp_dir.join(&file_name);
        let local_str = local_path.to_string_lossy().to_string();
        state
            .ssh_manager
            .sftp_download(&session_id, &remote_path, &local_str)?;
        Ok(local_str)
    })
    .await
    .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn sftp_read_text(
    session_id: String,
    remote_path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || state.ssh_manager.sftp_read_text(&session_id, &remote_path))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn sftp_write_text(
    session_id: String,
    remote_path: String,
    content: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state
            .ssh_manager
            .sftp_write_text(&session_id, &remote_path, &content)
    })
    .await
    .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn sftp_chmod(
    session_id: String,
    path: String,
    mode: u32,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || state.ssh_manager.sftp_chmod(&session_id, &path, mode))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn sftp_create_file(
    session_id: String,
    path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || state.ssh_manager.sftp_create_file(&session_id, &path))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn ssh_exec(
    session_id: String,
    command: String,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || state.ssh_manager.ssh_exec(&session_id, &command))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

// ---- Ping Command ----

#[tauri::command]
async fn ping_host(host: String, port: u16) -> Result<f64, String> {
    use std::time::Instant;
    use tokio::net::TcpStream;
    use tokio::time::{timeout, Duration};

    let addr = format!("{}:{}", host, port);
    let start = Instant::now();
    match timeout(Duration::from_secs(3), TcpStream::connect(&addr)).await {
        Ok(Ok(_)) => {
            let elapsed = start.elapsed().as_secs_f64() * 1000.0;
            Ok((elapsed * 10.0).round() / 10.0) // round to 0.1ms
        }
        Ok(Err(e)) => Err(format!("Connect failed: {}", e)),
        Err(_) => Err("Timeout".to_string()),
    }
}

// ---- Serial Commands ----

#[tauri::command]
async fn serial_open(
    session_id: String,
    port_name: String,
    baud_rate: u32,
    data_bits: String,
    stop_bits: String,
    parity: String,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        state.serial_manager.open(
            &session_id,
            &port_name,
            baud_rate,
            &data_bits,
            &stop_bits,
            &parity,
            app_handle,
        )
    })
    .await
    .map_err(|e| format!("task join: {}", e))?
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
async fn list_serial_ports() -> Vec<String> {
    tokio::task::spawn_blocking(serial::list_serial_ports)
        .await
        .unwrap_or_default()
}

// ---- Session Management Commands ----
//
// `get_sessions` reads only the in-memory cache (instant, no need to dispatch).
// The mutating ones touch SQLite, so they go through `spawn_blocking`.

#[tauri::command]
async fn save_session(
    config: SessionConfig,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        state.db.save_session(&config)?;
        let mut sessions = state.sessions.lock();
        if let Some(existing) = sessions.iter_mut().find(|s| s.id == config.id) {
            *existing = config;
        } else {
            sessions.push(config);
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
fn get_sessions(state: State<'_, Arc<AppState>>) -> Vec<SessionConfig> {
    // Pure in-memory clone — keep sync to avoid spawn_blocking overhead.
    state.sessions.lock().clone()
}

#[tauri::command]
async fn delete_session(
    session_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        let _ = state.db.delete_session(&session_id);
        state.sessions.lock().retain(|s| s.id != session_id);
    })
    .await
    .map_err(|e| format!("task join: {}", e))
}

#[tauri::command]
async fn save_group(group: SessionGroup, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        state.db.save_group(&group)?;
        let mut groups = state.groups.lock();
        if let Some(existing) = groups.iter_mut().find(|g| g.name == group.name) {
            *existing = group;
        } else {
            groups.push(group);
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
fn get_groups(state: State<'_, Arc<AppState>>) -> Vec<SessionGroup> {
    state.groups.lock().clone()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db = Database::new().expect("Failed to initialize database");
    let initial_sessions = db.get_sessions().unwrap_or_default();
    let initial_groups = db.get_groups().unwrap_or_default();

    let app_state = Arc::new(AppState {
        pty_manager: PtyManager::new(),
        ssh_manager: SshManager::new(),
        serial_manager: SerialManager::new(),
        sessions: Mutex::new(initial_sessions),
        groups: Mutex::new(initial_groups),
        db,
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // When a second instance is launched, focus the existing window
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            app_ready,
            get_os_info,
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
            sftp_list,
            sftp_realpath,
            sftp_mkdir,
            sftp_rmdir,
            sftp_delete_file,
            sftp_rename,
            sftp_download,
            sftp_upload,
            sftp_open_file,
            sftp_read_text,
            sftp_write_text,
            sftp_chmod,
            sftp_create_file,
            ssh_exec,
            ping_host,
            serial_open,
            write_to_serial,
            close_serial,
            list_serial_ports,
            save_session,
            get_sessions,
            delete_session,
            save_group,
            get_groups,
            ai_config::list_ai_providers,
            ai_config::get_ai_active_ids,
            ai_config::save_ai_provider,
            ai_config::delete_ai_provider,
            ai_config::switch_ai_provider,
            ai_config::import_from_cc_switch,
            ai_config::read_ai_current_config,
            mcp_config::list_mcp_servers,
            mcp_config::save_mcp_server,
            mcp_config::delete_mcp_server,
            mcp_config::sync_mcp_servers,
            mcp_config::get_mcp_templates,
            prompt_config::list_prompt_files,
            prompt_config::read_prompt_file,
            prompt_config::write_prompt_file,
            prompt_config::sync_prompt_files,
            prompt_config::get_prompt_templates,
            usage_tracker::add_usage_record,
            usage_tracker::get_usage_summary,
            usage_tracker::clear_usage_records,
            usage_tracker::save_model_pricing,
            usage_tracker::get_model_pricing,
            ai_platform::interfaces::commands::health::ai_platform_health,
            ai_platform::interfaces::commands::providers::ai_platform_list_providers,
            ai_platform::interfaces::commands::providers::ai_platform_save_provider,
            ai_platform::interfaces::commands::providers::ai_platform_delete_provider,
            ai_platform::interfaces::commands::providers::ai_platform_switch_provider,
            ai_platform::interfaces::commands::providers::ai_platform_check_provider_health,
            ai_platform::interfaces::commands::sessions::ai_platform_get_sessions_snapshot,
            ai_platform::interfaces::commands::sessions::ai_platform_delete_session_record,
            ai_platform::interfaces::commands::mcp::ai_platform_get_mcp_snapshot,
            ai_platform::interfaces::commands::mcp::ai_platform_save_mcp_server,
            ai_platform::interfaces::commands::mcp::ai_platform_delete_mcp_server,
            ai_platform::interfaces::commands::mcp::ai_platform_sync_mcp_servers,
            ai_platform::interfaces::commands::openclaw::ai_platform_get_openclaw_snapshot,
            ai_platform::interfaces::commands::openclaw::ai_platform_save_openclaw_config,
            ai_platform::interfaces::commands::proxy::ai_platform_get_proxy_snapshot,
            ai_platform::interfaces::commands::proxy::ai_platform_save_proxy_config,
            ai_platform::interfaces::commands::prompts::ai_platform_get_prompt_snapshot,
            ai_platform::interfaces::commands::prompts::ai_platform_write_prompt_file,
            ai_platform::interfaces::commands::prompts::ai_platform_sync_prompt_files,
            ai_platform::interfaces::commands::skills::ai_platform_get_skills_snapshot,
            ai_platform::interfaces::commands::skills::ai_platform_add_skill_root,
            ai_platform::interfaces::commands::skills::ai_platform_remove_skill_root,
            ai_platform::interfaces::commands::skills::ai_platform_set_skill_enabled,
            ai_platform::interfaces::commands::usage::ai_platform_get_usage_summary,
            ai_platform::interfaces::commands::usage::ai_platform_clear_usage_records,
            ai_platform::interfaces::commands::usage::ai_platform_add_usage_record,
            ai_platform::interfaces::commands::usage::ai_platform_get_model_pricing,
            ai_platform::interfaces::commands::usage::ai_platform_save_model_pricing,
            ai_platform::interfaces::commands::agents::ai_platform_get_agents_snapshot,
            ai_platform::interfaces::commands::agents::ai_platform_set_agent_enabled,
            ai_platform::interfaces::commands::agents::ai_platform_save_agent_assignment,
            ai_platform::interfaces::commands::agents::ai_platform_set_agents_routing_mode,
            ai_platform::interfaces::commands::auth::ai_platform_get_auth_snapshot,
            ai_platform::interfaces::commands::settings::ai_platform_get_settings_snapshot,
            ai_platform::interfaces::commands::settings::ai_platform_save_settings,
            ai_platform::interfaces::commands::workspace::ai_platform_get_workspace_snapshot,
            ai_platform::interfaces::commands::workspace::ai_platform_write_workspace_file,
            ai_platform::interfaces::commands::workspace::ai_platform_create_daily_memory,
            ai_platform::interfaces::commands::workspace::ai_platform_delete_workspace_file,
        ])
        .setup(|app| {
            // Pre-warm OS info cache in a background thread so the first
            // frontend call to get_os_info returns instantly.
            std::thread::spawn(|| { OS_INFO.get_or_init(compute_os_info); });

            // Serialize initial sessions and inject them into the webview via an
            // initialization script so the frontend Zustand store can populate
            // synchronously on the very first render — no IPC round-trip needed.
            let sessions_json = {
                let state = app.state::<Arc<AppState>>();
                let sessions = state.sessions.lock();
                serde_json::to_string(&*sessions).unwrap_or_else(|_| "[]".to_string())
            };
            // Inject sessions AND fire a cheap IPC call to warm up the
            // __TAURI_INTERNALS__ → Rust pipeline before the user clicks anything.
            let init_script = format!(
                "window.__GWSHELL_SESSIONS__={};try{{window.__TAURI_INTERNALS__.invoke('get_os_info')}}catch(e){{}}",
                sessions_json
            );

            // ---- System Tray (created BEFORE the window so that setup()
            //      finishes immediately after show(), letting the event loop
            //      start processing IPC calls without delay) ----
            let zh = is_system_chinese();
            let show_label = if zh { "显示 GWShell" } else { "Show GWShell" };
            let quit_label = if zh { "退出" } else { "Quit" };
            let show_item = MenuItemBuilder::with_id("show", show_label).build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", quit_label).build(app)?;
            let tray_menu = MenuBuilder::new(app)
                .item(&show_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let tray_icon = app.default_window_icon().cloned()
                .unwrap_or_else(|| tauri::image::Image::new_owned(vec![0; 4 * 32 * 32], 32, 32));

            TrayIconBuilder::new()
                .icon(tray_icon)
                .tooltip("GWShell")
                .menu(&tray_menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Create the main window programmatically so we can attach the
            // initialization script (not possible via tauri.conf.json).
            // Built AFTER the tray so that show() is the very last thing
            // in setup — the event loop starts immediately after.
            let _main_window = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("GWShell")
            .inner_size(1280.0, 800.0)
            .min_inner_size(900.0, 600.0)
            .center()
            .decorations(false)
            .transparent(true)
            .resizable(true)
            .visible(true)
            .initialization_script(&init_script)
            .build()?;

            // Window stays hidden until the frontend calls `app_ready`
            // after React has mounted and painted the first frame.
            // This eliminates the white flash on startup.

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running GWShell");
}
