use crate::ssh::known_hosts::{self, HostKeyVerdict};
use russh::client::{self, Msg, Session};
use russh::Channel;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

/// Carries a host-key rejection reason out of the handshake so connect.rs can
/// turn it into the exact `FINGERPRINT_UNKNOWN:`/`FINGERPRINT_MISMATCH:` string
/// the frontend already parses.
#[derive(Debug, Clone)]
pub enum HostKeyError {
    Unknown { fingerprint: String, key_type: String },
    Mismatch { fingerprint: String, key_type: String },
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
        server_public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
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
            HostKeyVerdict::Unknown { fingerprint, key_type } => {
                *self.rejection.lock().unwrap() =
                    Some(HostKeyError::Unknown { fingerprint, key_type });
                Ok(false)
            }
            HostKeyVerdict::Mismatch { fingerprint, key_type } => {
                *self.rejection.lock().unwrap() =
                    Some(HostKeyError::Mismatch { fingerprint, key_type });
                Ok(false)
            }
        }
    }

    /// Inbound remote-forward (`tcpip_forward`) connection: the server opened a
    /// forwarded-tcpip channel because a client connected to the port we asked
    /// it to listen on. `connected_port` is that server-side listen port; we
    /// look up the registered local target, dial it, and bridge the two.
    ///
    /// russh 0.61 signature CONFIRMED from
    /// `~/.cargo/.../russh-0.61.1/src/client/mod.rs:2207` (Handler trait) and
    /// the call site at `src/client/encrypted.rs:758`.
    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: Channel<Msg>,
        connected_address: &str,
        connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        // Resolve the local target for this forwarded port. Match on the exact
        // port first, then fall back to a 0-keyed wildcard (server chose the
        // port). If unknown, drop the channel (returns, channel closes on drop).
        let target = {
            let map = self.forwarded.lock().unwrap();
            map.get(&connected_port).or_else(|| map.get(&0)).cloned()
        };
        let Some((local_host, local_port)) = target else {
            eprintln!(
                "[gwshell] forwarded-tcpip on {}:{} has no registered local target; dropping",
                connected_address, connected_port
            );
            return Ok(());
        };

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
    /// russh 0.61 signature CONFIRMED from the Handler trait at
    /// `~/.cargo/.../russh-0.61.1/src/client/mod.rs:2232` and its call site at
    /// `src/client/encrypted.rs:783` (`ChannelType::AgentForward`).
    async fn server_channel_open_agent_forward(
        &mut self,
        channel: Channel<Msg>,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        // Defensive: only proxy when the user opted in. If forwarding was never
        // requested, a server opening this channel is unexpected — drop it.
        if !self.agent_forward {
            eprintln!(
                "[gwshell] received auth-agent channel without agent forwarding enabled; dropping"
            );
            return Ok(());
        }

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
/// Windows. `AgentClient::into_inner()` (russh 0.61
/// `src/keys/agent/client.rs:38`) yields the boxed underlying stream — a
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
