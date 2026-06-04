use crate::ssh::handler::Client;
use russh::client::Handle;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Notify;

/// Bind 127.0.0.1:local_port and forward each accepted connection to
/// remote_host:remote_port through `conn` via direct-tcpip. Returns the bound port.
///
/// `conn` is the session's shared connection (`Arc<Handle<Client>>`); russh
/// 0.61's `Handle` is not `Clone`, so the `Arc` is cloned per accepted socket
/// and the channel-opening method takes `&self`.
pub async fn start_local(
    conn: Arc<Handle<Client>>,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
    stop: Arc<Notify>,
) -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", local_port))
        .await
        .map_err(|e| format!("Tunnel bind failed: {}", e))?;
    let actual = listener.local_addr().map_err(|e| e.to_string())?.port();

    tokio::spawn(async move {
        loop {
            let accept = tokio::select! {
                _ = stop.notified() => break,
                a = listener.accept() => a,
            };
            let Ok((mut socket, _)) = accept else { break };
            let conn = conn.clone();
            let rhost = remote_host.clone();
            tokio::spawn(async move {
                let Ok(channel) = conn
                    .channel_open_direct_tcpip(rhost, remote_port as u32, "127.0.0.1".to_string(), 0)
                    .await
                else {
                    return;
                };
                let mut stream = channel.into_stream();
                let mut buf_a = vec![0u8; 8192];
                let mut buf_b = vec![0u8; 8192];
                loop {
                    tokio::select! {
                        r = socket.read(&mut buf_a) => match r {
                            Ok(0) | Err(_) => break,
                            Ok(n) => { if stream.write_all(&buf_a[..n]).await.is_err() { break; } }
                        },
                        r = stream.read(&mut buf_b) => match r {
                            Ok(0) | Err(_) => break,
                            Ok(n) => { if socket.write_all(&buf_b[..n]).await.is_err() { break; } }
                        },
                    }
                }
            });
        }
    });

    Ok(actual)
}
