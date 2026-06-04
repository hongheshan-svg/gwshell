use crate::ssh::connect;
use crate::ssh::handler::Client;
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
) -> Result<(mpsc::Sender<ShellCmd>, Arc<Handle<Client>>), String> {
    // russh 0.61's `Handle` is not `Clone`, so the connection is shared as an
    // `Arc`: the shell task keeps one clone (for the final disconnect) and the
    // manager keeps another to open exec/sftp/forward channels on the same
    // connection. All of those methods take `&self`, so `Arc` is sufficient.
    let session = Arc::new(connect::establish(&params).await?);
    let channel = session
        .channel_open_session()
        .await
        .map_err(|e| format!("Channel open failed: {}", e))?;
    channel
        .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
        .await
        .map_err(|e| format!("PTY request failed: {}", e))?;
    channel
        .request_shell(true)
        .await
        .map_err(|e| format!("Shell request failed: {}", e))?;

    let (tx, mut rx) = mpsc::channel::<ShellCmd>(256);
    let data_ev = format!("ssh-data-{}", session_id);
    let exit_ev = format!("ssh-exit-{}", session_id);

    let task_session = session.clone();
    tokio::spawn(async move {
        let session = task_session;
        let mut channel = channel;
        let mut decoder = encoding_rs::UTF_8.new_decoder();
        loop {
            tokio::select! {
                cmd = rx.recv() => match cmd {
                    Some(ShellCmd::Data(bytes)) => {
                        if channel.data(&bytes[..]).await.is_err() { break; }
                    }
                    Some(ShellCmd::Resize { cols, rows }) => {
                        let _ = channel.window_change(cols, rows, 0, 0).await;
                    }
                    Some(ShellCmd::Close) | None => break,
                },
                msg = channel.wait() => match msg {
                    Some(ChannelMsg::Data { data }) => emit_decoded(&mut decoder, &data, &app, &data_ev, false),
                    Some(ChannelMsg::ExtendedData { data, .. }) => emit_decoded(&mut decoder, &data, &app, &data_ev, false),
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                    _ => {}
                },
            }
        }
        // Flush any trailing decoder state and surface the disconnect.
        emit_decoded(&mut decoder, &[], &app, &data_ev, true);
        let _ = app.emit(&exit_ev, ());
        let _ = session
            .disconnect(russh::Disconnect::ByApplication, "", "English")
            .await;
    });

    Ok((tx, session))
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
