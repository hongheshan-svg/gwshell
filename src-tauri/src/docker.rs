use serde::Serialize;
use std::sync::Arc;
use tauri::State;

use crate::session::{AuthMethod, SessionConfig};
use crate::ssh::params::ConnectParams;
use crate::AppState;

// ── docker ps format string ────────────────────────────────────────────────
const PS_FMT: &str = "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}";

// ── shell to run inside the container ─────────────────────────────────────
const EXEC_SHELL: &str = "exec bash 2>/dev/null || exec sh";

// ── DockerContainer ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DockerContainer {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: String,
}

// ── parse_docker_ps ────────────────────────────────────────────────────────

/// Parse the tab-delimited output of
/// `docker ps --no-trunc --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}'`.
/// Tolerates blank lines and trailing whitespace; rows with fewer than 4 fields
/// are skipped. Extra tabs in a field are not expected from this format.
pub fn parse_docker_ps(out: &str) -> Vec<DockerContainer> {
    out.lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|line| {
            let mut parts = line.splitn(4, '\t');
            let id = parts.next()?.trim().to_string();
            let name = parts.next()?.trim().to_string();
            let image = parts.next()?.trim().to_string();
            let status = parts.next().unwrap_or("").trim().to_string();
            if id.is_empty() {
                return None;
            }
            Some(DockerContainer { id, name, image, status })
        })
        .collect()
}

// ── connect_params_from_session ────────────────────────────────────────────

/// Build SSH `ConnectParams` from a saved SSH `SessionConfig` (the docker
/// tunnel target), mirroring how `ssh_connect` in lib.rs constructs
/// `ConnectParams` from its individual IPC arguments.
///
/// Field-by-field mapping from `SessionConfig` → `ConnectParams`:
///
/// | ConnectParams field           | Source / default                           |
/// |-------------------------------|--------------------------------------------|
/// | host                          | `s.host.unwrap_or_default()`               |
/// | port                          | `s.port.unwrap_or(22)`                     |
/// | username                      | `s.username.unwrap_or_default()`           |
/// | password                      | `s.password`                               |
/// | private_key_path              | `s.private_key_path`                       |
/// | auth_method                   | derived from `s.auth_method` enum → str    |
/// | totp_code                     | `s.totp_code`                              |
/// | jump_host                     | `s.jump_host`                              |
/// | jump_port                     | `s.jump_port.unwrap_or(22)`                |
/// | jump_username                 | `s.jump_username`                          |
/// | jump_password                 | `s.jump_password`                          |
/// | jump_private_key_path         | `s.jump_private_key_path`                  |
/// | proxy_type                    | `s.proxy_type`                             |
/// | proxy_host                    | `s.proxy_host`                             |
/// | proxy_port                    | `s.proxy_port.unwrap_or(1080)`             |
/// | proxy_username                | `s.proxy_username`                         |
/// | proxy_password                | `s.proxy_password`                         |
/// | connection_timeout            | `s.connection_timeout.unwrap_or(30)`       |
/// | idle_disconnect_minutes       | `s.idle_disconnect_minutes.unwrap_or(0)`   |
/// | agent_forward                 | `s.agent_forward.unwrap_or(false)`         |
/// | keepalive_interval            | `s.keepalive_interval.map(|v| v as u64)`   |
/// | server_alive_count_max        | `s.server_alive_count_max`                 |
pub fn connect_params_from_session(s: &SessionConfig) -> ConnectParams {
    // Convert the AuthMethod enum to the lowercase string that `auth.rs` matches
    // on. This mirrors the behaviour of ssh_connect in lib.rs, which receives a
    // raw String from the frontend and stores it directly; here we convert from
    // the persisted enum variant using the same name mapping.
    let auth_method = match s.auth_method {
        AuthMethod::Password => "password".to_string(),
        AuthMethod::PublicKey => "publickey".to_string(),
        AuthMethod::KeyboardInteractive => "keyboardinteractive".to_string(),
        AuthMethod::Agent => "agent".to_string(),
        AuthMethod::None => "none".to_string(),
    };

    ConnectParams {
        host: s.host.clone().unwrap_or_default(),
        port: s.port.unwrap_or(22),
        username: s.username.clone().unwrap_or_default(),
        password: s.password.clone(),
        private_key_path: s.private_key_path.clone(),
        auth_method,
        totp_code: s.totp_code.clone(),
        jump_host: s.jump_host.clone(),
        jump_port: s.jump_port.unwrap_or(22),
        jump_username: s.jump_username.clone(),
        jump_password: s.jump_password.clone(),
        jump_private_key_path: s.jump_private_key_path.clone(),
        proxy_type: s.proxy_type.clone(),
        proxy_host: s.proxy_host.clone(),
        proxy_port: s.proxy_port.unwrap_or(1080),
        proxy_username: s.proxy_username.clone(),
        proxy_password: s.proxy_password.clone(),
        connection_timeout: s.connection_timeout.unwrap_or(30),
        idle_disconnect_minutes: s.idle_disconnect_minutes.unwrap_or(0),
        agent_forward: s.agent_forward.unwrap_or(false),
        // SessionConfig.keepalive_interval is Option<u32>; ConnectParams wants
        // Option<u64> — widen the integer.
        keepalive_interval: s.keepalive_interval.map(|v| v as u64),
        server_alive_count_max: s.server_alive_count_max,
    }
}

// ── valid_container_id ─────────────────────────────────────────────────────

/// Reject container IDs that could inject flags or shell metacharacters into
/// the SSH `docker exec` command string. Docker container IDs from `docker ps
/// --no-trunc` are 64-char hex strings; names are also alphanumeric+`._-`.
/// We allow up to 128 chars to be future-safe.
fn valid_container_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-'))
}

// ── docker_list_containers ─────────────────────────────────────────────────

#[tauri::command]
pub async fn docker_list_containers(
    connect_method: String,            // "Local" | "SSH"
    tunnel_session_id: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<DockerContainer>, String> {
    if connect_method.eq_ignore_ascii_case("ssh") {
        let tunnel_id = tunnel_session_id
            .ok_or_else(|| "No SSH session selected for this Docker host".to_string())?;

        // Look up the SSH tunnel session from in-memory sessions.
        // `state.sessions` is a parking_lot::Mutex (synchronous `.lock()`).
        let sess = {
            let guard = state.sessions.lock();
            guard.iter().find(|s| s.id == tunnel_id).cloned()
        };
        let sess = sess.ok_or_else(|| "Referenced SSH session not found".to_string())?;

        let params = connect_params_from_session(&sess);

        // Transient one-shot: establish a fresh connection, exec docker ps, drop.
        let (conn, _fwd) = crate::ssh::connect::establish(&params)
            .await
            .map_err(|e| format!("SSH connect failed: {}", e))?;
        let conn = Arc::new(conn);
        let cmd = format!("docker ps --no-trunc --format '{}'", PS_FMT);
        let out = crate::ssh::exec::exec(&conn, &cmd)
            .await
            .map_err(|e| format!("docker ps failed: {}", e))?;
        Ok(parse_docker_ps(&out))
    } else {
        // Local: run the docker CLI as a child process.
        let output = tokio::task::spawn_blocking(|| {
            std::process::Command::new("docker")
                .args(["ps", "--no-trunc", "--format", PS_FMT])
                .output()
        })
        .await
        .map_err(|e| format!("task join: {}", e))?
        .map_err(|e| {
            format!(
                "Failed to run docker: {} (is Docker installed and on PATH?)",
                e
            )
        })?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        Ok(parse_docker_ps(&String::from_utf8_lossy(&output.stdout)))
    }
}

// ── docker_exec ────────────────────────────────────────────────────────────

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn docker_exec(
    session_id: String,                // the DOCKER tab's session id (event/resize/close key)
    container_id: String,
    rows: u32,
    cols: u32,
    connect_method: String,            // "Local" | "SSH"
    tunnel_session_id: Option<String>,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // Validate container_id first — defence against injection on the SSH
    // string-interpolation path. Also protects the local PTY path.
    if !valid_container_id(&container_id) {
        return Err("Invalid container id".to_string());
    }

    if connect_method.eq_ignore_ascii_case("ssh") {
        let tunnel_id = tunnel_session_id
            .ok_or_else(|| "No SSH session selected".to_string())?;

        let sess = {
            let guard = state.sessions.lock();
            guard.iter().find(|s| s.id == tunnel_id).cloned()
        }
        .ok_or_else(|| "Referenced SSH session not found".to_string())?;

        let params = connect_params_from_session(&sess);

        // Build the command with `--` to prevent argv flag smuggling from the
        // container_id (already validated, but belt-and-suspenders).
        let cmd = format!(
            "docker exec -it -- {} sh -c '{}'",
            container_id, EXEC_SHELL
        );

        state
            .ssh_manager
            .connect_and_exec_interactive(&session_id, params, cmd, rows, cols, app_handle)
            .await
    } else {
        // Local: spawn docker exec in a PTY via PtyManager.
        let sid = session_id.clone();
        let cid = container_id.clone();
        let st = state.inner().clone();
        // rows/cols arrive as u32 from Tauri IPC; PtyManager uses u16.
        let (r, c) = (rows as u16, cols as u16);
        tokio::task::spawn_blocking(move || {
            st.pty_manager
                .create_docker_exec(&sid, app_handle, r, c, &cid)
        })
        .await
        .map_err(|e| format!("task join: {}", e))?
    }
}

// ── tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_rows_and_skips_blanks() {
        let out = "abc123\tweb\tnginx:latest\tUp 3 hours\n\n\
                   def456\tdb\tpostgres:16\tUp 2 days (healthy)\n";
        let got = parse_docker_ps(out);
        assert_eq!(got.len(), 2);
        assert_eq!(
            got[0],
            DockerContainer {
                id: "abc123".into(),
                name: "web".into(),
                image: "nginx:latest".into(),
                status: "Up 3 hours".into(),
            }
        );
        assert_eq!(got[1].name, "db");
        assert_eq!(got[1].status, "Up 2 days (healthy)");
    }

    #[test]
    fn skips_malformed_and_empty_id() {
        let out = "onlytwo\tfields\n\t\t\t\nok\tn\ti\ts\n";
        let got = parse_docker_ps(out);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].id, "ok");
    }

    #[test]
    fn valid_container_id_accepts_normal_ids() {
        assert!(valid_container_id(
            "abc1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
        ));
        assert!(valid_container_id("my-container_name.1"));
        assert!(valid_container_id("a"));
    }

    #[test]
    fn valid_container_id_rejects_bad_ids() {
        assert!(!valid_container_id("")); // empty
        assert!(!valid_container_id("a b")); // space
        assert!(!valid_container_id("a;b")); // semicolon
        assert!(!valid_container_id("a'b")); // single quote
        assert!(!valid_container_id("a`b")); // backtick
        assert!(!valid_container_id(&"a".repeat(129))); // too long
    }
}
