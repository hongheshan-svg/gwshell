mod agent;
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
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Notify;
use tokio::time::{timeout, Duration};

#[cfg(test)]
mod tests {
    use super::*;
    use agent::types::{AgentAutonomyLevel, AgentSessionInfo, AgentSessionStart};
    use session::{AuthMethod, SessionType};

    #[test]
    fn redacted_session_for_frontend_removes_all_inline_secrets() {
        let session = SessionConfig {
            id: "s1".to_string(),
            name: "server".to_string(),
            session_type: SessionType::Ssh,
            host: Some("example.com".to_string()),
            auth_method: AuthMethod::KeyboardInteractive,
            password: Some("password".to_string()),
            totp_code: Some("123456".to_string()),
            jump_password: Some("jump".to_string()),
            proxy_password: Some("proxy".to_string()),
            private_key_path: Some("~/.ssh/id_ed25519".to_string()),
            jump_private_key_path: Some("~/.ssh/jump".to_string()),
            ..Default::default()
        };

        let redacted = redacted_session_for_frontend(&session);

        assert_eq!(redacted.id, "s1");
        assert_eq!(redacted.host.as_deref(), Some("example.com"));
        assert_eq!(
            redacted.private_key_path.as_deref(),
            Some("~/.ssh/id_ed25519")
        );
        assert_eq!(
            redacted.jump_private_key_path.as_deref(),
            Some("~/.ssh/jump")
        );
        assert!(redacted.password.is_none());
        assert!(redacted.totp_code.is_none());
        assert!(redacted.jump_password.is_none());
        assert!(redacted.proxy_password.is_none());
    }

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
            status: agent::types::AgentSessionStatus::Running,
        };

        assert!(should_auto_execute_agent_action(
            &info,
            agent::types::AgentRisk::ReadOnly
        ));
        assert!(should_auto_execute_agent_action(
            &info,
            agent::types::AgentRisk::Low
        ));
        assert!(!should_auto_execute_agent_action(
            &info,
            agent::types::AgentRisk::Medium
        ));
        assert!(!should_auto_execute_agent_action(
            &info,
            agent::types::AgentRisk::High
        ));
        assert!(!should_auto_execute_agent_action(
            &info,
            agent::types::AgentRisk::Blocked
        ));

        info.autonomy = AgentAutonomyLevel::Recommend;
        assert!(!should_auto_execute_agent_action(
            &info,
            agent::types::AgentRisk::ReadOnly
        ));
    }

    #[test]
    fn ai_provider_test_uses_inline_key_before_saved_key() {
        assert_eq!(
            resolve_ai_provider_test_api_key(
                Some("  sk-inline  ".to_string()),
                Some("sk-saved".to_string())
            ),
            "sk-inline"
        );
        assert_eq!(
            resolve_ai_provider_test_api_key(Some("  ".to_string()), Some("sk-saved".to_string())),
            "sk-saved"
        );
    }

    #[test]
    fn terminal_ai_event_name_uses_tauri_safe_channel_names() {
        assert_eq!(
            terminal_ai_event_name("delta", "request-1"),
            "terminal-ai-delta-request-1"
        );
    }
}

pub struct AppState {
    pub pty_manager: PtyManager,
    pub ssh_manager: Arc<SshManager>,
    pub agent_manager: Arc<agent::manager::AgentManager>,
    pub agent_log_streams: Mutex<HashMap<String, Arc<Notify>>>,
    pub serial_manager: SerialManager,
    pub sessions: Mutex<Vec<SessionConfig>>,
    pub db: Database,
    pub metrics: metrics::MetricsManager,
}

fn redacted_session_for_frontend(session: &SessionConfig) -> SessionConfig {
    let mut redacted = session.clone();
    redacted.password = None;
    redacted.totp_code = None;
    redacted.jump_password = None;
    redacted.proxy_password = None;
    redacted
}

fn redacted_sessions_for_frontend(sessions: &[SessionConfig]) -> Vec<SessionConfig> {
    sessions.iter().map(redacted_session_for_frontend).collect()
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
/// the OS on process exit, but we still tell live SSH sessions to close so their
/// reader/writer tasks exit promptly and don't leave a half-open shell on the
/// server. `close_all` only enqueues `ShellCmd::Close` (non-blocking) — it does
/// not `await` the connection's `wait_close`, so it can't hang shutdown.
fn shutdown_cleanup(state: &Arc<AppState>) {
    state.metrics.stop_all();
    for (_, stop) in state.agent_log_streams.lock().drain() {
        stop.notify_waiters();
    }
    state.pty_manager.close_all();
    state.serial_manager.close_all();
    // Gracefully signal SSH sessions + port/SOCKS forwards to stop. Best-effort:
    // if block_on can't run (runtime already torn down) we fall back to OS
    // reclamation, matching the previous behavior.
    tauri::async_runtime::block_on(async {
        state.ssh_manager.close_all().await;
    });
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
async fn ssh_connect_saved(
    session_id: String,
    rows: u32,
    cols: u32,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let config = state
        .sessions
        .lock()
        .iter()
        .find(|session| session.id == session_id)
        .cloned()
        .ok_or_else(|| "Session not found".to_string())?;
    let params = docker::connect_params_from_session(&config);
    if params.host.trim().is_empty() {
        return Err("SSH host is empty".to_string());
    }
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
        if !file_finished && now.duration_since(last_emit) < std::time::Duration::from_millis(100) {
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
    state
        .ssh_manager
        .ssh_exec(&session_id, &cmd)
        .await
        .map(|_| ())
}

#[tauri::command]
async fn detect_remote_os(
    session_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    state.ssh_manager.detect_command_table(&session_id).await
}

// ---- Ping Command ----

#[tauri::command]
async fn ping_host(host: String, port: u16, timeout_secs: Option<u64>) -> Result<f64, String> {
    use std::time::Instant;
    use tokio::net::TcpStream;
    use tokio::time::{timeout, Duration};

    let addr = format!("{}:{}", host, port);
    // Default 5s. Honor the session's configured connection timeout when given,
    // clamped to a sane probe range so a slow host can't be reported as "down"
    // on a 3s hair-trigger, nor hang the poller on a huge configured value.
    let secs = timeout_secs.unwrap_or(5).clamp(2, 10);
    let start = Instant::now();
    match timeout(Duration::from_secs(secs), TcpStream::connect(&addr)).await {
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

#[tauri::command]
async fn load_ai_provider_settings(
    state: State<'_, Arc<AppState>>,
) -> Result<agent::types::AiProviderSettings, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || agent::provider::load_settings(&state.db))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn save_ai_provider_settings(
    settings: agent::types::AiProviderSettings,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || agent::provider::save_settings(&state.db, settings))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn load_agent_policy_settings(
    state: State<'_, Arc<AppState>>,
) -> Result<agent::types::AgentPolicySettings, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || agent::policy::load_settings(&state.db))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn save_agent_policy_settings(
    settings: agent::types::AgentPolicySettings,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || agent::policy::save_settings(&state.db, settings))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn set_ai_provider_api_key(
    api_key: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || agent::provider::set_api_key(&state.db, &api_key))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn clear_ai_provider_api_key(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || agent::provider::clear_api_key(&state.db))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

fn resolve_ai_provider_test_api_key(
    inline_api_key: Option<String>,
    stored_api_key: Option<String>,
) -> String {
    inline_api_key
        .filter(|key| !key.trim().is_empty())
        .map(|key| key.trim().to_string())
        .or(stored_api_key)
        .unwrap_or_default()
}

#[tauri::command]
async fn list_agent_audits(
    target_session_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<agent::types::AgentAuditRecord>, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        let rows = state.db.list_agent_audits_raw(&target_session_id)?;
        Ok(rows
            .into_iter()
            .filter_map(|row| serde_json::from_str::<agent::types::AgentAuditRecord>(&row).ok())
            .collect())
    })
    .await
    .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn test_ai_provider(state: State<'_, Arc<AppState>>) -> Result<String, String> {
    let state = state.inner().clone();
    let (settings, api_key) = tokio::task::spawn_blocking(move || -> Result<_, String> {
        let settings = agent::provider::load_settings(&state.db)?;
        if !settings.enabled {
            return Err("AI provider is disabled".to_string());
        }
        let api_key = agent::provider::load_api_key(&state.db)?.unwrap_or_default();
        if agent::provider::provider_requires_api_key(&settings) && api_key.trim().is_empty() {
            return Err("AI API key is not configured".to_string());
        }
        Ok((settings, api_key))
    })
    .await
    .map_err(|e| format!("task join: {}", e))??;

    agent::provider::test_provider_connectivity(settings, api_key).await
}

#[tauri::command]
async fn test_ai_provider_with_settings(
    settings: agent::types::AiProviderSettings,
    api_key: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    let state = state.inner().clone();
    let stored_api_key =
        tokio::task::spawn_blocking(move || agent::provider::load_api_key(&state.db))
            .await
            .map_err(|e| format!("task join: {}", e))??;
    let api_key = resolve_ai_provider_test_api_key(api_key, stored_api_key);
    if agent::provider::provider_requires_api_key(&settings) && api_key.trim().is_empty() {
        return Err("AI API key is not configured".to_string());
    }

    agent::provider::test_provider_connectivity(settings, api_key).await
}

const TERMINAL_AI_TIMEOUT_GRACE_SECS: u64 = 5;

fn terminal_ai_event_name(kind: &str, request_id: &str) -> String {
    format!("terminal-ai-{}-{}", kind, request_id)
}

#[tauri::command]
async fn run_terminal_ai_chat(
    request: agent::types::TerminalAiChatRequest,
    state: State<'_, Arc<AppState>>,
    app_handle: AppHandle,
) -> Result<String, String> {
    if request.request_id.trim().is_empty() {
        return Err("AI request id is required".to_string());
    }
    if request.question.trim().is_empty() {
        return Err("Question is required".to_string());
    }

    let state = state.inner().clone();
    let (settings, api_key) = tokio::task::spawn_blocking(move || -> Result<_, String> {
        let settings = agent::provider::load_settings(&state.db)?;
        if !settings.enabled {
            return Err("AI provider is disabled".to_string());
        }
        let api_key = agent::provider::load_api_key(&state.db)?.unwrap_or_default();
        if agent::provider::provider_requires_api_key(&settings) && api_key.trim().is_empty() {
            return Err("AI API key is not configured".to_string());
        }
        Ok((settings, api_key))
    })
    .await
    .map_err(|e| format!("task join: {}", e))??;

    let request_id = request.request_id.clone();
    let user_prompt = agent::prompt::build_terminal_ai_chat_prompt(&request);
    let delta_event = terminal_ai_event_name("delta", &request_id);
    let done_event = terminal_ai_event_name("done", &request_id);
    let error_event = terminal_ai_event_name("error", &request_id);
    let delta_handle = app_handle.clone();
    let hard_timeout_secs = settings
        .request_timeout_secs
        .max(1)
        .saturating_add(TERMINAL_AI_TIMEOUT_GRACE_SECS);

    let result = match timeout(
        Duration::from_secs(hard_timeout_secs),
        agent::provider::stream_chat_completion(
            settings,
            api_key,
            "You are GWShell's terminal AI assistant. You help diagnose terminal output and suggest safe next commands, but you never execute anything.".to_string(),
            user_prompt,
            move |delta| {
                let _ = delta_handle.emit(&delta_event, serde_json::json!({ "textDelta": delta }));
            },
            || false,
        ),
    )
    .await
    {
        Ok(result) => result,
        Err(_) => Err(format!(
            "AI request timed out after {} seconds",
            hard_timeout_secs
        )),
    };

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

#[tauri::command]
async fn start_agent_session(
    request: agent::types::AgentSessionStart,
    state: State<'_, Arc<AppState>>,
) -> Result<agent::types::AgentSessionInfo, String> {
    validate_agent_session_start(&request)?;
    let state = state.inner().clone();
    let info = state.agent_manager.start_session(request);
    Ok(info)
}

#[tauri::command]
async fn run_agent_session(
    agent_session_id: String,
    state: State<'_, Arc<AppState>>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let state = state.inner().clone();
    let info = state
        .agent_manager
        .get_session(&agent_session_id)
        .ok_or_else(|| "Agent session not found".to_string())?;
    if info.status != agent::types::AgentSessionStatus::Running {
        return Err("Agent session is not running".into());
    }
    spawn_agent_session_run(state, app_handle, info);
    Ok(())
}

#[tauri::command]
async fn list_agent_sessions(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<agent::types::AgentSessionInfo>, String> {
    Ok(state.agent_manager.list_sessions())
}

#[tauri::command]
async fn draft_agent_plan(
    request: agent::types::AgentSessionStart,
    state: State<'_, Arc<AppState>>,
    app_handle: AppHandle,
) -> Result<agent::types::AgentSessionInfo, String> {
    validate_agent_session_start(&request)?;
    let state = state.inner().clone();
    let info = state.agent_manager.start_session(request);
    spawn_agent_plan_draft(state, app_handle, info.clone());
    Ok(info)
}

#[tauri::command]
async fn continue_agent_session(
    request: agent::types::AgentContinuationRequest,
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
    if info.status == agent::types::AgentSessionStatus::Cancelled {
        return Err("Agent session is cancelled".into());
    }

    finish_agent_session(
        &state,
        &app_handle,
        &info.id,
        agent::types::AgentSessionStatus::Running,
    );
    spawn_agent_continuation(state, app_handle, info, request);
    Ok(())
}

#[tauri::command]
async fn start_agent_log_stream(
    agent_session_id: String,
    action: agent::types::AgentToolCall,
    state: State<'_, Arc<AppState>>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let state = state.inner().clone();
    let info = state
        .agent_manager
        .get_session(&agent_session_id)
        .ok_or_else(|| "Agent session not found".to_string())?;
    if info.status == agent::types::AgentSessionStatus::Cancelled {
        return Err("Agent session is cancelled".into());
    }
    if action.target_session_id != info.target_session_id {
        return Err("Stream action target does not match agent session".into());
    }
    if agent::risk::classify_tool_call(&action) != agent::types::AgentRisk::ReadOnly {
        return Err("Only read-only log streams can be started".into());
    }
    let command = agent::tools::build_stream_command(&action)?;
    let stream_id = uuid::Uuid::new_v4().to_string();
    let stop = Arc::new(Notify::new());
    let policy = agent::policy::load_settings(&state.db).unwrap_or_default();
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
async fn stop_agent_log_stream(
    stream_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<bool, String> {
    let Some(stop) = state.agent_log_streams.lock().remove(&stream_id) else {
        return Ok(false);
    };
    stop.notify_waiters();
    Ok(true)
}

fn spawn_agent_session_run(
    state: Arc<AppState>,
    app_handle: AppHandle,
    info: agent::types::AgentSessionInfo,
) {
    tauri::async_runtime::spawn(async move {
        let mut evidence_items = Vec::new();
        for (label, command) in initial_agent_probe_commands() {
            if state.agent_manager.is_cancelled(&info.id) {
                finish_agent_session(
                    &state,
                    &app_handle,
                    &info.id,
                    agent::types::AgentSessionStatus::Cancelled,
                );
                return;
            }

            let output =
                run_agent_probe(state.ssh_manager.clone(), &info.target_session_id, command).await;
            let evidence = agent::types::AgentEvidence {
                id: uuid::Uuid::new_v4().to_string(),
                source: "ssh_exec".into(),
                label: label.to_string(),
                body: agent::redaction::redact_secrets(&output),
                created_at: now_secs(),
            };
            let _ = app_handle.emit(
                &agent::manager::event_name("evidence", &info.id),
                evidence.clone(),
            );
            evidence_items.push(evidence);
        }

        let settings = match agent::provider::load_settings(&state.db) {
            Ok(settings) => settings,
            Err(error) => {
                emit_agent_error(&app_handle, &info.id, error);
                finish_agent_session(
                    &state,
                    &app_handle,
                    &info.id,
                    agent::types::AgentSessionStatus::Failed,
                );
                return;
            }
        };
        let policy = agent::policy::load_settings(&state.db).unwrap_or_default();
        let alerts = agent::alerts::detect_alerts(&evidence_items, &policy);
        if !alerts.is_empty() {
            let evidence = agent::types::AgentEvidence {
                id: uuid::Uuid::new_v4().to_string(),
                source: "alert_rules".into(),
                label: "Agent alert rules".into(),
                body: alerts.join("\n"),
                created_at: now_secs(),
            };
            let _ = app_handle.emit(
                &agent::manager::event_name("evidence", &info.id),
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

        if !settings.enabled {
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
                agent::types::AgentSessionStatus::Completed,
            );
            return;
        }

        let api_key = match agent::provider::load_api_key(&state.db) {
            Ok(Some(api_key)) => api_key,
            Ok(None) if agent::provider::provider_requires_api_key(&settings) => {
                emit_agent_error(&app_handle, &info.id, "AI API key is not configured");
                emit_default_agent_actions(&app_handle, &info);
                finish_agent_session(
                    &state,
                    &app_handle,
                    &info.id,
                    agent::types::AgentSessionStatus::Failed,
                );
                return;
            }
            Ok(None) => String::new(),
            Err(error) => {
                emit_agent_error(&app_handle, &info.id, error);
                finish_agent_session(
                    &state,
                    &app_handle,
                    &info.id,
                    agent::types::AgentSessionStatus::Failed,
                );
                return;
            }
        };

        let prompt = agent::prompt::build_user_prompt(&info.objective, &evidence_items, &[]);
        let analysis_event = agent::manager::event_name("analysis-delta", &info.id);
        let stream_app_handle = app_handle.clone();
        let cancel_manager = state.agent_manager.clone();
        let cancel_session_id = info.id.clone();
        let stream_result = agent::provider::stream_chat_completion(
            settings,
            api_key,
            agent::prompt::AGENT_SYSTEM_PROMPT.to_string(),
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
                        agent::types::AgentSessionStatus::Cancelled,
                    );
                    return;
                }
                emit_agent_error(&app_handle, &info.id, error);
                emit_default_agent_actions(&app_handle, &info);
                finish_agent_session(
                    &state,
                    &app_handle,
                    &info.id,
                    agent::types::AgentSessionStatus::Failed,
                );
                return;
            }
        };

        if state.agent_manager.is_cancelled(&info.id) {
            finish_agent_session(
                &state,
                &app_handle,
                &info.id,
                agent::types::AgentSessionStatus::Cancelled,
            );
            return;
        }

        match agent::prompt::extract_final_analysis_update(&full_text) {
            Some(update) => {
                let update = normalize_analysis_update(update, &info.target_session_id);
                let _ = app_handle.emit(
                    &agent::manager::event_name("analysis-update", &info.id),
                    update.clone(),
                );
                emit_agent_actions(&state, &app_handle, &info, update.proposed_actions).await;
                finish_agent_session(
                    &state,
                    &app_handle,
                    &info.id,
                    agent::types::AgentSessionStatus::Completed,
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
                    agent::types::AgentSessionStatus::Failed,
                );
            }
        }
    });
}

fn spawn_agent_plan_draft(
    state: Arc<AppState>,
    app_handle: AppHandle,
    info: agent::types::AgentSessionInfo,
) {
    tauri::async_runtime::spawn(async move {
        let settings = match agent::provider::load_settings(&state.db) {
            Ok(settings) => settings,
            Err(error) => {
                emit_agent_error(&app_handle, &info.id, error);
                return;
            }
        };
        if !settings.enabled {
            emit_agent_delta(
                &app_handle,
                &info.id,
                "Plan mode: collect host overview, check recent errors, inspect resource pressure, then propose low-risk actions.\n",
            );
            return;
        }
        let api_key = match agent::provider::load_api_key(&state.db) {
            Ok(Some(api_key)) => api_key,
            Ok(None) if agent::provider::provider_requires_api_key(&settings) => {
                emit_agent_error(&app_handle, &info.id, "AI API key is not configured");
                return;
            }
            Ok(None) => String::new(),
            Err(error) => {
                emit_agent_error(&app_handle, &info.id, error);
                return;
            }
        };
        let prompt = format!(
            "Objective:\n{}\n\nCreate a concise troubleshooting plan only. Do not propose executable tool calls yet. Include evidence you would collect first and safety checks before actions.",
            info.objective
        );
        let analysis_event = agent::manager::event_name("analysis-delta", &info.id);
        let stream_app_handle = app_handle.clone();
        let cancel_manager = state.agent_manager.clone();
        let cancel_session_id = info.id.clone();
        let result = agent::provider::stream_chat_completion(
            settings,
            api_key,
            agent::prompt::AGENT_SYSTEM_PROMPT.to_string(),
            prompt,
            move |delta| {
                let _ = stream_app_handle
                    .emit(&analysis_event, serde_json::json!({ "textDelta": delta }));
            },
            move || cancel_manager.is_cancelled(&cancel_session_id),
        )
        .await;
        if let Err(error) = result {
            emit_agent_error(&app_handle, &info.id, error);
        }
    });
}

fn spawn_agent_continuation(
    state: Arc<AppState>,
    app_handle: AppHandle,
    info: agent::types::AgentSessionInfo,
    request: agent::types::AgentContinuationRequest,
) {
    tauri::async_runtime::spawn(async move {
        let settings = match agent::provider::load_settings(&state.db) {
            Ok(settings) => settings,
            Err(error) => {
                emit_agent_error(&app_handle, &info.id, error);
                finish_agent_session(
                    &state,
                    &app_handle,
                    &info.id,
                    agent::types::AgentSessionStatus::Failed,
                );
                return;
            }
        };

        if !settings.enabled {
            emit_agent_delta(
                &app_handle,
                &info.id,
                "AI provider is disabled. Tool result was recorded, but no follow-up analysis was run.\n",
            );
            finish_agent_session(
                &state,
                &app_handle,
                &info.id,
                agent::types::AgentSessionStatus::Completed,
            );
            return;
        }

        let api_key = match agent::provider::load_api_key(&state.db) {
            Ok(Some(api_key)) => api_key,
            Ok(None) if agent::provider::provider_requires_api_key(&settings) => {
                emit_agent_error(&app_handle, &info.id, "AI API key is not configured");
                finish_agent_session(
                    &state,
                    &app_handle,
                    &info.id,
                    agent::types::AgentSessionStatus::Failed,
                );
                return;
            }
            Ok(None) => String::new(),
            Err(error) => {
                emit_agent_error(&app_handle, &info.id, error);
                finish_agent_session(
                    &state,
                    &app_handle,
                    &info.id,
                    agent::types::AgentSessionStatus::Failed,
                );
                return;
            }
        };

        let prompt = agent::prompt::build_continuation_prompt(
            &info.objective,
            &request.evidence,
            request.latest_update.as_ref(),
            &request.results,
        );
        let analysis_event = agent::manager::event_name("analysis-delta", &info.id);
        let stream_app_handle = app_handle.clone();
        let cancel_manager = state.agent_manager.clone();
        let cancel_session_id = info.id.clone();
        let stream_result = agent::provider::stream_chat_completion(
            settings,
            api_key,
            agent::prompt::AGENT_SYSTEM_PROMPT.to_string(),
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
                        agent::types::AgentSessionStatus::Cancelled,
                    );
                    return;
                }
                emit_agent_error(&app_handle, &info.id, error);
                finish_agent_session(
                    &state,
                    &app_handle,
                    &info.id,
                    agent::types::AgentSessionStatus::Failed,
                );
                return;
            }
        };

        match agent::prompt::extract_final_analysis_update(&full_text) {
            Some(update) => {
                let update = normalize_analysis_update(update, &info.target_session_id);
                let _ = app_handle.emit(
                    &agent::manager::event_name("analysis-update", &info.id),
                    update.clone(),
                );
                emit_agent_actions(&state, &app_handle, &info, update.proposed_actions).await;
                finish_agent_session(
                    &state,
                    &app_handle,
                    &info.id,
                    agent::types::AgentSessionStatus::Completed,
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
                    agent::types::AgentSessionStatus::Failed,
                );
            }
        }
    });
}

fn spawn_agent_log_stream(
    state: Arc<AppState>,
    app_handle: AppHandle,
    info: agent::types::AgentSessionInfo,
    stream_id: String,
    action: agent::types::AgentToolCall,
    command: String,
    stop: Arc<Notify>,
    policy: agent::types::AgentPolicySettings,
) {
    tauri::async_runtime::spawn(async move {
        let event_name = agent::manager::event_name("evidence", &info.id);
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
                    let Some(filtered) = agent::log_filter::filter_log_chunk(&raw, &policy) else {
                        return;
                    };
                    let body = agent::redaction::redact_secrets(&filtered);
                    if body.trim().is_empty() {
                        return;
                    }
                    chunk_index += 1;
                    let evidence = agent::types::AgentEvidence {
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

fn emit_agent_delta(app_handle: &AppHandle, agent_session_id: &str, text_delta: &str) {
    let _ = app_handle.emit(
        &agent::manager::event_name("analysis-delta", agent_session_id),
        serde_json::json!({ "textDelta": text_delta }),
    );
}

fn emit_agent_error(app_handle: &AppHandle, agent_session_id: &str, message: impl Into<String>) {
    let _ = app_handle.emit(
        &agent::manager::event_name("error", agent_session_id),
        serde_json::json!({ "message": message.into() }),
    );
}

fn emit_default_agent_actions(app_handle: &AppHandle, info: &agent::types::AgentSessionInfo) {
    for action in default_agent_actions(&info.target_session_id) {
        let _ = app_handle.emit(
            &agent::manager::event_name("action-proposed", &info.id),
            action,
        );
    }
}

async fn emit_agent_actions(
    state: &Arc<AppState>,
    app_handle: &AppHandle,
    info: &agent::types::AgentSessionInfo,
    actions: Vec<agent::types::AgentToolCall>,
) {
    let policy = agent::policy::load_settings(&state.db).unwrap_or_default();
    for action in actions {
        let _ = app_handle.emit(
            &agent::manager::event_name("action-proposed", &info.id),
            action.clone(),
        );
        if should_auto_execute_agent_action_with_policy(info, &action, &policy) {
            let result = agent::tools::execute_tool(state.ssh_manager.clone(), action).await;
            let _ = app_handle.emit(
                &agent::manager::event_name("action-result", &info.id),
                result,
            );
        }
    }
}

#[cfg(test)]
fn should_auto_execute_agent_action(
    info: &agent::types::AgentSessionInfo,
    risk: agent::types::AgentRisk,
) -> bool {
    let action = agent::types::AgentToolCall {
        id: "policy-check".into(),
        tool: agent::types::AgentToolName::RunCommand,
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
        &agent::types::AgentPolicySettings::default(),
    )
}

fn should_auto_execute_agent_action_with_policy(
    info: &agent::types::AgentSessionInfo,
    action: &agent::types::AgentToolCall,
    policy: &agent::types::AgentPolicySettings,
) -> bool {
    if info.autonomy != agent::types::AgentAutonomyLevel::PolicyAutoMaintain {
        return false;
    }
    if policy.maintenance_window_enabled && !is_current_maintenance_window(policy) {
        return false;
    }
    if !policy.auto_execute_service_denylist.is_empty()
        && action.tool == agent::types::AgentToolName::RestartService
        && action
            .payload
            .get("service")
            .and_then(|value| value.as_str())
            .is_some_and(|service| {
                policy
                    .auto_execute_service_denylist
                    .iter()
                    .any(|blocked| !blocked.trim().is_empty() && service.contains(blocked.trim()))
            })
    {
        return false;
    }
    if !policy.auto_execute_command_allowlist.is_empty()
        && action.tool == agent::types::AgentToolName::RunCommand
    {
        let command = action
            .payload
            .get("command")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        if !policy
            .auto_execute_command_allowlist
            .iter()
            .any(|allowed| !allowed.trim().is_empty() && command.contains(allowed.trim()))
        {
            return false;
        }
    }

    match action.risk {
        agent::types::AgentRisk::ReadOnly => policy.auto_execute_read_only,
        agent::types::AgentRisk::Low => policy.auto_execute_low_risk,
        _ => false,
    }
}

fn is_current_maintenance_window(policy: &agent::types::AgentPolicySettings) -> bool {
    let now_minutes = match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
        Ok(duration) => ((duration.as_secs() / 60) % 1440) as u16,
        Err(_) => return false,
    };
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

fn default_agent_actions(target_session_id: &str) -> Vec<agent::types::AgentToolCall> {
    vec![
        agent::types::AgentToolCall {
            id: uuid::Uuid::new_v4().to_string(),
            tool: agent::types::AgentToolName::RunCommand,
            target_session_id: target_session_id.to_string(),
            payload: serde_json::json!({ "command": "df -hP /" }),
            risk: agent::types::AgentRisk::ReadOnly,
            reason: "Inspect root filesystem usage".into(),
            expected_result: Some("Shows current root filesystem capacity and usage".into()),
            verify: None,
        },
        agent::types::AgentToolCall {
            id: uuid::Uuid::new_v4().to_string(),
            tool: agent::types::AgentToolName::RunCommand,
            target_session_id: target_session_id.to_string(),
            payload: serde_json::json!({ "command": "uptime" }),
            risk: agent::types::AgentRisk::ReadOnly,
            reason: "Inspect load average and uptime".into(),
            expected_result: Some("Shows whether the host is under sustained load".into()),
            verify: None,
        },
    ]
}

fn normalize_analysis_update(
    mut update: agent::types::AgentAnalysisUpdate,
    target_session_id: &str,
) -> agent::types::AgentAnalysisUpdate {
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

fn normalize_agent_tool_call(call: &mut agent::types::AgentToolCall, target_session_id: &str) {
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
        if verify.risk != agent::types::AgentRisk::ReadOnly {
            call.verify = None;
        }
    }
    call.risk = agent::risk::classify_tool_call(call);
}

fn finish_agent_session(
    state: &Arc<AppState>,
    app_handle: &AppHandle,
    agent_session_id: &str,
    status: agent::types::AgentSessionStatus,
) {
    if let Some(info) = state.agent_manager.finish_session(agent_session_id, status) {
        let _ = app_handle.emit(
            &agent::manager::event_name("session-update", agent_session_id),
            info,
        );
    }
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn validate_agent_session_start(request: &agent::types::AgentSessionStart) -> Result<(), String> {
    if request.target_session_id.trim().is_empty() {
        return Err("Target session is required".into());
    }
    if request.objective.trim().is_empty() {
        return Err("Objective is required".into());
    }
    Ok(())
}

#[tauri::command]
async fn cancel_agent_session(
    agent_session_id: String,
    state: State<'_, Arc<AppState>>,
    app_handle: AppHandle,
) -> Result<bool, String> {
    let cancelled = state.agent_manager.cancel_session(&agent_session_id);
    if cancelled {
        if let Some(info) = state.agent_manager.get_session(&agent_session_id) {
            let _ = app_handle.emit(
                &agent::manager::event_name("session-update", &agent_session_id),
                info,
            );
        }
    }
    Ok(cancelled)
}

#[tauri::command]
async fn execute_agent_action(
    action: agent::types::AgentToolCall,
    state: State<'_, Arc<AppState>>,
) -> Result<agent::types::AgentToolResult, String> {
    let result = agent::tools::execute_tool(state.ssh_manager.clone(), action).await;
    Ok(result)
}

#[tauri::command]
async fn save_agent_audit(
    record: agent::types::AgentAuditRecord,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || agent::audit::save_audit(&state.db, &record))
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
            .map(|c| {
                if r#"\/:*?"<>|"#.contains(c) || c.is_control() {
                    '_'
                } else {
                    c
                }
            })
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
        state
            .db
            .save_command_history(&command, &cwd, &scope, &session_type);
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
    // Secrets stay in the Rust process; the WebView receives only metadata.
    let sessions = state.sessions.lock();
    redacted_sessions_for_frontend(&sessions)
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
        agent_manager: Arc::new(agent::manager::AgentManager::new()),
        agent_log_streams: Mutex::new(HashMap::new()),
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
            ssh_connect_saved,
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
            detect_remote_os,
            ping_host,
            serial_open,
            write_to_serial,
            close_serial,
            list_serial_ports,
            save_app_settings,
            load_app_settings,
            load_ai_provider_settings,
            save_ai_provider_settings,
            load_agent_policy_settings,
            save_agent_policy_settings,
            set_ai_provider_api_key,
            clear_ai_provider_api_key,
            test_ai_provider,
            test_ai_provider_with_settings,
            run_terminal_ai_chat,
            list_agent_audits,
            start_agent_session,
            run_agent_session,
            list_agent_sessions,
            draft_agent_plan,
            continue_agent_session,
            start_agent_log_stream,
            stop_agent_log_stream,
            cancel_agent_session,
            execute_agent_action,
            save_agent_audit,
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
                let redacted = redacted_sessions_for_frontend(&sessions);
                serde_json::to_string(&redacted).unwrap_or_else(|_| "[]".to_string())
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
