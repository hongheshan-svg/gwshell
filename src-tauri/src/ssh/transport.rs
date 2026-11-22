use super::params::ConnectParams;
use std::net::IpAddr;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream as TokioTcp;

/// A connected, async, byte-oriented stream to hand to russh's `connect_stream`.
pub type SshStream = Box<dyn AsyncStream>;
pub trait AsyncStream: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send {}
impl<T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send> AsyncStream for T {}

/// Expand a leading `~`/`~/` to the home dir. (Ported from ssh.rs.)
pub fn expand_tilde(path: &str) -> std::path::PathBuf {
    use std::path::PathBuf;
    if path == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from("~"));
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}

/// Build the underlying transport stream to the target host (direct or via
/// SOCKS5/HTTP proxy). Jump-host transport is handled in connect.rs because it
/// needs an established russh session.
///
/// Everything here is non-blocking tokio I/O, and the WHOLE setup (proxy TCP
/// connect + proxy handshake, or the direct connect) is bounded by the
/// session's `connection_timeout` — an unresponsive proxy can no longer stall
/// a runtime worker or hang the connect forever.
pub async fn build_direct_or_proxied(p: &ConnectParams) -> Result<SshStream, String> {
    let work = async {
        match p.proxy_type.as_deref().unwrap_or("none") {
            "socks5" => {
                let mut stream = connect_proxy(p).await?;
                let auth = proxy_auth(p);
                socks5_handshake(&mut stream, &p.host, p.port, auth)
                    .await
                    .map_err(|e| format!("SOCKS5 proxy failed: {}", e))?;
                Ok::<SshStream, String>(Box::new(stream) as SshStream)
            }
            "http" => {
                let mut stream = connect_proxy(p).await?;
                http_connect_handshake(&mut stream, &p.host, p.port, proxy_auth(p)).await?;
                Ok(Box::new(stream) as SshStream)
            }
            _ => {
                let addr = authority(&p.host, p.port);
                let tok = TokioTcp::connect(&addr)
                    .await
                    .map_err(|e| format!("Connection to {} failed: {}", addr, e))?;
                Ok(Box::new(tok) as SshStream)
            }
        }
    };
    if p.connection_timeout > 0 {
        tokio::time::timeout(Duration::from_secs(p.connection_timeout as u64), work)
            .await
            .map_err(|_| {
                format!(
                    "Connection to {} timed out after {}s",
                    authority(&p.host, p.port),
                    p.connection_timeout
                )
            })?
    } else {
        work.await
    }
}

/// `host:port`, bracketing bare IPv6 literals (`[::1]:22`) so the result is a
/// valid socket-address string / HTTP authority.
fn authority(host: &str, port: u16) -> String {
    let host = host.trim_start_matches('[').trim_end_matches(']');
    if host.parse::<std::net::Ipv6Addr>().is_ok() {
        format!("[{}]:{}", host, port)
    } else {
        format!("{}:{}", host, port)
    }
}

fn proxy_auth(p: &ConnectParams) -> Option<(&str, &str)> {
    p.proxy_username
        .as_deref()
        .filter(|u| !u.is_empty())
        .map(|u| (u, p.proxy_password.as_deref().unwrap_or("")))
}

async fn connect_proxy(p: &ConnectParams) -> Result<TokioTcp, String> {
    let proxy_host = p.proxy_host.as_deref().unwrap_or("").trim();
    if proxy_host.is_empty() {
        return Err("Proxy host is empty".to_string());
    }
    let addr = authority(proxy_host, p.proxy_port);
    TokioTcp::connect(&addr)
        .await
        .map_err(|e| format!("Proxy connection to {} failed: {}", addr, e))
}

/// RFC 1928 SOCKS5 CONNECT (+ RFC 1929 username/password auth). Reads exactly
/// the reply bytes, so nothing the target sends afterwards is consumed.
async fn socks5_handshake<S: AsyncRead + AsyncWrite + Unpin>(
    stream: &mut S,
    host: &str,
    port: u16,
    auth: Option<(&str, &str)>,
) -> Result<(), String> {
    let io = |e: std::io::Error| e.to_string();
    let greeting: &[u8] = if auth.is_some() {
        &[0x05, 0x02, 0x00, 0x02]
    } else {
        &[0x05, 0x01, 0x00]
    };
    stream.write_all(greeting).await.map_err(io)?;
    let mut choice = [0u8; 2];
    stream.read_exact(&mut choice).await.map_err(io)?;
    if choice[0] != 0x05 {
        return Err("not a SOCKS5 proxy".to_string());
    }
    match choice[1] {
        0x00 => {}
        0x02 => {
            let (user, pass) = auth.ok_or("proxy requires authentication")?;
            if user.len() > 255 || pass.len() > 255 {
                return Err("proxy username/password too long".to_string());
            }
            let mut req = vec![0x01, user.len() as u8];
            req.extend_from_slice(user.as_bytes());
            req.push(pass.len() as u8);
            req.extend_from_slice(pass.as_bytes());
            stream.write_all(&req).await.map_err(io)?;
            let mut status = [0u8; 2];
            stream.read_exact(&mut status).await.map_err(io)?;
            if status[1] != 0x00 {
                return Err("proxy authentication failed".to_string());
            }
        }
        0xFF => return Err("proxy accepted none of the offered auth methods".to_string()),
        other => {
            return Err(format!(
                "proxy chose unsupported auth method {:#04x}",
                other
            ))
        }
    }

    let mut req = vec![0x05, 0x01, 0x00];
    let bare_host = host.trim_start_matches('[').trim_end_matches(']');
    match bare_host.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => {
            req.push(0x01);
            req.extend_from_slice(&ip.octets());
        }
        Ok(IpAddr::V6(ip)) => {
            req.push(0x04);
            req.extend_from_slice(&ip.octets());
        }
        Err(_) => {
            if bare_host.is_empty() || bare_host.len() > 255 {
                return Err("invalid target host name".to_string());
            }
            req.push(0x03);
            req.push(bare_host.len() as u8);
            req.extend_from_slice(bare_host.as_bytes());
        }
    }
    req.extend_from_slice(&port.to_be_bytes());
    stream.write_all(&req).await.map_err(io)?;

    let mut head = [0u8; 4];
    stream.read_exact(&mut head).await.map_err(io)?;
    if head[0] != 0x05 {
        return Err("malformed SOCKS5 reply".to_string());
    }
    if head[1] != 0x00 {
        let reason = match head[1] {
            0x01 => "general failure",
            0x02 => "connection not allowed by ruleset",
            0x03 => "network unreachable",
            0x04 => "host unreachable",
            0x05 => "connection refused",
            0x06 => "TTL expired",
            0x07 => "command not supported",
            0x08 => "address type not supported",
            _ => "unknown error",
        };
        return Err(format!("CONNECT rejected: {}", reason));
    }
    // Skip the bound address + port.
    let addr_len = match head[3] {
        0x01 => 4,
        0x04 => 16,
        0x03 => {
            let mut len = [0u8; 1];
            stream.read_exact(&mut len).await.map_err(io)?;
            len[0] as usize
        }
        _ => return Err("malformed SOCKS5 reply address".to_string()),
    };
    let mut skip = vec![0u8; addr_len + 2];
    stream.read_exact(&mut skip).await.map_err(io)?;
    Ok(())
}

/// HTTP `CONNECT` tunnel setup. The response header block is read one byte at
/// a time up to the terminating blank line, so the SSH server banner that may
/// follow in the same TCP segment is left in the socket for russh. Success is
/// decided from the status line only (a 2xx code), not a substring search.
async fn http_connect_handshake<S: AsyncRead + AsyncWrite + Unpin>(
    stream: &mut S,
    host: &str,
    port: u16,
    auth: Option<(&str, &str)>,
) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
    if host.contains(['\r', '\n']) {
        return Err("invalid target host name".to_string());
    }
    let target = authority(host, port);
    let mut req = format!("CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n");
    if let Some((user, pass)) = auth {
        let creds = BASE64.encode(format!("{}:{}", user, pass).as_bytes());
        req.push_str(&format!("Proxy-Authorization: Basic {}\r\n", creds));
    }
    req.push_str("\r\n");
    stream
        .write_all(req.as_bytes())
        .await
        .map_err(|e| format!("HTTP CONNECT request failed: {}", e))?;

    const MAX_HEADER_BYTES: usize = 16 * 1024;
    let mut head = Vec::with_capacity(256);
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        if head.len() >= MAX_HEADER_BYTES {
            return Err("HTTP proxy response headers too large".to_string());
        }
        let n = stream
            .read(&mut byte)
            .await
            .map_err(|e| format!("HTTP proxy response failed: {}", e))?;
        if n == 0 {
            return Err("HTTP proxy closed the connection".to_string());
        }
        head.push(byte[0]);
    }
    let text = String::from_utf8_lossy(&head);
    let status_line = text.lines().next().unwrap_or("");
    if parse_http_status(status_line).is_some_and(|code| (200..300).contains(&code)) {
        Ok(())
    } else {
        Err(format!("HTTP proxy refused: {}", status_line))
    }
}

/// Status code from an `HTTP/1.x NNN reason` status line.
fn parse_http_status(line: &str) -> Option<u16> {
    let mut parts = line.split_whitespace();
    let version = parts.next()?;
    if !version.starts_with("HTTP/") {
        return None;
    }
    let code = parts.next()?;
    if code.len() != 3 {
        return None;
    }
    code.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn expand_tilde_leaves_absolute_unchanged() {
        assert_eq!(expand_tilde("/etc/x"), std::path::PathBuf::from("/etc/x"));
    }
    #[test]
    fn expand_tilde_expands_prefix() {
        let home = dirs::home_dir().unwrap();
        assert_eq!(expand_tilde("~/.ssh/id"), home.join(".ssh/id"));
    }

    #[test]
    fn http_status_parsing_uses_status_line_only() {
        assert_eq!(
            parse_http_status("HTTP/1.1 200 Connection established"),
            Some(200)
        );
        assert_eq!(
            parse_http_status("HTTP/1.0 407 Proxy Auth Required"),
            Some(407)
        );
        // A "200" elsewhere in the line must not count as success.
        assert_eq!(parse_http_status("HTTP/1.1 403 Forbidden 200"), Some(403));
        assert_eq!(parse_http_status("garbage 200"), None);
    }

    #[test]
    fn authority_brackets_ipv6() {
        assert_eq!(authority("::1", 22), "[::1]:22");
        assert_eq!(authority("[::1]", 22), "[::1]:22");
        assert_eq!(authority("example.com", 2222), "example.com:2222");
        assert_eq!(authority("10.0.0.1", 22), "10.0.0.1:22");
    }

    #[tokio::test]
    async fn http_connect_leaves_bytes_after_headers_unread() {
        let (mut client, mut server) = tokio::io::duplex(4096);
        let proxy = tokio::spawn(async move {
            let mut buf = vec![0u8; 1024];
            let _ = server.read(&mut buf).await.unwrap();
            // Proxy reply and the SSH banner arrive in ONE write.
            server
                .write_all(b"HTTP/1.1 200 OK\r\nX: y\r\n\r\nSSH-2.0-test\r\n")
                .await
                .unwrap();
            server
        });
        http_connect_handshake(&mut client, "target", 22, None)
            .await
            .unwrap();
        let mut banner = [0u8; 14];
        client.read_exact(&mut banner).await.unwrap();
        assert_eq!(&banner, b"SSH-2.0-test\r\n");
        drop(proxy.await.unwrap());
    }

    #[tokio::test]
    async fn http_connect_rejects_non_2xx() {
        let (mut client, mut server) = tokio::io::duplex(4096);
        tokio::spawn(async move {
            let mut buf = vec![0u8; 1024];
            let _ = server.read(&mut buf).await.unwrap();
            server
                .write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 1200\r\n\r\n")
                .await
                .unwrap();
        });
        let err = http_connect_handshake(&mut client, "target", 22, None)
            .await
            .unwrap_err();
        assert!(err.contains("403"), "{err}");
    }

    #[tokio::test]
    async fn socks5_domain_connect_with_auth() {
        let (mut client, mut server) = tokio::io::duplex(4096);
        let proxy = tokio::spawn(async move {
            let mut g = [0u8; 4];
            server.read_exact(&mut g).await.unwrap();
            assert_eq!(g, [0x05, 0x02, 0x00, 0x02]);
            server.write_all(&[0x05, 0x02]).await.unwrap();
            let mut a = [0u8; 2 + 1 + 1 + 2];
            server.read_exact(&mut a).await.unwrap();
            assert_eq!(&a, &[0x01, 1, b'u', 2, b'p', b'w']);
            server.write_all(&[0x01, 0x00]).await.unwrap();
            let mut r = [0u8; 4 + 1 + 4 + 2];
            server.read_exact(&mut r).await.unwrap();
            assert_eq!(&r[..5], &[0x05, 0x01, 0x00, 0x03, 4]);
            assert_eq!(&r[5..9], b"host");
            assert_eq!(&r[9..], &22u16.to_be_bytes());
            server
                .write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0, b'S'])
                .await
                .unwrap();
            server
        });
        socks5_handshake(&mut client, "host", 22, Some(("u", "pw")))
            .await
            .unwrap();
        let mut next = [0u8; 1];
        client.read_exact(&mut next).await.unwrap();
        assert_eq!(next[0], b'S', "bytes after the reply must stay unread");
        drop(proxy.await.unwrap());
    }
}
