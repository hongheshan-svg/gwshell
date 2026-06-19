use super::params::ConnectParams;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;
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
/// needs an established russh session. Returns a tokio async stream.
pub async fn build_direct_or_proxied(p: &ConnectParams) -> Result<SshStream, String> {
    match p.proxy_type.as_deref().unwrap_or("none") {
        "socks5" => {
            let std_stream = socks5_connect(p)?;
            std_stream
                .set_nonblocking(true)
                .map_err(|e| e.to_string())?;
            let tok = TokioTcp::from_std(std_stream).map_err(|e| e.to_string())?;
            Ok(Box::new(tok))
        }
        "http" => {
            let std_stream = http_connect(p)?;
            std_stream
                .set_nonblocking(true)
                .map_err(|e| e.to_string())?;
            let tok = TokioTcp::from_std(std_stream).map_err(|e| e.to_string())?;
            Ok(Box::new(tok))
        }
        _ => {
            let addr = format!("{}:{}", p.host, p.port);
            let tok = if p.connection_timeout > 0 {
                tokio::time::timeout(
                    Duration::from_secs(p.connection_timeout as u64),
                    TokioTcp::connect(&addr),
                )
                .await
                .map_err(|_| format!("Connection to {} timed out", addr))?
                .map_err(|e| format!("Connection to {} failed: {}", addr, e))?
            } else {
                TokioTcp::connect(&addr)
                    .await
                    .map_err(|e| format!("Connection to {} failed: {}", addr, e))?
            };
            Ok(Box::new(tok))
        }
    }
}

fn socks5_connect(p: &ConnectParams) -> Result<TcpStream, String> {
    let proxy = format!("{}:{}", p.proxy_host.as_deref().unwrap_or(""), p.proxy_port);
    let target = format!("{}:{}", p.host, p.port);
    let s = match (p.proxy_username.as_deref(), p.proxy_password.as_deref()) {
        (Some(u), Some(pw)) => {
            socks::Socks5Stream::connect_with_password(proxy.as_str(), target.as_str(), u, pw)
        }
        _ => socks::Socks5Stream::connect(proxy.as_str(), target.as_str()),
    }
    .map_err(|e| format!("SOCKS5 proxy failed: {}", e))?;
    Ok(s.into_inner())
}

fn http_connect(p: &ConnectParams) -> Result<TcpStream, String> {
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
    let mut stream = TcpStream::connect(format!(
        "{}:{}",
        p.proxy_host.as_deref().unwrap_or(""),
        p.proxy_port
    ))
    .map_err(|e| format!("HTTP proxy connection failed: {}", e))?;
    let mut req = format!(
        "CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n",
        host = p.host,
        port = p.port
    );
    if let (Some(u), Some(pw)) = (p.proxy_username.as_deref(), p.proxy_password.as_deref()) {
        let creds = BASE64.encode(format!("{}:{}", u, pw).as_bytes());
        req.push_str(&format!("Proxy-Authorization: Basic {}\r\n", creds));
    }
    req.push_str("\r\n");
    stream
        .write_all(req.as_bytes())
        .map_err(|e| format!("HTTP CONNECT request failed: {}", e))?;
    let mut resp = [0u8; 4096];
    let n = stream
        .read(&mut resp)
        .map_err(|e| format!("HTTP proxy response failed: {}", e))?;
    let s = String::from_utf8_lossy(&resp[..n]);
    if !s.contains("200") {
        return Err(format!(
            "HTTP proxy refused: {}",
            s.lines().next().unwrap_or("")
        ));
    }
    Ok(stream)
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
}
