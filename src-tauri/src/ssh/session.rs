use crate::ssh::connect;
use crate::ssh::handler::{Client, ForwardTargets};
use crate::ssh::params::ConnectParams;
use russh::client::Handle;
use russh::ChannelMsg;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

/// Control messages to a running shell task.
pub enum ShellCmd {
    Data(Vec<u8>),
    Resize { cols: u32, rows: u32 },
    Close,
}

/// Spawn a shell session: connect, open PTY+shell, and pump I/O until close/EOF.
/// Returns a sender for input/resize/close. Emits `ssh-data-{id}` / `ssh-exit-{id}`.
pub async fn spawn(
    session_id: String,
    params: ConnectParams,
    cols: u32,
    rows: u32,
    app: AppHandle,
) -> Result<(mpsc::Sender<ShellCmd>, Arc<Handle<Client>>, ForwardTargets), String> {
    // russh 0.61's `Handle` is not `Clone`, so the connection is shared as an
    // `Arc`: the shell task keeps one clone (for the final disconnect) and the
    // manager keeps another to open exec/sftp/forward channels on the same
    // connection. All of those methods take `&self`, so `Arc` is sufficient.
    let (handle, forwarded) = connect::establish(&params).await?;
    let session = Arc::new(handle);
    let setup_timeout = Duration::from_secs(params.connection_timeout.max(5) as u64);

    // Bound post-auth channel/PTY/shell negotiation so a stalled bastion or
    // PAM session cannot leave the terminal stuck on "Connecting..." forever.
    // Disconnect on any setup failure or timeout so the unregistered handle
    // does not leak.
    let setup = async {
        let channel = session
            .channel_open_session()
            .await
            .map_err(|e| format!("Channel open failed: {}", e))?;
        channel
            .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
            .await
            .map_err(|e| format!("PTY request failed: {}", e))?;

        // Agent forwarding (`ssh -A`): ask the server to enable an agent channel on
        // this session. MUST be sent AFTER request_pty and BEFORE request_shell.
        if params.agent_forward {
            if let Err(e) = channel.agent_forward(false).await {
                eprintln!("[gwshell] agent-forward request failed (continuing): {}", e);
            }
        }

        // Best-effort SSH `env` channel requests (matching OpenSSH `SendEnv`): must
        // be sent before `request_shell`. Servers that disallow AcceptEnv ignore them.
        if let Some(raw_env) = params.env_vars.as_deref() {
            for (k, v) in parse_env_vars(raw_env) {
                if let Err(e) = channel.set_env(false, k, v).await {
                    eprintln!("[gwshell] set_env failed (continuing): {}", e);
                }
            }
        }

        channel
            .request_shell(true)
            .await
            .map_err(|e| format!("Shell request failed: {}", e))?;
        Ok::<_, String>(channel)
    };

    let channel = match tokio::time::timeout(setup_timeout, setup).await {
        Ok(Ok(ch)) => ch,
        Ok(Err(e)) => {
            let _ = session
                .disconnect(russh::Disconnect::ByApplication, "", "English")
                .await;
            return Err(e);
        }
        Err(_) => {
            let _ = session
                .disconnect(russh::Disconnect::ByApplication, "", "English")
                .await;
            return Err(format!(
                "Shell setup timed out after {}s",
                setup_timeout.as_secs()
            ));
        }
    };

    let (tx, mut rx) = mpsc::channel::<ShellCmd>(256);
    let data_ev = format!("ssh-data-{}", session_id);
    let exit_ev = format!("ssh-exit-{}", session_id);

    // Split the channel so reads and writes run on independent tasks. This is
    // the crux of avoiding the freeze: a `channel.data().await` write can park
    // when the SSH send window is exhausted, waiting for the server's
    // CHANNEL_WINDOW_ADJUST. That adjust is only processed while inbound channel
    // messages are being drained (`read_half.wait()`). If a single task did both
    // in a `select!`, a parked write would stop draining inbound, russh's event
    // loop would block once its channel buffer filled, the window would never be
    // adjusted, and writer+reader would deadlock with no `ssh-exit` emitted —
    // exactly the silent freeze this rewrite exists to remove. Keeping the
    // (blockable) write on its own task lets the reader drain inbound forever.
    let (mut read_half, write_half) = channel.split();

    // Writer task: owns the write half and the input/control queue.
    let writer_session = session.clone();
    let writer = tokio::spawn(async move {
        while let Some(cmd) = rx.recv().await {
            match cmd {
                ShellCmd::Data(bytes) => {
                    if write_half.data(&bytes[..]).await.is_err() {
                        break;
                    }
                }
                ShellCmd::Resize { cols, rows } => {
                    let _ = write_half.window_change(cols, rows, 0, 0).await;
                }
                ShellCmd::Close => break,
            }
        }
        // On Close / queue-closed / write error, tear the connection down so the
        // reader unblocks and emits the single ssh-exit.
        let _ = writer_session
            .disconnect(russh::Disconnect::ByApplication, "", "English")
            .await;
    });

    // Reader task: sole owner of inbound messages and the exit signal.
    let reader_session = session.clone();
    tokio::spawn(async move {
        let mut decoder = encoding_rs::UTF_8.new_decoder();
        loop {
            match read_half.wait().await {
                Some(ChannelMsg::Data { data }) => {
                    emit_decoded(&mut decoder, &data, &app, &data_ev, false)
                }
                Some(ChannelMsg::ExtendedData { data, .. }) => {
                    emit_decoded(&mut decoder, &data, &app, &data_ev, false)
                }
                // Eof/Close end the session; Failure surfaces a rejected shell
                // request as session-ended rather than a silent dead terminal.
                Some(ChannelMsg::Eof)
                | Some(ChannelMsg::Close)
                | Some(ChannelMsg::Failure)
                | None => break,
                _ => {}
            }
        }
        // Flush any trailing decoder state and surface the disconnect exactly once.
        emit_decoded(&mut decoder, &[], &app, &data_ev, true);
        let _ = app.emit(&exit_ev, ());
        // Stop the input pump if it is still parked on the queue, then disconnect.
        writer.abort();
        let _ = reader_session
            .disconnect(russh::Disconnect::ByApplication, "", "English")
            .await;
    });

    Ok((tx, session, forwarded))
}

/// Spawn an interactive exec session: connect, open PTY+exec-command, and pump I/O
/// until close/EOF. Identical to `spawn` in every respect except the channel runs
/// `exec(command)` instead of `request_shell`. Emits `ssh-data-{id}` / `ssh-exit-{id}`.
pub async fn spawn_exec(
    session_id: String,
    params: ConnectParams,
    cols: u32,
    rows: u32,
    app: AppHandle,
    command: String,
) -> Result<(mpsc::Sender<ShellCmd>, Arc<Handle<Client>>, ForwardTargets), String> {
    let (handle, forwarded) = connect::establish(&params).await?;
    let session = Arc::new(handle);
    let setup_timeout = Duration::from_secs(params.connection_timeout.max(5) as u64);

    // Same timeout + leak guard as `spawn`.
    let setup = async {
        let channel = session
            .channel_open_session()
            .await
            .map_err(|e| format!("Channel open failed: {}", e))?;
        channel
            .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
            .await
            .map_err(|e| format!("PTY request failed: {}", e))?;

        if params.agent_forward {
            if let Err(e) = channel.agent_forward(false).await {
                eprintln!("[gwshell] agent-forward request failed (continuing): {}", e);
            }
        }

        channel
            .exec(true, command.as_bytes())
            .await
            .map_err(|e| format!("Exec request failed: {}", e))?;
        Ok::<_, String>(channel)
    };

    let channel = match tokio::time::timeout(setup_timeout, setup).await {
        Ok(Ok(ch)) => ch,
        Ok(Err(e)) => {
            let _ = session
                .disconnect(russh::Disconnect::ByApplication, "", "English")
                .await;
            return Err(e);
        }
        Err(_) => {
            let _ = session
                .disconnect(russh::Disconnect::ByApplication, "", "English")
                .await;
            return Err(format!(
                "Exec setup timed out after {}s",
                setup_timeout.as_secs()
            ));
        }
    };

    let (tx, mut rx) = mpsc::channel::<ShellCmd>(256);
    let data_ev = format!("ssh-data-{}", session_id);
    let exit_ev = format!("ssh-exit-{}", session_id);

    let (mut read_half, write_half) = channel.split();

    let writer_session = session.clone();
    let writer = tokio::spawn(async move {
        while let Some(cmd) = rx.recv().await {
            match cmd {
                ShellCmd::Data(bytes) => {
                    if write_half.data(&bytes[..]).await.is_err() {
                        break;
                    }
                }
                ShellCmd::Resize { cols, rows } => {
                    let _ = write_half.window_change(cols, rows, 0, 0).await;
                }
                ShellCmd::Close => break,
            }
        }
        let _ = writer_session
            .disconnect(russh::Disconnect::ByApplication, "", "English")
            .await;
    });

    let reader_session = session.clone();
    tokio::spawn(async move {
        let mut decoder = encoding_rs::UTF_8.new_decoder();
        loop {
            match read_half.wait().await {
                Some(ChannelMsg::Data { data }) => {
                    emit_decoded(&mut decoder, &data, &app, &data_ev, false)
                }
                Some(ChannelMsg::ExtendedData { data, .. }) => {
                    emit_decoded(&mut decoder, &data, &app, &data_ev, false)
                }
                Some(ChannelMsg::Eof)
                | Some(ChannelMsg::Close)
                | Some(ChannelMsg::Failure)
                | None => break,
                _ => {}
            }
        }
        emit_decoded(&mut decoder, &[], &app, &data_ev, true);
        let _ = app.emit(&exit_ev, ());
        writer.abort();
        let _ = reader_session
            .disconnect(russh::Disconnect::ByApplication, "", "English")
            .await;
    });

    Ok((tx, session, forwarded))
}

/// Decode bytes through a streaming UTF-8 decoder and emit a batched event.
fn emit_decoded(
    decoder: &mut encoding_rs::Decoder,
    bytes: &[u8],
    app: &AppHandle,
    ev: &str,
    last: bool,
) {
    if bytes.is_empty() && !last {
        return;
    }
    let mut out = String::with_capacity(bytes.len() + 16);
    let _ = decoder.decode_to_string(bytes, &mut out, last);
    if !out.is_empty() {
        let _ = app.emit(ev, out);
    }
}

/// Parse newline-separated `KEY=VALUE` lines into `(key, value)` pairs.
/// Ignores blank lines, `#` comments, and invalid variable names.
pub fn parse_env_vars(raw: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let Some((k, v)) = trimmed.split_once('=') else {
            continue;
        };
        let key = k.trim();
        if key.is_empty() || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            continue;
        }
        out.push((key.to_string(), v.trim().to_string()));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::parse_env_vars;

    #[test]
    fn parse_env_vars_filters_comments_blanks_and_invalid_keys() {
        let input = "\n# comment\nFOO=bar\n  LANG = en_US.UTF-8 \nBAD-KEY=1\nNO_EQUALS\nA_1=x=y\n";
        assert_eq!(
            parse_env_vars(input),
            vec![
                ("FOO".to_string(), "bar".to_string()),
                ("LANG".to_string(), "en_US.UTF-8".to_string()),
                ("A_1".to_string(), "x=y".to_string()),
            ]
        );
    }
}
