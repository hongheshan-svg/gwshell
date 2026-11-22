use crate::ssh;
use crate::state::AppState;
use std::sync::Arc;
use tauri::State;

// All SFTP/SSH operations are network I/O. The russh backend is fully async, so
// each command simply awaits the manager method on the Tokio runtime — the work
// never blocks the WebView's IPC thread.

#[tauri::command]
pub async fn sftp_list(
    session_id: String,
    path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ssh::SftpEntry>, String> {
    state.ssh_manager.sftp_list_dir(&session_id, &path).await
}

#[tauri::command]
pub async fn sftp_realpath(
    session_id: String,
    path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    state.ssh_manager.sftp_realpath(&session_id, &path).await
}

#[tauri::command]
pub async fn sftp_mkdir(
    session_id: String,
    path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state.ssh_manager.sftp_mkdir(&session_id, &path).await
}

#[tauri::command]
pub async fn sftp_rmdir(
    session_id: String,
    path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state.ssh_manager.sftp_rmdir(&session_id, &path).await
}

#[tauri::command]
pub async fn sftp_delete_file(
    session_id: String,
    path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state.ssh_manager.sftp_delete_file(&session_id, &path).await
}

#[tauri::command]
pub async fn sftp_rename(
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
pub async fn sftp_download(
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
pub async fn sftp_upload(
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
pub async fn sftp_download_dir(
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
pub async fn sftp_upload_dir(
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

/// File extensions the OS would *execute* (or install/mount/run as a script)
/// rather than display when handed to the default handler. Opening a remote
/// file of one of these types requires an explicit confirmation first.
const EXECUTABLE_LIKE_EXTENSIONS: &[&str] = &[
    // Windows
    "exe",
    "com",
    "bat",
    "cmd",
    "ps1",
    "psm1",
    "psd1",
    "vbs",
    "vbe",
    "js",
    "jse",
    "wsf",
    "wsh",
    "hta",
    "msi",
    "msp",
    "mst",
    "scr",
    "pif",
    "lnk",
    "reg",
    "cpl",
    "msc",
    "jar",
    "application",
    "appref-ms",
    "gadget",
    "inf",
    "scf",
    "url",
    "chm",
    "appx",
    "msix",
    "library-ms",
    // macOS
    "app",
    "command",
    "tool",
    "pkg",
    "mpkg",
    "terminal",
    "workflow",
    "scpt",
    "applescript",
    "webloc",
    "fileloc",
    "inetloc",
    "dmg",
    // Linux / generic
    "desktop",
    "sh",
    "bash",
    "zsh",
    "run",
    "bin",
    "appimage",
    "deb",
    "rpm",
    "py",
    "pl",
    "rb",
];

/// The lower-cased extension of `file_name` when it is executable-like.
fn executable_like_extension(file_name: &str) -> Option<String> {
    let (_, ext) = file_name.rsplit_once('.')?;
    let ext = ext.trim().to_ascii_lowercase();
    EXECUTABLE_LIKE_EXTENSIONS
        .contains(&ext.as_str())
        .then_some(ext)
}

/// Per-user, non-shared directory for files opened from the SFTP panel. Lives
/// under the user cache dir (not the shared `/tmp`), is `0700` on Unix, and is
/// wiped at startup (`cleanup_sftp_open_cache`).
fn sftp_open_cache_dir() -> Result<std::path::PathBuf, String> {
    let dir = dirs::cache_dir()
        .or_else(dirs::data_local_dir)
        .ok_or("Cannot determine cache directory")?
        .join("gwshell")
        .join("sftp-open");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Create cache dir failed: {}", e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("Secure cache dir failed: {}", e))?;
    }
    Ok(dir)
}

/// Best-effort removal of files opened in previous runs, including the legacy
/// shared `{temp}/gwshell_sftp` location used before v0.6.1. `remove_dir_all`
/// does not follow symlinks, so a planted link is unlinked, never traversed.
pub fn cleanup_sftp_open_cache() {
    if let Some(cache) = dirs::cache_dir().or_else(dirs::data_local_dir) {
        let _ = std::fs::remove_dir_all(cache.join("gwshell").join("sftp-open"));
    }
    let _ = std::fs::remove_dir_all(std::env::temp_dir().join("gwshell_sftp"));
}

/// Download a remote file to the private cache dir and open it with the OS
/// default handler. Executable-like files are refused with
/// `OPEN_EXECUTABLE_CONFIRM:<ext>` unless `allow_executable` is set (the UI
/// asks the user first). Opening happens here rather than in the WebView so the
/// frontend needs no blanket `opener:allow-open-path` permission.
#[tauri::command]
pub async fn sftp_open_file(
    session_id: String,
    remote_path: String,
    allow_executable: Option<bool>,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    use std::hash::{Hash, Hasher};
    use tauri_plugin_opener::OpenerExt;
    // Remote paths are POSIX; derive the basename by splitting on '/' rather
    // than std::path::Path, which would apply Windows separator rules on a
    // Windows host (a backslash is a legal char in a Linux filename).
    let file_name = remote_path
        .rsplit('/')
        .find(|s| !s.is_empty())
        .unwrap_or("file");
    if !ssh::is_safe_local_file_name(file_name) {
        return Err(format!(
            "Remote file name {:?} cannot be used as a local file name",
            file_name
        ));
    }
    if let Some(ext) = executable_like_extension(file_name) {
        if !allow_executable.unwrap_or(false) {
            return Err(format!("OPEN_EXECUTABLE_CONFIRM:{}", ext));
        }
    }
    // Namespace by a hash of session + full remote path so two different
    // remote files that share a basename don't clobber the same local file.
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    session_id.hash(&mut hasher);
    remote_path.hash(&mut hasher);
    let dir = sftp_open_cache_dir()?.join(format!("{:016x}", hasher.finish()));
    std::fs::create_dir_all(&dir).map_err(|e| format!("Create cache dir failed: {}", e))?;
    let local_path = dir.join(file_name);
    let local_str = local_path.to_string_lossy().to_string();
    state
        .ssh_manager
        .sftp_download(&session_id, &remote_path, &local_str, None)
        .await?;
    app_handle
        .opener()
        .open_path(local_str.clone(), None::<&str>)
        .map_err(|e| format!("Open file failed: {}", e))?;
    Ok(local_str)
}

#[tauri::command]
pub async fn sftp_read_text(
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
pub async fn sftp_write_text(
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
pub async fn sftp_chmod(
    session_id: String,
    path: String,
    mode: u32,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state.ssh_manager.sftp_chmod(&session_id, &path, mode).await
}

#[tauri::command]
pub async fn sftp_create_file(
    session_id: String,
    path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state.ssh_manager.sftp_create_file(&session_id, &path).await
}
