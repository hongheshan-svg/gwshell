use serde::Serialize;
use std::sync::Arc;
use tauri::State;

use crate::ssh::params::connect_params_from_session;
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
            Some(DockerContainer {
                id,
                name,
                image,
                status,
            })
        })
        .collect()
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

// ── split_exec_rc ──────────────────────────────────────────────────────────

/// Split the trailing `__rc=<n>` marker (emitted by `…; echo "__rc=$?"`) off
/// the command output. Returns `(body_without_marker, exit_code)`. If no
/// marker is found, returns `(input, 0)` — treat as success (defensive).
fn split_exec_rc(out: &str) -> (String, i32) {
    let trimmed = out.trim_end();
    if let Some(pos) = trimmed.rfind("__rc=") {
        // The marker must be on the last line.
        let after = &trimmed[pos + 5..];
        if let Ok(code) = after.trim().parse::<i32>() {
            let body = trimmed[..pos].trim_end_matches(['\n', '\r']).to_string();
            return (body, code);
        }
    }
    (out.to_string(), 0)
}

// ── docker_list_containers ─────────────────────────────────────────────────

fn valid_docker_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 256
        && host.bytes().all(|b| {
            b.is_ascii_alphanumeric() || matches!(b, b':' | b'/' | b'.' | b'-' | b'_' | b'[' | b']')
        })
}

#[tauri::command]
pub async fn docker_list_containers(
    connect_method: String, // "Local" | "SSH"
    tunnel_session_id: Option<String>,
    docker_host: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<DockerContainer>, String> {
    let docker_host = docker_host
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    if let Some(ref host) = docker_host {
        if !valid_docker_host(host) {
            return Err("Invalid docker host endpoint".to_string());
        }
    }

    if connect_method.eq_ignore_ascii_case("ssh") {
        let tunnel_id = tunnel_session_id
            .ok_or_else(|| "No SSH session selected for this Docker host".to_string())?;

        let sess = {
            let guard = state.sessions.lock();
            guard.iter().find(|s| s.id == tunnel_id).cloned()
        };
        let sess = sess.ok_or_else(|| "Referenced SSH session not found".to_string())?;

        let params = connect_params_from_session(&sess);

        let (conn, _fwd) = crate::ssh::connect::establish(&params)
            .await
            .map_err(|e| format!("SSH connect failed: {}", e))?;
        let conn = Arc::new(conn);
        let host_flag = docker_host
            .as_deref()
            .map(|h| format!(" -H {}", h))
            .unwrap_or_default();
        let remote_cmd = format!(
            "docker{} ps --no-trunc --format '{}' 2>&1; echo \"__rc=$?\"",
            host_flag, PS_FMT
        );
        let raw = crate::ssh::exec::exec(&conn, &remote_cmd)
            .await
            .map_err(|e| format!("docker ps failed: {}", e))?;
        let _ = conn
            .disconnect(russh::Disconnect::ByApplication, "", "English")
            .await;
        let (body, rc) = split_exec_rc(&raw);
        if rc != 0 {
            return Err(if body.trim().is_empty() {
                format!("docker ps failed on remote host (exit {})", rc)
            } else {
                body.trim().to_string()
            });
        }
        Ok(parse_docker_ps(&body))
    } else {
        // Local: run the docker CLI as a child process.
        let host_arg = docker_host.clone();
        let output = tokio::task::spawn_blocking(move || {
            let mut cmd = std::process::Command::new("docker");
            if let Some(ref h) = host_arg {
                cmd.args(["-H", h]);
            }
            cmd.args(["ps", "--no-trunc", "--format", PS_FMT]);
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x0800_0000;
                cmd.creation_flags(CREATE_NO_WINDOW);
            }
            cmd.output()
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
    session_id: String, // the DOCKER tab's session id (event/resize/close key)
    container_id: String,
    rows: u32,
    cols: u32,
    connect_method: String, // "Local" | "SSH"
    tunnel_session_id: Option<String>,
    docker_host: Option<String>,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    if !valid_container_id(&container_id) {
        return Err("Invalid container id".to_string());
    }
    let docker_host = docker_host
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    if let Some(ref host) = docker_host {
        if !valid_docker_host(host) {
            return Err("Invalid docker host endpoint".to_string());
        }
    }

    if connect_method.eq_ignore_ascii_case("ssh") {
        let tunnel_id = tunnel_session_id.ok_or_else(|| "No SSH session selected".to_string())?;

        let sess = {
            let guard = state.sessions.lock();
            guard.iter().find(|s| s.id == tunnel_id).cloned()
        }
        .ok_or_else(|| "Referenced SSH session not found".to_string())?;

        let params = connect_params_from_session(&sess);
        let host_flag = docker_host
            .as_deref()
            .map(|h| format!(" -H {}", h))
            .unwrap_or_default();
        let cmd = format!(
            "docker{} exec -it -- {} sh -c '{}'",
            host_flag, container_id, EXEC_SHELL
        );

        state
            .ssh_manager
            .connect_and_exec_interactive(&session_id, params, cmd, rows, cols, app_handle)
            .await
    } else {
        let sid = session_id.clone();
        let cid = container_id.clone();
        let st = state.inner().clone();
        let (r, c) = (rows as u16, cols as u16);
        tokio::task::spawn_blocking(move || {
            st.pty_manager
                .create_docker_exec(&sid, app_handle, r, c, &cid, docker_host.as_deref())
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

    #[test]
    fn split_exec_rc_success_row() {
        let (body, rc) = split_exec_rc("a\tb\tc\td\n__rc=0\n");
        assert_eq!(body, "a\tb\tc\td");
        assert_eq!(rc, 0);
    }

    #[test]
    fn split_exec_rc_nonzero_exit() {
        let (body, rc) = split_exec_rc("docker: command not found\n__rc=127\n");
        assert_eq!(body, "docker: command not found");
        assert_eq!(rc, 127);
    }

    #[test]
    fn split_exec_rc_no_marker() {
        let (body, rc) = split_exec_rc("no marker here");
        assert_eq!(body, "no marker here");
        assert_eq!(rc, 0);
    }
}
