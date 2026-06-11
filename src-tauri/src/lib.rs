mod crypto;
mod database;
mod docker;
mod history;
mod metrics;
mod pty;
mod serial;
mod session;
mod ssh;
mod ssh_config;
mod vault;

use database::Database;
use parking_lot::Mutex;
use pty::PtyManager;
use serial::SerialManager;
use session::SessionConfig;
use ssh::SshManager;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

pub struct AppState {
    pub pty_manager: PtyManager,
    pub ssh_manager: Arc<SshManager>,
    pub serial_manager: SerialManager,
    pub sessions: Mutex<Vec<SessionConfig>>,
    pub db: Database,
    pub metrics: metrics::MetricsManager,
}

// ---- Platform Info ----

use std::sync::OnceLock;

static OS_INFO: OnceLock<serde_json::Value> = OnceLock::new();

fn compute_os_info() -> serde_json::Value {
    let os = std::env::consts::OS;

    #[cfg(target_os = "windows")]
    {
        let mut info = serde_json::json!({ "os": os });
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
        info
    }

    #[cfg(not(target_os = "windows"))]
    {
        serde_json::json!({ "os": os })
    }
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
    shell_integration: Option<bool>,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let integration = shell_integration.unwrap_or(false);
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
            integration,
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

// Terminal input commands only enqueue data/control messages to per-session
// owner threads. The owner threads perform the actual PTY/SSH/serial I/O, so
// these IPC calls return quickly and never wait on a congested socket/device.
#[tauri::command]
async fn write_to_pty(
    session_id: String,
    data: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state.pty_manager.write_to_pty(&session_id, data.as_bytes())
}

#[tauri::command]
async fn resize_pty(
    session_id: String,
    rows: u16,
    cols: u16,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state.pty_manager.resize_pty(&session_id, rows, cols)
}

#[tauri::command]
async fn close_pty(session_id: String, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    state.pty_manager.close_pty(&session_id);
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
    agent_forward: Option<bool>,
    keepalive_interval: Option<u64>,
    server_alive_count_max: Option<u32>,
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
    };
    state
        .ssh_manager
        .connect(&session_id, params, rows, cols, app_handle)
        .await
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
#[allow(unused_variables)]
async fn start_tunnel(
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
        Some("dynamic") => state.ssh_manager.start_socks_forward(&session_id, local_port).await,
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
async fn write_to_ssh(
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
async fn resize_ssh(
    session_id: String,
    cols: u32,
    rows: u32,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state.ssh_manager.resize_ssh(&session_id, cols, rows).await
}

#[tauri::command]
async fn close_ssh(session_id: String, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let state = state.inner().clone();
    // Closing also stops the metrics poller bound to this session so it cannot
    // keep issuing exec probes against a dead connection.
    state.metrics.stop(&session_id);
    state.ssh_manager.close_ssh(&session_id).await;
    Ok(())
}

// ---- SFTP Commands ----
//
// All SFTP/SSH operations are network I/O. The russh backend is fully async, so
// each command simply awaits the manager method on the Tokio runtime — the work
// never blocks the WebView's IPC thread.

#[tauri::command]
async fn sftp_list(
    session_id: String,
    path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ssh::SftpEntry>, String> {
    state.ssh_manager.sftp_list_dir(&session_id, &path).await
}

#[tauri::command]
async fn sftp_realpath(
    session_id: String,
    path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    state.ssh_manager.sftp_realpath(&session_id, &path).await
}

#[tauri::command]
async fn sftp_mkdir(
    session_id: String,
    path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state.ssh_manager.sftp_mkdir(&session_id, &path).await
}

#[tauri::command]
async fn sftp_rmdir(
    session_id: String,
    path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state.ssh_manager.sftp_rmdir(&session_id, &path).await
}

#[tauri::command]
async fn sftp_delete_file(
    session_id: String,
    path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state.ssh_manager.sftp_delete_file(&session_id, &path).await
}

#[tauri::command]
async fn sftp_rename(
    session_id: String,
    old_path: String,
    new_path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .ssh_manager
        .sftp_rename(&session_id, &old_path, &new_path)
        .await
}

/// Build a throttled progress reporter that emits `sftp-progress-{session_id}`
/// events. Chunk callbacks arrive every 256 KiB; intermediate updates are
/// rate-limited to ~10/s, while each file's final chunk always goes through so
/// the bar reaches 100%. The frontend treats the resolution of the invoke
/// itself as the end-of-transfer signal.
fn sftp_progress_emitter(
    app: tauri::AppHandle,
    session_id: &str,
    kind: &'static str,
) -> ssh::ProgressFn {
    use tauri::Emitter;
    let event = format!("sftp-progress-{}", session_id);
    let mut last_emit = std::time::Instant::now() - std::time::Duration::from_secs(1);
    Box::new(move |file, file_index, file_total, bytes, total| {
        let now = std::time::Instant::now();
        let file_finished = total > 0 && bytes >= total;
        if !file_finished && now.duration_since(last_emit) < std::time::Duration::from_millis(100)
        {
            return;
        }
        last_emit = now;
        let _ = app.emit(
            &event,
            serde_json::json!({
                "kind": kind,
                "file": file,
                "fileIndex": file_index,
                "fileTotal": file_total,
                "bytes": bytes,
                "total": total,
            }),
        );
    })
}

#[tauri::command]
async fn sftp_download(
    session_id: String,
    remote_path: String,
    local_path: String,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let progress = sftp_progress_emitter(app_handle, &session_id, "download");
    state
        .ssh_manager
        .sftp_download(&session_id, &remote_path, &local_path, Some(progress))
        .await
}

#[tauri::command]
async fn sftp_upload(
    session_id: String,
    remote_path: String,
    local_path: String,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let progress = sftp_progress_emitter(app_handle, &session_id, "upload");
    state
        .ssh_manager
        .sftp_upload(&session_id, &remote_path, &local_path, Some(progress))
        .await
}

/// Recursively download a remote directory into `local_dir` (the picked
/// destination folder; a subfolder named after the remote dir is created).
/// Returns the number of files transferred.
#[tauri::command]
async fn sftp_download_dir(
    session_id: String,
    remote_path: String,
    local_dir: String,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<usize, String> {
    let progress = sftp_progress_emitter(app_handle, &session_id, "download");
    state
        .ssh_manager
        .sftp_download_dir(&session_id, &remote_path, &local_dir, Some(progress))
        .await
}

/// Recursively upload a local directory into the remote directory
/// `remote_path` (a subfolder named after the local dir is created). Returns
/// the number of files transferred.
#[tauri::command]
async fn sftp_upload_dir(
    session_id: String,
    remote_path: String,
    local_dir: String,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<usize, String> {
    let progress = sftp_progress_emitter(app_handle, &session_id, "upload");
    state
        .ssh_manager
        .sftp_upload_dir(&session_id, &remote_path, &local_dir, Some(progress))
        .await
}

#[tauri::command]
async fn sftp_open_file(
    session_id: String,
    remote_path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
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
    std::fs::create_dir_all(&temp_dir).map_err(|e| format!("Create temp dir failed: {}", e))?;
    let local_path = temp_dir.join(file_name);
    let local_str = local_path.to_string_lossy().to_string();
    state
        .ssh_manager
        .sftp_download(&session_id, &remote_path, &local_str, None)
        .await?;
    Ok(local_str)
}

#[tauri::command]
async fn sftp_read_text(
    session_id: String,
    remote_path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    state
        .ssh_manager
        .sftp_read_text(&session_id, &remote_path)
        .await
}

#[tauri::command]
async fn sftp_write_text(
    session_id: String,
    remote_path: String,
    content: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .ssh_manager
        .sftp_write_text(&session_id, &remote_path, &content)
        .await
}

#[tauri::command]
async fn sftp_chmod(
    session_id: String,
    path: String,
    mode: u32,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state.ssh_manager.sftp_chmod(&session_id, &path, mode).await
}

#[tauri::command]
async fn sftp_create_file(
    session_id: String,
    path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state.ssh_manager.sftp_create_file(&session_id, &path).await
}

// ---- Server Panel (Metrics) Commands ----

// NOTE: must be `async` so Tauri runs it on the async (Tokio) runtime. As a sync
// command it executes on the main thread with no reactor entered, and the
// `tokio::spawn` inside `MetricsManager::start` panics ("there is no reactor
// running"), aborting the whole app the moment the Server panel opens on an SSH tab.
#[tauri::command]
async fn start_server_metrics(
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
    let cmd = format!("kill {}", pid);
    state.ssh_manager.ssh_exec(&session_id, &cmd).await.map(|_| ())
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
    serial_encoding: Option<String>,
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
            serial_encoding.as_deref(),
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
    state
        .serial_manager
        .write_to_serial(&session_id, data.as_bytes())
}

#[tauri::command]
async fn close_serial(session_id: String, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    state.serial_manager.close_serial(&session_id);
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

// ---- Quake (dropdown console) ----

/// Toggle the "main" window between hidden and a top-docked "Quake" dropdown.
///
/// When hidden → reposition the window to the top of the primary monitor,
/// span the full monitor width and half its height, then show + focus.
/// When visible → hide it.
///
/// Monitor geometry is in physical pixels; `set_position`/`set_size` take
/// physical units, so no DPI scaling is applied here. Multi-monitor / mixed-DPI
/// layouts are best-effort (we use whichever monitor Tauri reports).
fn toggle_quake_window(app: &AppHandle) {
    let window = match app.get_webview_window("main") {
        Some(w) => w,
        None => return,
    };

    // Treat any error as "not visible" so a failed query still tries to show.
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }

    // Prefer the monitor the window currently sits on; fall back to primary.
    let monitor = match window.current_monitor() {
        Ok(Some(m)) => Some(m),
        _ => window.primary_monitor().ok().flatten(),
    };

    if let Some(monitor) = monitor {
        let pos = monitor.position();
        let size = monitor.size();
        let _ = window.set_position(tauri::PhysicalPosition { x: pos.x, y: pos.y });
        let _ = window.set_size(tauri::PhysicalSize {
            width: size.width,
            height: size.height / 2,
        });
    }

    let _ = window.show();
    let _ = window.set_focus();
}

// ---- Session Logging ----

/// Append a chunk of terminal output to this session's daily log file under
/// `{data_local_dir}/gwshell/logs/{name}-{YYYY-MM-DD}.log`. The session name is
/// sanitized so it can't escape the logs directory or hit reserved characters.
#[tauri::command]
async fn append_session_log(session_name: String, data: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let safe: String = session_name
            .chars()
            .map(|c| if r#"\/:*?"<>|"#.contains(c) || c.is_control() { '_' } else { c })
            .collect();
        let safe = safe.trim().trim_matches('.');
        let name = if safe.is_empty() { "session" } else { safe };
        let dir = dirs::data_local_dir()
            .ok_or("Cannot determine data directory")?
            .join("gwshell")
            .join("logs");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = dir.join(format!("{}-{}.log", name, chrono_date_today()));
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|e| e.to_string())?;
        f.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| format!("task join: {}", e))?
}

// ---- Command History Commands ----

#[tauri::command]
async fn get_command_history(
    limit: u32,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<crate::history::HistoryEntry>, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || Ok(state.db.load_command_history(limit)))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn save_command_history(
    command: String,
    cwd: Option<String>,
    scope: Option<String>,
    session_type: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    let cwd = cwd.unwrap_or_default();
    let scope = scope.unwrap_or_default();
    let session_type = session_type.unwrap_or_default();
    tokio::task::spawn_blocking(move || {
        state.db.save_command_history(&command, &cwd, &scope, &session_type);
        Ok(())
    })
    .await
    .map_err(|e| format!("task join: {}", e))?
}

// ---- Snippet Commands ----

#[tauri::command]
async fn save_snippet(
    id: String,
    data: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || state.db.save_snippet(&id, &data))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn get_snippets(state: State<'_, Arc<AppState>>) -> Result<Vec<String>, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || state.db.get_snippets())
        .await
        .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn delete_snippet(id: String, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || state.db.delete_snippet(&id))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

// ---- Storage Operations ----

#[tauri::command]
async fn export_sessions_data(path: String, state: State<'_, Arc<AppState>>) -> Result<(), String> {
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

/// Import hosts from an OpenSSH client config as SSH session assets.
///
/// `path` defaults to `~/.ssh/config`. Hosts whose alias matches an existing
/// session name are skipped (idempotent re-import). Returns the number of
/// sessions actually created.
#[tauri::command]
async fn import_ssh_config(
    path: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<usize, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || -> Result<usize, String> {
        let config_path = match path {
            Some(p) => std::path::PathBuf::from(p),
            None => dirs::home_dir()
                .ok_or("Cannot determine home directory")?
                .join(".ssh")
                .join("config"),
        };
        let content = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("{}: {}", config_path.display(), e))?;
        let hosts = ssh_config::parse_ssh_config(&content);

        let mut imported = 0usize;
        let mut sessions = state.sessions.lock();
        for h in hosts {
            if sessions.iter().any(|s| s.name == h.alias) {
                continue;
            }
            let auth_method = if h.identity_file.is_some() {
                session::AuthMethod::PublicKey
            } else {
                session::AuthMethod::Password
            };
            let config = SessionConfig {
                name: h.alias.clone(),
                host: Some(h.host_name.unwrap_or(h.alias)),
                port: h.port,
                username: h.user,
                auth_method,
                private_key_path: h.identity_file.map(|p| ssh_config::expand_tilde(&p)),
                jump_host: h.jump_host,
                jump_port: h.jump_port,
                jump_username: h.jump_user,
                group: Some("SSH Config".to_string()),
                created_at: Some(chrono_date_today()),
                ..Default::default()
            };
            state.db.save_session(&config)?;
            sessions.push(config);
            imported += 1;
        }
        Ok(imported)
    })
    .await
    .map_err(|e| format!("task join: {}", e))?
}

/// Today's date as `YYYY-MM-DD` without pulling in a date crate: civil-date
/// conversion from the Unix epoch (Howard Hinnant's algorithm).
fn chrono_date_today() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = (secs / 86400) as i64 + 719_468;
    let era = days.div_euclid(146_097);
    let doe = days.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { year + 1 } else { year };
    format!("{:04}-{:02}-{:02}", year, month, day)
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
async fn delete_session(session_id: String, state: State<'_, Arc<AppState>>) -> Result<(), String> {
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

/// Whether credentials can be encrypted at rest on this machine. When false, the
/// frontend warns the user that saved passwords/TOTP secrets are stored
/// unencrypted (no OS keyring backend is available).
#[tauri::command]
fn secret_storage_available() -> bool {
    crypto::secret_storage_available()
}

// ---- Vault (master-passphrase app-lock; Argon2id verifier only) ----
//
// The vault is a UI access gate. It does NOT encrypt any secrets — credentials
// stay encrypted by the keyring master key in crypto.rs. Forgetting the
// passphrase therefore never loses data (the vault can simply be reset).

/// Set or change the vault passphrase (stores a fresh Argon2id verifier).
#[tauri::command]
async fn vault_set_passphrase(
    passphrase: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || vault::set_passphrase(&state.db, &passphrase))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

/// Verify a passphrase against the stored verifier. `false` when not enabled.
#[tauri::command]
async fn vault_verify(passphrase: String, state: State<'_, Arc<AppState>>) -> Result<bool, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || vault::verify(&state.db, &passphrase))
        .await
        .map_err(|e| format!("task join: {}", e))
}

/// Disable the vault. Verifies `current_passphrase` first; only clears the
/// verifier if it matches. Returns whether the vault was cleared.
#[tauri::command]
async fn vault_clear(
    current_passphrase: String,
    state: State<'_, Arc<AppState>>,
) -> Result<bool, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || -> Result<bool, String> {
        if !vault::verify(&state.db, &current_passphrase) {
            return Ok(false);
        }
        vault::clear(&state.db)?;
        Ok(true)
    })
    .await
    .map_err(|e| format!("task join: {}", e))?
}

/// Whether the vault is currently enabled (a verifier is present).
#[tauri::command]
async fn vault_is_enabled(state: State<'_, Arc<AppState>>) -> Result<bool, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || vault::is_enabled(&state.db))
        .await
        .map_err(|e| format!("task join: {}", e))
}

/// Atomically verify `current_passphrase` and, if it matches, store a fresh
/// Argon2id hash of `new_passphrase`. Returns `false` (no error) when the
/// current passphrase is wrong — eliminates the verify→set TOCTOU race that
/// the two-call approach exposes.
#[tauri::command]
async fn vault_change_passphrase(
    current_passphrase: String,
    new_passphrase: String,
    state: State<'_, Arc<AppState>>,
) -> Result<bool, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        vault::change_passphrase(&state.db, &current_passphrase, &new_passphrase)
    })
    .await
    .map_err(|e| format!("task join: {}", e))
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

    let app_state = Arc::new(AppState {
        pty_manager: PtyManager::new(),
        ssh_manager: Arc::new(SshManager::new()),
        serial_manager: SerialManager::new(),
        sessions: Mutex::new(initial_sessions),
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
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
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
            sftp_download_dir,
            sftp_upload_dir,
            sftp_open_file,
            sftp_read_text,
            sftp_write_text,
            sftp_chmod,
            sftp_create_file,
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
            export_sessions_data,
            import_sessions_data,
            import_ssh_config,
            clear_local_data,
            save_session,
            get_sessions,
            delete_session,
            secret_storage_available,
            vault_set_passphrase,
            vault_verify,
            vault_clear,
            vault_is_enabled,
            vault_change_passphrase,
            append_session_log,
            get_command_history,
            save_command_history,
            save_snippet,
            get_snippets,
            delete_snippet,
            docker::docker_list_containers,
            docker::docker_exec,
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

            // ---- Quake dropdown console: register global hotkey (opt-in) ----
            //
            // Read the persisted settings blob and, if `quakeEnabled` is true,
            // register `quakeHotkey` as a global shortcut whose handler toggles
            // the main window. Changes take effect on the next launch (v1: no
            // live re-registration). Any failure here is logged and skipped —
            // a bad hotkey must never prevent the app from starting.
            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt;

                let default_hotkey = "CommandOrControl+Shift+Backquote";
                let settings_json = {
                    let state = app.state::<Arc<AppState>>();
                    state.db.load_app_settings().ok().flatten()
                };
                let (quake_enabled, quake_hotkey) = settings_json
                    .as_deref()
                    .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
                    .map(|v| {
                        let enabled = v
                            .get("quakeEnabled")
                            .and_then(|b| b.as_bool())
                            .unwrap_or(false);
                        let hotkey = v
                            .get("quakeHotkey")
                            .and_then(|s| s.as_str())
                            .filter(|s| !s.trim().is_empty())
                            .unwrap_or(default_hotkey)
                            .to_string();
                        (enabled, hotkey)
                    })
                    .unwrap_or((false, default_hotkey.to_string()));

                if quake_enabled {
                    let handle = app.handle().clone();
                    let register = app.global_shortcut().on_shortcut(
                        quake_hotkey.as_str(),
                        move |_app, _shortcut, event| {
                            // Fire on key press only, not on release, to avoid a
                            // double toggle per keystroke.
                            if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed
                            {
                                toggle_quake_window(&handle);
                            }
                        },
                    );
                    if let Err(e) = register {
                        eprintln!("[quake] failed to register hotkey '{}': {}", quake_hotkey, e);
                    }
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running GWShell");
}
