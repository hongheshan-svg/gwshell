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
            // Teardown signal for THIS bridge: without it, an in-flight bridge
            // outlives close_local_forward/close_ssh and keeps a clone of the
            // shared connection Handle alive, preventing socket reclamation.
            let stop_inner = stop.clone();
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
                        _ = stop_inner.notified() => break,
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

/// Bind 127.0.0.1:local_port as a SOCKS5 proxy and forward each accepted
/// connection's CONNECT target through `conn` via direct-tcpip. Returns the
/// bound port.
///
/// Scope: no authentication (the listener is loopback-only) and CONNECT only —
/// BIND/UDP-ASSOCIATE are rejected. ATYP IPv4/domain/IPv6 are all parsed.
pub async fn start_socks(
    conn: Arc<Handle<Client>>,
    local_port: u16,
    stop: Arc<Notify>,
) -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", local_port))
        .await
        .map_err(|e| format!("SOCKS bind failed: {}", e))?;
    let actual = listener.local_addr().map_err(|e| e.to_string())?.port();

    tokio::spawn(async move {
        loop {
            let accept = tokio::select! {
                _ = stop.notified() => break,
                a = listener.accept() => a,
            };
            let Ok((mut socket, _)) = accept else { break };
            let conn = conn.clone();
            // Same per-bridge teardown signal as start_local: ensures an
            // in-flight SOCKS bridge does not outlive close_socks_forward.
            let stop_inner = stop.clone();
            tokio::spawn(async move {
                // --- SOCKS5 handshake: VER NMETHODS METHODS... -> 05 00 ---
                let mut head = [0u8; 2];
                if socket.read_exact(&mut head).await.is_err() {
                    return;
                }
                if head[0] != 0x05 {
                    return; // not SOCKS5
                }
                let nmethods = head[1] as usize;
                let mut methods = vec![0u8; nmethods];
                if nmethods > 0 && socket.read_exact(&mut methods).await.is_err() {
                    return;
                }
                // Reply: version 5, "no authentication required".
                if socket.write_all(&[0x05, 0x00]).await.is_err() {
                    return;
                }

                // --- CONNECT request: VER CMD RSV ATYP DST.ADDR DST.PORT ---
                let mut req = [0u8; 4];
                if socket.read_exact(&mut req).await.is_err() {
                    return;
                }
                if req[0] != 0x05 {
                    return;
                }
                let cmd = req[1];
                let atyp = req[3];
                if cmd != 0x01 {
                    // Only CONNECT is supported; reply 0x07 (command not supported).
                    let _ = socket
                        .write_all(&[0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                        .await;
                    return;
                }

                // Parse destination host string per ATYP.
                let dest_host = match atyp {
                    0x01 => {
                        let mut a = [0u8; 4];
                        if socket.read_exact(&mut a).await.is_err() {
                            return;
                        }
                        format!("{}.{}.{}.{}", a[0], a[1], a[2], a[3])
                    }
                    0x03 => {
                        let mut len = [0u8; 1];
                        if socket.read_exact(&mut len).await.is_err() {
                            return;
                        }
                        let mut name = vec![0u8; len[0] as usize];
                        if socket.read_exact(&mut name).await.is_err() {
                            return;
                        }
                        match String::from_utf8(name) {
                            Ok(s) => s,
                            Err(_) => {
                                let _ = socket
                                    .write_all(&[0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                                    .await;
                                return;
                            }
                        }
                    }
                    0x04 => {
                        let mut a = [0u8; 16];
                        if socket.read_exact(&mut a).await.is_err() {
                            return;
                        }
                        std::net::Ipv6Addr::from(a).to_string()
                    }
                    _ => {
                        // Address type not supported.
                        let _ = socket
                            .write_all(&[0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                            .await;
                        return;
                    }
                };

                let mut port_buf = [0u8; 2];
                if socket.read_exact(&mut port_buf).await.is_err() {
                    return;
                }
                let dest_port = u16::from_be_bytes(port_buf);

                // Open the direct-tcpip channel to the requested target.
                let channel = match conn
                    .channel_open_direct_tcpip(
                        dest_host,
                        dest_port as u32,
                        "127.0.0.1".to_string(),
                        0,
                    )
                    .await
                {
                    Ok(c) => c,
                    Err(_) => {
                        // Connection refused (bound addr/port reported as zeros).
                        let _ = socket
                            .write_all(&[0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                            .await;
                        return;
                    }
                };

                // Success reply: succeeded, ATYP IPv4, bound addr 0.0.0.0:0.
                if socket
                    .write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                    .await
                    .is_err()
                {
                    return;
                }

                // --- Bridge socket <-> channel (same select as start_local) ---
                let mut stream = channel.into_stream();
                let mut buf_a = vec![0u8; 8192];
                let mut buf_b = vec![0u8; 8192];
                loop {
                    tokio::select! {
                        _ = stop_inner.notified() => break,
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
