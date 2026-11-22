use crate::ssh::auth;
use crate::ssh::handler::{Client, ForwardTargets};
use crate::ssh::known_hosts;
use crate::ssh::params::ConnectParams;
use crate::ssh::transport::{self, SshStream};
use russh::client::{self, Handle};
use russh::keys::Algorithm;
use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Host-key algorithms in russh's default order, but with the family already
/// pinned for this host moved to the front. A legitimate server that offers
/// several host-key types then negotiates the one we trust (as OpenSSH does),
/// so a `KeyTypeChanged` prompt only appears when the server genuinely stopped
/// offering the pinned type — or a MITM is choosing a different one.
fn host_key_preference(pinned_key_type: Option<&str>) -> Cow<'static, [Algorithm]> {
    let default = russh::Preferred::DEFAULT.key;
    let Some(pinned) = pinned_key_type else {
        return default;
    };
    let family = known_hosts::key_family(pinned);
    let (mut first, rest): (Vec<Algorithm>, Vec<Algorithm>) = default
        .iter()
        .cloned()
        .partition(|alg| known_hosts::key_family(alg.as_ref()) == family);
    if first.is_empty() {
        return default;
    }
    first.extend(rest);
    Cow::Owned(first)
}

fn make_config(p: &ConnectParams) -> Arc<client::Config> {
    // Keepalive interval: honour the user's setting when present; 0 disables
    // keepalives; absent/None falls back to the 30-second default.
    let keepalive_interval = match p.keepalive_interval {
        Some(0) => None,
        Some(secs) => Some(Duration::from_secs(secs)),
        None => Some(Duration::from_secs(30)),
    };
    // Max unanswered keepalives before disconnect; absent/None → default 3.
    let keepalive_max = p.server_alive_count_max.unwrap_or(3) as usize;

    let preferred = if p.compression {
        russh::Preferred {
            key: host_key_preference(known_hosts::pinned_key_type(&p.host, p.port).as_deref()),
            compression: std::borrow::Cow::Borrowed(&[
                russh::compression::ZLIB,
                russh::compression::ZLIB_LEGACY,
                russh::compression::NONE,
            ]),
            ..russh::Preferred::DEFAULT
        }
    } else {
        russh::Preferred {
            key: host_key_preference(known_hosts::pinned_key_type(&p.host, p.port).as_deref()),
            ..russh::Preferred::DEFAULT
        }
    };

    Arc::new(client::Config {
        inactivity_timeout: if p.idle_disconnect_minutes > 0 {
            Some(Duration::from_secs(p.idle_disconnect_minutes as u64 * 60))
        } else {
            None
        },
        keepalive_interval,
        keepalive_max,
        nodelay: true,
        preferred,
        ..Default::default()
    })
}

/// Establish an authenticated russh session to the target, honouring jump host
/// and proxy settings. Bounds the entire handshake + auth + jump channel setup
/// by `p.connection_timeout`.
pub async fn establish(p: &ConnectParams) -> Result<(Handle<Client>, ForwardTargets), String> {
    let secs = p.connection_timeout.max(5) as u64;
    let work = async {
        let stream = build_transport_stream(p).await?;
        connect_over(stream, p).await
    };
    tokio::time::timeout(Duration::from_secs(secs), work)
        .await
        .map_err(|_| format!("SSH connection timed out after {}s", secs))?
}

async fn build_transport_stream(p: &ConnectParams) -> Result<SshStream, String> {
    if let Some(jh) = p.jump_host.as_deref().filter(|s| !s.is_empty()) {
        // 1. Connect to the jump host itself (direct/proxy only — no nested jump).
        let jump_params = ConnectParams {
            host: jh.to_string(),
            port: p.jump_port,
            username: p
                .jump_username
                .clone()
                .unwrap_or_else(|| p.username.clone()),
            // Never fall back to the TARGET's password/TOTP: the jump host is a
            // separate machine (often another trust domain) and must not learn
            // the target's credentials. An empty jump password simply fails
            // password auth on the jump hop.
            password: p.jump_password.clone(),
            totp_code: None,
            private_key_path: p.jump_private_key_path.clone(),
            auth_method: if p
                .jump_private_key_path
                .as_deref()
                .is_some_and(|s| !s.is_empty())
            {
                "publickey".into()
            } else if p.jump_password.as_deref().is_some_and(|s| !s.is_empty()) {
                "password".into()
            } else {
                "agent".into()
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
    let config = make_config(p);

    let mut session = match client::connect_stream(config, stream, handler).await {
        Ok(s) => s,
        Err(e) => {
            // Host-key rejection surfaces as the frontend-parsed
            // `FINGERPRINT_*:{json}` string, tagged with THIS hop's host:port
            // (the jump host's when the jump hop is the one rejected).
            if let Some(rej) = rejection.lock().unwrap().take() {
                return Err(rej.to_error_string(&p.host, p.port));
            }
            return Err(format!("Handshake failed: {}", e));
        }
    };

    auth::authenticate(&mut session, p).await?;
    Ok((session, forwarded))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn families(algs: &[Algorithm]) -> Vec<&'static str> {
        algs.iter()
            .map(|a| known_hosts::key_family(a.as_ref()))
            .collect()
    }

    #[test]
    fn host_key_preference_defaults_without_pin() {
        assert_eq!(
            host_key_preference(None).as_ref(),
            russh::Preferred::DEFAULT.key.as_ref()
        );
    }

    #[test]
    fn host_key_preference_moves_pinned_family_first() {
        let prefs = host_key_preference(Some("ecdsa-sha2-nistp256"));
        assert_eq!(families(&prefs)[0], "ecdsa");
        // Nothing dropped, only reordered.
        assert_eq!(prefs.len(), russh::Preferred::DEFAULT.key.len());
        // Legacy libssh2 labels map to the same family.
        assert_eq!(families(&host_key_preference(Some("Rsa")))[0], "rsa");
    }

    #[test]
    fn host_key_error_string_carries_hop_host_and_json_payload() {
        let err = crate::ssh::handler::HostKeyError::KeyTypeChanged {
            fingerprint: "SHA256:abc".into(),
            key_type: "ssh-rsa".into(),
            known_key_type: "ssh-ed25519".into(),
        }
        .to_error_string("jump.example", 2222);
        let payload = err
            .strip_prefix("FINGERPRINT_KEYTYPE_CHANGED:")
            .expect("prefix");
        let v: serde_json::Value = serde_json::from_str(payload).unwrap();
        assert_eq!(v["fingerprint"], "SHA256:abc");
        assert_eq!(v["keyType"], "ssh-rsa");
        assert_eq!(v["knownKeyType"], "ssh-ed25519");
        assert_eq!(v["host"], "jump.example");
        assert_eq!(v["port"], 2222);
    }
}
