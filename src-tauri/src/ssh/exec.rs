use crate::ssh::handler::Client;
use russh::client::Handle;
use russh::ChannelMsg;
use std::time::Duration;

/// Hard cap on a single exec so a command that never closes its channel (or a
/// half-dead connection that never delivers Eof/Close) can't hang an awaiting
/// IPC call indefinitely. Metrics callers wrap their own shorter timeout; this
/// is the backstop for `ssh_exec`/`kill_remote_process`, which don't.
const EXEC_TIMEOUT: Duration = Duration::from_secs(30);

/// Structured output from a remote exec channel (stdout, stderr, exit code).
#[derive(Debug, Clone)]
pub struct ExecOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<u32>,
}

/// Run a command on a fresh channel of an existing connection, returning
/// stdout, stderr, and the remote exit status.
pub async fn exec_with_status(conn: &Handle<Client>, command: &str) -> Result<ExecOutput, String> {
    let channel = conn
        .channel_open_session()
        .await
        .map_err(|e| format!("Exec channel failed: {}", e))?;
    channel
        .exec(true, command.as_bytes())
        .await
        .map_err(|e| format!("Exec failed: {}", e))?;
    let collect = async move {
        let mut channel = channel;
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut exit_code: Option<u32> = None;
        while let Some(msg) = channel.wait().await {
            match msg {
                ChannelMsg::Data { data } => stdout.extend_from_slice(&data),
                ChannelMsg::ExtendedData { data, ext: 1 } => stderr.extend_from_slice(&data),
                ChannelMsg::ExitStatus { exit_status } => exit_code = Some(exit_status),
                ChannelMsg::Close => break,
                _ => {}
            }
        }
        ExecOutput {
            stdout: String::from_utf8_lossy(&stdout).trim().to_string(),
            stderr: String::from_utf8_lossy(&stderr).trim().to_string(),
            exit_code,
        }
    };
    tokio::time::timeout(EXEC_TIMEOUT, collect)
        .await
        .map_err(|_| "Exec timed out".to_string())
}

/// Run a command on a fresh channel of an existing connection; return stdout.
pub async fn exec(conn: &Handle<Client>, command: &str) -> Result<String, String> {
    let res = exec_with_status(conn, command).await?;
    Ok(res.stdout)
}

pub async fn exec_stream<F>(
    conn: &Handle<Client>,
    command: &str,
    mut on_chunk: F,
    stop: std::sync::Arc<tokio::sync::Notify>,
) -> Result<(), String>
where
    F: FnMut(Vec<u8>) + Send + 'static,
{
    let channel = conn
        .channel_open_session()
        .await
        .map_err(|e| format!("Stream channel failed: {}", e))?;
    channel
        .exec(true, command.as_bytes())
        .await
        .map_err(|e| format!("Stream exec failed: {}", e))?;
    let mut channel = channel;
    loop {
        tokio::select! {
            _ = stop.notified() => {
                // Stopping a stream should terminate this channel and its remote tail process.
                let _ = channel.close().await;
                break;
            }
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { data }) | Some(ChannelMsg::ExtendedData { data, .. }) => {
                        on_chunk(data.to_vec());
                    }
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                    _ => {}
                }
            }
        }
    }
    Ok(())
}
