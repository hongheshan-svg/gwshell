mod crypto;
mod database;
mod metrics;
mod pty;
mod serial;
mod session;
mod ssh;

use database::Database;
use parking_lot::Mutex;
use pty::PtyManager;
use serial::SerialManager;
use session::{SessionConfig, SessionGroup};
use ssh::SshManager;
use std::sync::Arc;
use tauri::{Manager, State};

pub struct AppState {
    pub pty_manager: PtyManager,
    pub ssh_manager: Arc<SshManager>,
    pub serial_manager: SerialManager,
    pub sessions: Mutex<Vec<SessionConfig>>,
    pub groups: Mutex<Vec<SessionGroup>>,
    pub db: Database,
    pub metrics: metrics::MetricsManager,
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

/// Best-effort cleanup on shutdown: stop metric pollers and kill local-shell
/// child processes so they are not orphaned. SSH/serial sockets are reclaimed by
/// the OS on process exit, so we intentionally do NOT block on network teardown
/// (a dead connection's `wait_close` could otherwise hang shutdown).
fn shutdown_cleanup(state: &Arc<AppState>) {
    state.metrics.stop_all();
    state.pty_manager.close_all();
    state.serial_manager.close_all();
}

#[tauri::command]
fn quit_app(app_handle: tauri::AppHandle, state: State<'_, Arc<AppState>>) {
    shutdown_cleanup(state.inner());
    app_handle.exit(0);
    std::process::exit(0);
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

// NOTE: write/resize/close are `async` + `spawn_blocking` so they run on a
// Tokio worker thread, NOT the WebView main thread. A synchronous command would
// execute on the main thread (per Tauri's command model) and, if it blocked on
// the per-session mutex or a congested socket, freeze the entire UI. Keeping the
// input path off the main thread is the core fix for the "freezes on input" bug.
#[tauri::command]
async fn write_to_pty(
    session_id: String,
    data: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || state.pty_manager.write_to_pty(&session_id, data.as_bytes()))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn resize_pty(
    session_id: String,
    rows: u16,
    cols: u16,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || state.pty_manager.resize_pty(&session_id, rows, cols))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn close_pty(session_id: String, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let state = state.inner().clone();
    let _ = tokio::task::spawn_blocking(move || state.pty_manager.close_pty(&session_id)).await;
    Ok(())
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
    idle_disconnect_minutes: Option<u32>,
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
            idle_disconnect_minutes.unwrap_or(0),
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
    session_id: String,
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
            &session_id,
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
async fn write_to_ssh(
    session_id: String,
    data: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || state.ssh_manager.write_to_ssh(&session_id, data.as_bytes()))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn resize_ssh(
    session_id: String,
    cols: u32,
    rows: u32,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || state.ssh_manager.resize_ssh(&session_id, cols, rows))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn close_ssh(session_id: String, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let state = state.inner().clone();
    // Closing also stops the metrics poller bound to this session so it cannot
    // keep issuing exec probes against a dead connection.
    state.metrics.stop(&session_id);
    let _ = tokio::task::spawn_blocking(move || state.ssh_manager.close_ssh(&session_id)).await;
    Ok(())
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
        use std::hash::{Hash, Hasher};
        // Remote paths are POSIX; derive the basename by splitting on '/' rather
        // than std::path::Path, which would apply Windows separator rules on a
        // Windows host (a backslash is a legal char in a Linux filename).
        let file_name = remote_path
            .rsplit('/')
            .find(|s| !s.is_empty())
            .unwrap_or("file");
        // Namespace by a hash of session + full remote path so two different
        // remote files that share a basename don't clobber the same temp file.
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        session_id.hash(&mut hasher);
        remote_path.hash(&mut hasher);
        let temp_dir = std::env::temp_dir()
            .join("gwshell_sftp")
            .join(format!("{:016x}", hasher.finish()));
        std::fs::create_dir_all(&temp_dir)
            .map_err(|e| format!("Create temp dir failed: {}", e))?;
        let local_path = temp_dir.join(file_name);
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

// ---- Server Panel (Metrics) Commands ----

#[tauri::command]
fn start_server_metrics(
    session_id: String,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let ssh = state.ssh_manager.clone();
    state.metrics.start(session_id, ssh, app_handle);
    Ok(())
}

#[tauri::command]
fn stop_server_metrics(session_id: String, state: State<'_, Arc<AppState>>) {
    state.metrics.stop(&session_id);
}

#[tauri::command]
async fn kill_remote_process(
    session_id: String,
    pid: u32,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        let cmd = format!("kill {}", pid);
        state
            .ssh_manager
            .ssh_exec(&session_id, &cmd)
            .map(|_| ())
    })
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
async fn write_to_serial(
    session_id: String,
    data: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state
            .serial_manager
            .write_to_serial(&session_id, data.as_bytes())
    })
    .await
    .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn close_serial(session_id: String, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let state = state.inner().clone();
    let _ = tokio::task::spawn_blocking(move || state.serial_manager.close_serial(&session_id)).await;
    Ok(())
}

#[tauri::command]
async fn list_serial_ports() -> Vec<String> {
    tokio::task::spawn_blocking(serial::list_serial_ports)
        .await
        .unwrap_or_default()
}

// ---- App Settings Commands ----

#[tauri::command]
async fn save_app_settings(value: String, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || state.db.save_app_settings(&value))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn load_app_settings(state: State<'_, Arc<AppState>>) -> Result<Option<String>, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || state.db.load_app_settings())
        .await
        .map_err(|e| format!("task join: {}", e))?
}

// ---- Directory Picker ----

#[tauri::command]
async fn pick_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    tokio::task::spawn_blocking(move || -> Result<Option<String>, String> {
        Ok(app
            .dialog()
            .file()
            .blocking_pick_folder()
            .map(|p| p.to_string()))
    })
    .await
    .map_err(|e| format!("task join: {}", e))?
}

// ---- Storage Operations ----

#[tauri::command]
async fn export_sessions_data(
    path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let json = state.db.export_sessions_json()?;
        std::fs::write(&path, json).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn import_sessions_data(
    path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<usize, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || -> Result<usize, String> {
        let json = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let count = state.db.import_sessions_json(&json)?;
        // Reload sessions into memory
        let sessions = state.db.get_sessions()?;
        *state.sessions.lock() = sessions;
        Ok(count)
    })
    .await
    .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn clear_local_data(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        state.db.clear_all_sessions()?;
        state.sessions.lock().clear();
        Ok(())
    })
    .await
    .map_err(|e| format!("task join: {}", e))?
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
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        // Only drop from the in-memory cache if the DB delete actually succeeded,
        // otherwise the session reappears on next launch (cache/DB divergence).
        state.db.delete_session(&session_id)?;
        state.sessions.lock().retain(|s| s.id != session_id);
        Ok(())
    })
    .await
    .map_err(|e| format!("task join: {}", e))?
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

/// Whether credentials can be encrypted at rest on this machine. When false, the
/// frontend warns the user that saved passwords/TOTP secrets are stored
/// unencrypted (no OS keyring backend is available).
#[tauri::command]
fn secret_storage_available() -> bool {
    crypto::secret_storage_available()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Warm the keyring master key off the main thread so the synchronous session
    // decrypt below overlaps Database::new()'s file I/O instead of blocking cold
    // start on a (one-time, memoized) keychain lookup.
    std::thread::spawn(|| {
        let _ = crypto::secret_storage_available();
    });

    let db = Database::new().expect("Failed to initialize database");
    let initial_sessions = db.get_sessions().unwrap_or_default();
    let initial_groups = db.get_groups().unwrap_or_default();

    let app_state = Arc::new(AppState {
        pty_manager: PtyManager::new(),
        ssh_manager: Arc::new(SshManager::new()),
        serial_manager: SerialManager::new(),
        sessions: Mutex::new(initial_sessions),
        groups: Mutex::new(initial_groups),
        db,
        metrics: metrics::MetricsManager::new(),
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
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            app_ready,
            quit_app,
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
            start_server_metrics,
            stop_server_metrics,
            kill_remote_process,
            ping_host,
            serial_open,
            write_to_serial,
            close_serial,
            list_serial_ports,
            save_app_settings,
            load_app_settings,
            pick_directory,
            export_sessions_data,
            import_sessions_data,
            clear_local_data,
            save_session,
            get_sessions,
            delete_session,
            save_group,
            get_groups,
            secret_storage_available,
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
                concat!(
                    "window.__GWSHELL_SESSIONS__={};",
                    "try{{window.__TAURI_INTERNALS__.invoke('get_os_info')}}catch(e){{}};",
                    // Native click handler for the close button — fires in capture phase,
                    // bypasses React entirely. Uses raw Tauri IPC as a guaranteed exit path.
                    "document.addEventListener('click',function(e){{",
                      "if(e.target&&e.target.closest&&e.target.closest('[data-gw-action=\"exit\"]')){{",
                        "try{{window.__TAURI_INTERNALS__.invoke('plugin:process|exit',{{code:0}})}}catch(_){{}}",
                        "try{{window.__TAURI_INTERNALS__.invoke('quit_app')}}catch(_){{}}",
                      "}}",
                    "}},true);"
                ),
                sessions_json
            );

            // Create the main window programmatically so we can attach the
            // initialization script (not possible via tauri.conf.json).
            // Built AFTER the tray so that show() is the very last thing
            // in setup — the event loop starts immediately after.
            let mut builder = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("GWShell")
            .inner_size(1280.0, 800.0)
            .min_inner_size(900.0, 600.0)
            .center()
            .resizable(true)
            .visible(false)
            .initialization_script(&init_script);

            #[cfg(target_os = "macos")]
            {
                // On macOS use the system-drawn title bar with overlaid traffic
                // lights. Hiding the title text leaves the area available for our
                // own React content but keeps min/zoom/close in the top-left.
                builder = builder
                    .title_bar_style(tauri::TitleBarStyle::Overlay)
                    .hidden_title(true);
                // `decorations` defaults to true here; `transparent` is intentionally
                // NOT set — Overlay + transparent has known compositing artifacts and
                // the OS already provides rounded corners and drop shadow.
            }

            #[cfg(not(target_os = "macos"))]
            {
                builder = builder.decorations(false).transparent(true);
            }

            let main_window = builder.build()?;

            let cleanup_state = app.state::<Arc<AppState>>().inner().clone();
            main_window.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                    shutdown_cleanup(&cleanup_state);
                    std::process::exit(0);
                }
            });

            // Window stays hidden until the frontend calls `app_ready`
            // after React has mounted and painted the first frame.
            // This eliminates the white flash on startup.

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running GWShell");
}
