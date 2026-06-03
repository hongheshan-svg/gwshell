use crate::ssh_next::known_hosts::{self, HostKeyVerdict};
use russh::client;

/// Carries a host-key rejection reason out of the handshake so connect.rs can
/// turn it into the exact `FINGERPRINT_UNKNOWN:`/`FINGERPRINT_MISMATCH:` string
/// the frontend already parses.
#[derive(Debug, Clone)]
pub enum HostKeyError {
    Unknown { fingerprint: String, key_type: String },
    Mismatch { fingerprint: String, key_type: String },
}

pub struct Client {
    pub host: String,
    pub port: u16,
    /// Set by check_server_key when it rejects, read by connect.rs.
    pub rejection: std::sync::Arc<std::sync::Mutex<Option<HostKeyError>>>,
}

impl client::Handler for Client {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        // SHA-256 fingerprint string "SHA256:<base64-no-pad>". The ssh_key
        // `Fingerprint` Display impl already emits the "SHA256:..." form.
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
}
