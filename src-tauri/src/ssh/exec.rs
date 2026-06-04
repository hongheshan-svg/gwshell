use crate::ssh::handler::Client;
use russh::client::Handle;
use russh::ChannelMsg;
use std::time::Duration;

/// Hard cap on a single exec so a command that never closes its channel (or a
/// half-dead connection that never delivers Eof/Close) can't hang an awaiting
/// IPC call indefinitely. Metrics callers wrap their own shorter timeout; this
/// is the backstop for `ssh_exec`/`kill_remote_process`, which don't.
const EXEC_TIMEOUT: Duration = Duration::from_secs(30);

/// Run a command on a fresh channel of an existing connection; return stdout.
pub async fn exec(conn: &Handle<Client>, command: &str) -> Result<String, String> {
    let channel = conn
        .channel_open_session()
        .await
        .map_err(|e| format!("Exec channel failed: {}", e))?;
    // russh 0.61 `Channel::exec<A: Into<Vec<u8>>>(&self, want_reply, command)`:
    // `&str` does not implement `Into<Vec<u8>>`, but `&[u8]` does, so pass bytes.
    channel
        .exec(true, command.as_bytes())
        .await
        .map_err(|e| format!("Exec failed: {}", e))?;
    let collect = async move {
        let mut channel = channel;
        let mut out = Vec::new();
        while let Some(msg) = channel.wait().await {
            match msg {
                ChannelMsg::Data { data } => out.extend_from_slice(&data),
                ChannelMsg::ExtendedData { .. } => {}
                ChannelMsg::Eof | ChannelMsg::Close => break,
                _ => {}
            }
        }
        out
    };
    let out = tokio::time::timeout(EXEC_TIMEOUT, collect)
        .await
        .map_err(|_| "Exec timed out".to_string())?;
    Ok(String::from_utf8_lossy(&out).trim().to_string())
}
