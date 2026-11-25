use crate::ssh::known_hosts::{self, HostKeyVerdict};
use russh::client::{self, ChannelOpenHandle, Msg, Session};
use russh::keys::PublicKeyOrCertificate;
use russh::{Channel, ChannelOpenFailure};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

/// Carries a host-key rejection reason out of the handshake so connect.rs can
/// turn it into the exact `FINGERPRINT_UNKNOWN:`/`FINGERPRINT_MISMATCH:` string
/// the frontend already parses.
#[derive(Debug, Clone)]
pub enum HostKeyError {
    Unknown {
        fingerprint: String,
        key_type: String,
    },
    Mismatch {
        fingerprint: String,
        key_type: String,
    },
    /// The host is pinned under a different key-type family than the one it
    /// presented. Either a legitimate key-type migration or a MITM trying to
    /// dodge the mismatch warning — surfaced distinctly so the UI can warn.
    KeyTypeChanged {
        fingerprint: String,
        key_type: String,
        known_key_type: String,
    },
}

impl HostKeyError {
    /// Serialize as the `FINGERPRINT_*:` error string the frontend parses. The
    /// payload is JSON and carries the host/port the key actually belongs to —
    /// with a jump host, the rejected key may be the jump hop's, not the
    /// target's, and the UI must pin it under the right `host:port`.
    pub fn to_error_string(&self, host: &str, port: u16) -> String {
        let (prefix, fingerprint, key_type, known_key_type) = match self {
            HostKeyError::Unknown {
                fingerprint,
                key_type,
            } => ("FINGERPRINT_UNKNOWN", fingerprint, key_type, None),
            HostKeyError::Mismatch {
                fingerprint,
                key_type,
            } => ("FINGERPRINT_MISMATCH", fingerprint, key_type, None),
            HostKeyError::KeyTypeChanged {
                fingerprint,
                key_type,
                known_key_type,
            } => (
                "FINGERPRINT_KEYTYPE_CHANGED",
                fingerprint,
                key_type,
                Some(known_key_type),
            ),
        };
        let payload = serde_json::json!({
            "fingerprint": fingerprint,
            "keyType": key_type,
            "knownKeyType": known_key_type,
            "host": host,
            "port": port,
        });
        format!("{}:{}", prefix, payload)
    }
}

/// Maps a remote-forwarded server port to the local `(host, port)` target that
/// each inbound forwarded-tcpip channel on that port should be bridged to.
/// Shared between the `Client` handler (consumer) and `start_remote_forward`
/// (producer) — see `session::spawn` for how the clone is threaded through.
pub type ForwardTargets = Arc<Mutex<HashMap<u32, (String, u16)>>>;

pub struct Client {
    pub host: String,
    pub port: u16,
    /// Set by check_server_key when it rejects, read by connect.rs.
    pub rejection: std::sync::Arc<std::sync::Mutex<Option<HostKeyError>>>,
    /// Remote-forward targets keyed by the server-side listen port.
    pub forwarded: ForwardTargets,
    /// When true, accept the server-opened `auth-agent@openssh.com` channel and
    /// proxy it to the local SSH agent (agent forwarding, `ssh -A`). When false
    /// we never request forwarding, so this channel should not arrive; if it
    /// does anyway, we drop it (channel closes on handler return).
    pub agent_forward: bool,
}

impl client::Handler for Client {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        // Host certificates are pinned by their embedded public key, exactly
        // like a bare host key (we do not implement CA trust).
        let server_public_key = server_key.public_key();
        // SHA-256 fingerprint string "SHA256:<base64-no-pad>". The ssh_key
        // `Fingerprint` Display impl emits the "SHA256:..." form with UNPADDED
        // base64 (`Base64Unpadded`), and `known_hosts::verify` normalizes away
        // padding, so this matches both new (unpadded) and legacy (padded
        // `STANDARD`) entries in the shared known_hosts store.
        let fp = server_public_key
            .fingerprint(russh::keys::ssh_key::HashAlg::Sha256)
            .to_string();
        let key_type = server_public_key.algorithm().to_string();

        match known_hosts::verify(&known_hosts::load(), &self.host, self.port, &fp, &key_type) {
            HostKeyVerdict::Trusted => Ok(true),
            HostKeyVerdict::Unknown {
                fingerprint,
                key_type,
            } => {
                *self
                    .rejection
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner) =
                    Some(HostKeyError::Unknown {
                        fingerprint,
                        key_type,
                    });
                Ok(false)
            }
            HostKeyVerdict::Mismatch {
                fingerprint,
                key_type,
            } => {
                *self
                    .rejection
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner) =
                    Some(HostKeyError::Mismatch {
                        fingerprint,
                        key_type,
                    });
                Ok(false)
            }
            HostKeyVerdict::KeyTypeChanged {
                fingerprint,
                key_type,
                known_key_type,
            } => {
                *self
                    .rejection
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner) =
                    Some(HostKeyError::KeyTypeChanged {
                        fingerprint,
                        key_type,
                        known_key_type,
                    });
                Ok(false)
            }
        }
    }

    /// Inbound remote-forward (`tcpip_forward`) connection: the server opened a
    /// forwarded-tcpip channel because a client connected to the port we asked
    /// it to listen on. `connected_port` is that server-side listen port; we
    /// look up the registered local target, dial it, and bridge the two.
    ///
    /// Since russh 0.65 the handler must explicitly `accept()` the channel
    /// (dropping `reply` rejects it), so channels for unregistered ports are
    /// refused instead of silently opened (RUSTSEC-2026-0492).
    #[allow(clippy::too_many_arguments)] // signature fixed by russh's Handler trait
    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: Channel<Msg>,
        connected_address: &str,
        connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        reply: ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        // Resolve the local target for this forwarded port. Match on the exact
        // port first, then fall back to a 0-keyed wildcard (server chose the
        // port). If unknown, drop the channel (returns, channel closes on drop).
        let target = {
            let map = self
                .forwarded
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            map.get(&connected_port).or_else(|| map.get(&0)).cloned()
        };
        let Some((local_host, local_port)) = target else {
            eprintln!(
                "[gwshell] forwarded-tcpip on {}:{} has no registered local target; rejecting",
                connected_address, connected_port
            );
            reply
                .reject(ChannelOpenFailure::AdministrativelyProhibited)
                .await;
            return Ok(());
        };
        reply.accept().await;

        // Dial the local target and bridge it to the forwarded channel. Spawned
        // so the handler event loop is never blocked by the bridge.
        tokio::spawn(async move {
            let Ok(mut socket) = TcpStream::connect((local_host.as_str(), local_port)).await else {
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
        Ok(())
    }

    /// Agent forwarding (`ssh -A`): the server opened an `auth-agent@openssh.com`
    /// channel because we sent the `auth-agent-req@openssh.com` request on the
    /// shell channel. The channel speaks the raw SSH-agent wire protocol, so we
    /// act as a transparent pipe: connect to the *local* agent and shuttle bytes
    /// between it and this channel. We deliberately do NOT use russh's
    /// `keys::agent::server::serve` (which is a full agent that holds keys
    /// itself) — OpenSSH-style forwarding just relays frames to the user's real
    /// agent so onward hops can sign with keys the local agent never exports.
    ///
    /// As with forwarded-tcpip, russh 0.65 requires an explicit `accept()`.
    async fn server_channel_open_agent_forward(
        &mut self,
        channel: Channel<Msg>,
        reply: ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        // Defensive: only proxy when the user opted in. If forwarding was never
        // requested, a server opening this channel is unexpected — reject it.
        if !self.agent_forward {
            eprintln!(
                "[gwshell] received auth-agent channel without agent forwarding enabled; rejecting"
            );
            reply
                .reject(ChannelOpenFailure::AdministrativelyProhibited)
                .await;
            return Ok(());
        }
        reply.accept().await;

        tokio::spawn(async move {
            // Connect to the local agent with the same OS-specific logic used for
            // agent AUTH (see ssh/auth.rs::try_agent), then take the raw transport
            // stream via `AgentClient::into_inner()` so we can pipe bytes through
            // it without interpreting the agent protocol ourselves.
            //
            // Bounded by a 5-second timeout: on Windows the named pipe can be
            // ERROR_PIPE_BUSY indefinitely (all server instances busy), which
            // would stall this task forever. A stuck agent must not leak the
            // spawned proxy task — abort and let the forwarded channel close.
            let agent_stream = match tokio::time::timeout(
                std::time::Duration::from_secs(5),
                connect_local_agent_stream(),
            )
            .await
            {
                Ok(Ok(s)) => s,
                Ok(Err(e)) => {
                    eprintln!("[gwshell] agent forwarding: local agent unavailable: {}", e);
                    return;
                }
                Err(_) => {
                    eprintln!(
                        "[gwshell] agent forwarding: timed out connecting to local agent (5 s); aborting proxy"
                    );
                    return;
                }
            };
            let mut agent = agent_stream;
            let mut stream = channel.into_stream();
            let mut buf_a = vec![0u8; 8192];
            let mut buf_b = vec![0u8; 8192];
            loop {
                tokio::select! {
                    r = agent.read(&mut buf_a) => match r {
                        Ok(0) | Err(_) => break,
                        Ok(n) => { if stream.write_all(&buf_a[..n]).await.is_err() { break; } }
                    },
                    r = stream.read(&mut buf_b) => match r {
                        Ok(0) | Err(_) => break,
                        Ok(n) => { if agent.write_all(&buf_b[..n]).await.is_err() { break; } }
                    },
                }
            }
        });
        Ok(())
    }
}

/// Connect to the local SSH agent and return its raw transport stream
/// (`AsyncRead + AsyncWrite`) for transparent agent-forwarding proxying.
///
/// Mirrors the platform branches of `ssh/auth.rs::try_agent`: `$SSH_AUTH_SOCK`
/// on Unix; the OpenSSH-for-Windows named pipe with a Pageant fallback on
/// Windows. `AgentClient::into_inner()` yields the boxed underlying stream — a
/// `UnixStream` / `NamedPipeClient` / `PageantStream`, all of which implement
/// `AsyncRead + AsyncWrite`.
#[cfg(any(unix, windows))]
async fn connect_local_agent_stream(
) -> Result<Box<dyn russh::keys::agent::client::AgentStream + Send + Unpin + 'static>, String> {
    use russh::keys::agent::client::AgentClient;
    #[cfg(unix)]
    {
        let agent = AgentClient::connect_env()
            .await
            .map_err(|e| format!("SSH agent unavailable: {}", e))?;
        Ok(agent.into_inner())
    }
    #[cfg(windows)]
    {
        match AgentClient::connect_named_pipe(r"\\.\pipe\openssh-ssh-agent").await {
            Ok(agent) => Ok(agent.into_inner()),
            Err(_) => {
                let agent = AgentClient::connect_pageant()
                    .await
                    .map_err(|e| format!("SSH agent unavailable: {}", e))?;
                Ok(agent.into_inner())
            }
        }
    }
}

#[cfg(not(any(unix, windows)))]
async fn connect_local_agent_stream(
) -> Result<Box<dyn russh::keys::agent::client::AgentStream + Send + Unpin + 'static>, String> {
    Err("SSH agent forwarding is not supported on this platform".to_string())
}
