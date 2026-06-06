use crate::ssh::auth;
use crate::ssh::handler::{Client, ForwardTargets, HostKeyError};
use crate::ssh::params::ConnectParams;
use crate::ssh::transport::{self, expand_tilde, SshStream};
use russh::client::{self, Handle};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

fn make_config(idle_minutes: u32) -> Arc<client::Config> {
    Arc::new(client::Config {
        inactivity_timeout: if idle_minutes > 0 {
            Some(Duration::from_secs(idle_minutes as u64 * 60))
        } else {
            None
        },
        keepalive_interval: Some(Duration::from_secs(30)),
        keepalive_max: 3,
        nodelay: true,
        ..Default::default()
    })
}

/// Establish an authenticated russh session to the target, honouring jump host
/// and proxy settings. Returns the live Handle plus the target session's
/// remote-forward target map (shared with that session's `Client` handler).
pub async fn establish(p: &ConnectParams) -> Result<(Handle<Client>, ForwardTargets), String> {
    let stream = build_transport_stream(p).await?;
    connect_over(stream, p).await
}

async fn build_transport_stream(p: &ConnectParams) -> Result<SshStream, String> {
    if let Some(jh) = p.jump_host.as_deref().filter(|s| !s.is_empty()) {
        // 1. Connect to the jump host itself (direct/proxy only — no nested jump).
        let jump_params = ConnectParams {
            host: jh.to_string(),
            port: p.jump_port,
            username: p.jump_username.clone().unwrap_or_else(|| p.username.clone()),
            password: p.jump_password.clone().or_else(|| p.password.clone()),
            private_key_path: p.jump_private_key_path.clone(),
            auth_method: if p.jump_private_key_path.as_deref().is_some_and(|s| !s.is_empty()) {
                "publickey".into()
            } else {
                "password".into()
            },
            jump_host: None,
            proxy_type: p.proxy_type.clone(),
            proxy_host: p.proxy_host.clone(),
            proxy_port: p.proxy_port,
            proxy_username: p.proxy_username.clone(),
            proxy_password: p.proxy_password.clone(),
            // Agent forwarding applies to the final target's interactive shell,
            // not the jump hop (which only opens a direct-tcpip channel), so the
            // jump session never requests it.
            agent_forward: false,
            ..p.clone()
        };
        let jump_stream = transport::build_direct_or_proxied(&jump_params).await?;
        // The jump session never hosts remote forwards, so its target map is
        // discarded — only the final target session's map is threaded upward.
        let (jump_session, _jump_forwarded) = connect_over(jump_stream, &jump_params).await?;
        // 2. Open a direct-tcpip channel to the real target through the jump.
        let channel = jump_session
            .channel_open_direct_tcpip(p.host.clone(), p.port as u32, "127.0.0.1".to_string(), 0)
            .await
            .map_err(|e| format!("Jump direct-tcpip failed: {}", e))?;
        // Keep the jump session alive for the lifetime of the tunnel by storing it
        // alongside the channel stream.
        Ok(Box::new(JumpStream {
            _jump: jump_session,
            inner: channel.into_stream(),
        }))
    } else {
        transport::build_direct_or_proxied(p).await
    }
}

/// Wraps a jump channel stream and keeps the jump Handle alive with it.
struct JumpStream<S> {
    _jump: Handle<Client>,
    inner: S,
}
impl<S: tokio::io::AsyncRead + Unpin> tokio::io::AsyncRead for JumpStream<S> {
    fn poll_read(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        let this = unsafe { self.get_unchecked_mut() };
        std::pin::Pin::new(&mut this.inner).poll_read(cx, buf)
    }
}
impl<S: tokio::io::AsyncWrite + Unpin> tokio::io::AsyncWrite for JumpStream<S> {
    fn poll_write(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &[u8],
    ) -> std::task::Poll<std::io::Result<usize>> {
        let this = unsafe { self.get_unchecked_mut() };
        std::pin::Pin::new(&mut this.inner).poll_write(cx, buf)
    }
    fn poll_flush(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        let this = unsafe { self.get_unchecked_mut() };
        std::pin::Pin::new(&mut this.inner).poll_flush(cx)
    }
    fn poll_shutdown(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        let this = unsafe { self.get_unchecked_mut() };
        std::pin::Pin::new(&mut this.inner).poll_shutdown(cx)
    }
}

async fn connect_over(
    stream: SshStream,
    p: &ConnectParams,
) -> Result<(Handle<Client>, ForwardTargets), String> {
    let rejection = Arc::new(Mutex::new(None));
    let forwarded: ForwardTargets = Arc::new(Mutex::new(HashMap::new()));
    let handler = Client {
        host: p.host.clone(),
        port: p.port,
        rejection: rejection.clone(),
        forwarded: forwarded.clone(),
        agent_forward: p.agent_forward,
    };
    let config = make_config(p.idle_disconnect_minutes);

    let mut session = match client::connect_stream(config, stream, handler).await {
        Ok(s) => s,
        Err(e) => {
            // Host-key rejection surfaces as the exact frontend-parsed strings.
            if let Some(rej) = rejection.lock().unwrap().take() {
                return Err(match rej {
                    HostKeyError::Unknown { fingerprint, key_type } => {
                        format!("FINGERPRINT_UNKNOWN:{}:{}", fingerprint, key_type)
                    }
                    HostKeyError::Mismatch { fingerprint, key_type } => {
                        format!("FINGERPRINT_MISMATCH:{}:{}", fingerprint, key_type)
                    }
                });
            }
            return Err(format!("Handshake failed: {}", e));
        }
    };

    auth::authenticate(&mut session, p).await?;
    let _ = expand_tilde; // referenced for re-export consistency
    Ok((session, forwarded))
}
