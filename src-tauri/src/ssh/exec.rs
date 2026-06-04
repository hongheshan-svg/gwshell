use crate::ssh::handler::Client;
use russh::client::Handle;
use russh::ChannelMsg;

/// Run a command on a fresh channel of an existing connection; return stdout.
pub async fn exec(conn: &Handle<Client>, command: &str) -> Result<String, String> {
    let mut channel = conn
        .channel_open_session()
        .await
        .map_err(|e| format!("Exec channel failed: {}", e))?;
    // russh 0.61 `Channel::exec<A: Into<Vec<u8>>>(&self, want_reply, command)`:
    // `&str` does not implement `Into<Vec<u8>>`, but `&[u8]` does, so pass bytes.
    channel
        .exec(true, command.as_bytes())
        .await
        .map_err(|e| format!("Exec failed: {}", e))?;
    let mut out = Vec::new();
    while let Some(msg) = channel.wait().await {
        match msg {
            ChannelMsg::Data { data } => out.extend_from_slice(&data),
            ChannelMsg::ExtendedData { .. } => {}
            ChannelMsg::Eof | ChannelMsg::Close => break,
            _ => {}
        }
    }
    Ok(String::from_utf8_lossy(&out).trim().to_string())
}
