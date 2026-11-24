use crate::state::AppState;
use std::sync::Arc;
use tauri::State;

// NOTE: must be `async` so Tauri runs it on the async (Tokio) runtime. As a sync
// command it executes on the main thread with no reactor entered, and the
// `tokio::spawn` inside `MetricsManager::start` panics ("there is no reactor
// running"), aborting the whole app the moment the Server panel opens on an SSH tab.
#[tauri::command]
pub async fn start_server_metrics(
    session_id: String,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    state
        .metrics
        .start_with_state(session_id, state.inner().clone(), app_handle);
    Ok(())
}

#[tauri::command]
pub fn stop_server_metrics(session_id: String, state: State<'_, Arc<AppState>>) {
    state.metrics.stop(&session_id);
}

/// Remote command that ends `pid`.
///
/// Unix: SIGTERM first so the process can shut down cleanly, then SIGKILL if it
/// is still alive after ~3s (a bare `kill` leaves processes that ignore or trap
/// TERM running). Wrapped in `sh -c` because the exec goes through the user's
/// login shell, which may be fish/csh. A failed TERM (EPERM for another user's
/// process, ESRCH) exits non-zero with `kill`'s own message on stderr.
/// `sleep 0.3` falls back to `sleep 1` (counted as 3 ticks) where fractional
/// sleep is unsupported, keeping the grace period near 3s either way.
fn kill_process_command(platform: Option<crate::metrics::RemotePlatform>, pid: u32) -> String {
    match platform {
        Some(crate::metrics::RemotePlatform::Windows) => format!("taskkill /PID {pid} /F"),
        _ => format!(
            "sh -c 'kill -TERM {pid} || exit 1; n=0; \
             while kill -0 {pid} 2>/dev/null; do \
             n=$((n+1)); \
             if [ $n -gt 10 ]; then kill -KILL {pid} 2>/dev/null; exit 0; fi; \
             sleep 0.3 2>/dev/null || {{ sleep 1; n=$((n+2)); }}; \
             done'"
        ),
    }
}

/// Map the remote exit status to a result. A missing exit status (some servers
/// never send one) counts as success; a non-zero one carries the remote error.
fn kill_exec_result(out: crate::ssh::exec::ExecOutput) -> Result<(), String> {
    match out.exit_code {
        None | Some(0) => Ok(()),
        Some(code) => {
            let msg = if !out.stderr.is_empty() {
                out.stderr
            } else if !out.stdout.is_empty() {
                out.stdout
            } else {
                format!("exit code {code}")
            };
            Err(msg)
        }
    }
}

#[tauri::command]
pub async fn kill_remote_process(
    session_id: String,
    pid: u32,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    // PID 0 means "my own process group" to Unix `kill` and is the Idle
    // pseudo-process on Windows; never a real target from the process list.
    if pid == 0 {
        return Err("Invalid PID 0".into());
    }
    let cmd = kill_process_command(state.metrics.platform_for(&session_id), pid);
    let out = state
        .ssh_manager
        .ssh_exec_with_status(&session_id, &cmd)
        .await?;
    kill_exec_result(out)
}

#[tauri::command]
pub async fn detect_remote_os(
    session_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    state.ssh_manager.detect_command_table(&session_id).await
}

#[tauri::command]
pub async fn probe_remote_env(
    session_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<crate::ssh::probe::RemoteEnvProbe, String> {
    state.ssh_manager.probe_remote_env(&session_id).await
}

// ---- Ping Command ----

#[tauri::command]
pub async fn ping_host(host: String, port: u16, timeout_secs: Option<u64>) -> Result<f64, String> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::metrics::RemotePlatform;
    use crate::ssh::exec::ExecOutput;

    fn out(exit_code: Option<u32>, stdout: &str, stderr: &str) -> ExecOutput {
        ExecOutput {
            stdout: stdout.into(),
            stderr: stderr.into(),
            exit_code,
        }
    }

    #[test]
    fn windows_uses_forced_taskkill() {
        assert_eq!(
            kill_process_command(Some(RemotePlatform::Windows), 4321),
            "taskkill /PID 4321 /F"
        );
    }

    #[test]
    fn unix_and_unknown_platforms_use_sh_wrapper() {
        for p in [
            None,
            Some(RemotePlatform::Linux),
            Some(RemotePlatform::MacOs),
            Some(RemotePlatform::Bsd),
        ] {
            let cmd = kill_process_command(p, 77);
            assert!(cmd.starts_with("sh -c '"), "{cmd}");
            assert!(cmd.contains("kill -TERM 77"), "{cmd}");
            assert!(cmd.contains("kill -KILL 77"), "{cmd}");
        }
    }

    #[test]
    fn exec_result_maps_exit_status() {
        assert!(kill_exec_result(out(Some(0), "", "")).is_ok());
        assert!(kill_exec_result(out(None, "", "")).is_ok());
        assert_eq!(
            kill_exec_result(out(Some(1), "", "kill: (1) - Operation not permitted")),
            Err("kill: (1) - Operation not permitted".to_string())
        );
        assert_eq!(
            kill_exec_result(out(Some(1), "ERROR: not found", "")),
            Err("ERROR: not found".to_string())
        );
        assert_eq!(
            kill_exec_result(out(Some(5), "", "")),
            Err("exit code 5".to_string())
        );
    }

    /// Run the generated Unix command locally against `child`, reaping the
    /// child concurrently (an unreaped zombie still answers `kill -0`), and
    /// return the command's exit status and the signal that ended the child.
    #[cfg(unix)]
    fn run_kill_against(mut child: std::process::Child) -> (std::process::ExitStatus, Option<i32>) {
        use std::os::unix::process::ExitStatusExt;
        let pid = child.id();
        let reaper = std::thread::spawn(move || child.wait().unwrap().signal());
        let cmd = kill_process_command(Some(RemotePlatform::Linux), pid);
        let status = std::process::Command::new("sh")
            .arg("-c")
            .arg(&cmd)
            .status()
            .unwrap();
        // The command only returns once the process is gone, so the reaper
        // should finish almost immediately; fail instead of hanging if not.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while !reaper.is_finished() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        if !reaper.is_finished() {
            let _ = std::process::Command::new("kill")
                .args(["-KILL", &pid.to_string()])
                .status();
            panic!("process {pid} survived the kill command");
        }
        (status, reaper.join().unwrap())
    }

    #[cfg(unix)]
    #[test]
    fn unix_command_terminates_with_sigterm() {
        let child = std::process::Command::new("sleep")
            .arg("30")
            .spawn()
            .unwrap();
        let (status, signal) = run_kill_against(child);
        assert!(status.success());
        assert_eq!(signal, Some(15));
    }

    #[cfg(unix)]
    #[test]
    fn unix_command_escalates_to_sigkill_when_term_is_ignored() {
        let child = std::process::Command::new("sh")
            .arg("-c")
            .arg("trap '' TERM; while :; do sleep 1; done")
            .spawn()
            .unwrap();
        // Let the trap install before signalling.
        std::thread::sleep(std::time::Duration::from_millis(200));
        let (status, signal) = run_kill_against(child);
        assert!(status.success());
        assert_eq!(signal, Some(9));
    }

    #[cfg(unix)]
    #[test]
    fn unix_command_fails_for_missing_pid() {
        let cmd = kill_process_command(Some(RemotePlatform::Linux), 99_999_999);
        let output = std::process::Command::new("sh")
            .arg("-c")
            .arg(&cmd)
            .output()
            .unwrap();
        assert!(!output.status.success());
        assert!(!output.stderr.is_empty());
    }
}
