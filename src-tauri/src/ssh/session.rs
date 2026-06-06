use crate::ssh::connect;
use crate::ssh::handler::{Client, ForwardTargets};
use crate::ssh::params::ConnectParams;
use russh::client::Handle;
use russh::ChannelMsg;
use std::sync::Arc;
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
    let channel = session
        .channel_open_session()
        .await
        .map_err(|e| format!("Channel open failed: {}", e))?;
    channel
        .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
        .await
        .map_err(|e| format!("PTY request failed: {}", e))?;

    // Agent forwarding (`ssh -A`): ask the server to enable an agent channel on
    // this session. `Channel::agent_forward` (russh 0.61
    // `src/channels/mod.rs:316`) emits the `auth-agent-req@openssh.com` channel
    // request. We send it with want_reply=false (best-effort, matching OpenSSH):
    // a server that lacks `AllowAgentForwarding` simply ignores it, and the
    // shell still works. The actual forwarded-agent channel is later proxied to
    // the local agent by `Client::server_channel_open_agent_forward`.
    //
    // MUST be sent AFTER request_pty and BEFORE request_shell: OpenSSH sshd only
    // honors `auth-agent-req@openssh.com` before the shell/exec starts; sending
    // it after request_shell means the server has already set up the environment
    // without SSH_AUTH_SOCK, so the request is silently ignored.
    if params.agent_forward {
        if let Err(e) = channel.agent_forward(false).await {
            eprintln!("[gwshell] agent-forward request failed (continuing): {}", e);
        }
    }

    channel
        .request_shell(true)
        .await
        .map_err(|e| format!("Shell request failed: {}", e))?;

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
                Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | Some(ChannelMsg::Failure)
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
