use crate::crypto;
use crate::session::{self, SessionConfig};
use crate::ssh_config;
use crate::state::{redacted_sessions_for_frontend, AppState};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn save_app_settings(
    value: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || state.db.save_app_settings(&value))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
pub async fn load_app_settings(state: State<'_, Arc<AppState>>) -> Result<Option<String>, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || state.db.load_app_settings())
        .await
        .map_err(|e| format!("task join: {}", e))?
}

/// Append a chunk of terminal output to this session's daily log file under
/// `{data_local_dir}/gwshell/logs/{name}-{YYYY-MM-DD}.log`. The session name is
/// sanitized so it can't escape the logs directory or hit reserved characters.
#[tauri::command]
pub async fn append_session_log(session_name: String, data: String) -> Result<(), String> {
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
pub async fn get_command_history(
    limit: u32,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<crate::history::HistoryEntry>, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || Ok(state.db.load_command_history(limit)))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
pub async fn save_command_history(
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
pub async fn save_snippet(
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
pub async fn get_snippets(state: State<'_, Arc<AppState>>) -> Result<Vec<String>, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || state.db.get_snippets())
        .await
        .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
pub async fn delete_snippet(id: String, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || state.db.delete_snippet(&id))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

// ---- Storage Operations ----

#[tauri::command]
pub async fn export_sessions_data(
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
pub async fn import_sessions_data(
    path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<usize, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || -> Result<usize, String> {
        let json = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let mut sessions = state.sessions.lock();
        // Exports never contain secrets, so re-importing a backup over existing
        // sessions must keep their stored credentials (see merge_secrets_from).
        let count = state.db.import_sessions_json(&json, &sessions)?;
        // Reload sessions into memory
        *sessions = state.db.get_sessions()?;
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
pub async fn import_ssh_config(
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
pub async fn clear_local_data(state: State<'_, Arc<AppState>>) -> Result<(), String> {
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
pub async fn save_session(
    mut config: SessionConfig,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        // Hold the cache lock across merge + persist so a concurrent save of
        // the same session can't interleave and resurrect/lose a secret.
        let mut sessions = state.sessions.lock();
        // The WebView only has redacted copies: unset secrets mean "unchanged".
        config.merge_secrets_from(sessions.iter().find(|s| s.id == config.id));
        state.db.save_session(&config)?;
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
pub fn get_sessions(state: State<'_, Arc<AppState>>) -> Vec<SessionConfig> {
    // Pure in-memory clone — keep sync to avoid spawn_blocking overhead.
    // Secrets stay in the Rust process; the WebView receives only metadata.
    let sessions = state.sessions.lock();
    redacted_sessions_for_frontend(&sessions)
}

#[tauri::command]
pub async fn delete_session(
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

/// Whether credentials can be encrypted at rest on this machine. When false, the
/// frontend warns the user that saved passwords/TOTP secrets are stored
/// unencrypted (no OS keyring backend is available).
#[tauri::command]
pub fn secret_storage_available() -> bool {
    crypto::secret_storage_available()
}
