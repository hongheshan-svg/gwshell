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
}
