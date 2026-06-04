use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct KnownHostEntry {
    pub fingerprint: String,
    pub key_type: String,
}

/// Result of checking a server key against the local store.
#[derive(Debug, PartialEq)]
pub enum HostKeyVerdict {
    Trusted,
    Unknown { fingerprint: String, key_type: String },
    Mismatch { fingerprint: String, key_type: String },
}

/// Normalize a `SHA256:<base64>` fingerprint for comparison by dropping any
/// trailing base64 padding. The legacy `ssh.rs` store (and any pre-cutover
/// `known_hosts.json` it wrote) used PADDED `STANDARD` base64, whereas the
/// russh handler produces UNPADDED fingerprints. Comparing on the normalized
/// (padding-stripped) form lets a host trusted under either encoding verify as
/// Trusted, avoiding spurious FINGERPRINT_MISMATCH after the Task 12 cutover.
fn normalize_fingerprint(fp: &str) -> &str {
    fp.trim_end_matches('=')
}

pub fn verify(
    hosts: &HashMap<String, KnownHostEntry>,
    host: &str,
    port: u16,
    fingerprint: &str,
    key_type: &str,
) -> HostKeyVerdict {
    let key = format!("{}:{}", host, port);
    match hosts.get(&key) {
        Some(e) if normalize_fingerprint(&e.fingerprint) == normalize_fingerprint(fingerprint) => {
            HostKeyVerdict::Trusted
        }
        Some(_) => HostKeyVerdict::Mismatch {
            fingerprint: fingerprint.to_string(),
            key_type: key_type.to_string(),
        },
        None => HostKeyVerdict::Unknown {
            fingerprint: fingerprint.to_string(),
            key_type: key_type.to_string(),
        },
    }
}

fn known_hosts_path() -> Option<std::path::PathBuf> {
    dirs::data_local_dir().map(|d| d.join("gwshell").join("known_hosts.json"))
}

pub fn load() -> HashMap<String, KnownHostEntry> {
    known_hosts_path()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save(hosts: &HashMap<String, KnownHostEntry>) {
    if let Some(path) = known_hosts_path() {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(hosts) {
            let _ = fs::write(path, json);
        }
    }
}

pub fn trust_host(host: &str, port: u16, fingerprint: &str, key_type: &str) {
    let mut hosts = load();
    hosts.insert(
        format!("{}:{}", host, port),
        KnownHostEntry {
            fingerprint: fingerprint.to_string(),
            key_type: key_type.to_string(),
        },
    );
    save(&hosts);
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD_NO_PAD as BASE64, Engine};

    fn store() -> HashMap<String, KnownHostEntry> {
        let mut m = HashMap::new();
        m.insert(
            "h:22".to_string(),
            KnownHostEntry {
                fingerprint: "SHA256:AAA".into(),
                key_type: "Ed25519".into(),
            },
        );
        m
    }

    /// Helper mirroring the `SHA256:<base64-no-pad>` form the russh handler
    /// feeds into `verify` (ssh_key's `Fingerprint` Display uses unpadded
    /// base64). Kept test-local since nothing in the live path formats raw
    /// hashes — the handler hands `verify` an already-formatted string.
    fn sha256_fp(hash: &[u8]) -> String {
        format!("SHA256:{}", BASE64.encode(hash))
    }

    #[test]
    fn sha256_fp_prefixes_sha256() {
        assert_eq!(sha256_fp(&[0, 0, 0]), "SHA256:AAAA");
    }

    #[test]
    fn verify_trusted_when_match() {
        assert_eq!(
            verify(&store(), "h", 22, "SHA256:AAA", "Ed25519"),
            HostKeyVerdict::Trusted
        );
    }

    #[test]
    fn verify_mismatch_when_changed() {
        assert!(matches!(
            verify(&store(), "h", 22, "SHA256:BBB", "Ed25519"),
            HostKeyVerdict::Mismatch { .. }
        ));
    }

    #[test]
    fn verify_unknown_when_absent() {
        assert!(matches!(
            verify(&store(), "other", 22, "SHA256:CCC", "RSA"),
            HostKeyVerdict::Unknown { .. }
        ));
    }

    /// A 32-byte SHA-256 hash differs between PADDED (legacy `ssh.rs` / old
    /// store) and UNPADDED (russh handler) base64 only by a trailing `=`.
    /// The handler presents the unpadded form, and `verify` normalizes away
    /// padding, so a host trusted under the legacy padded encoding still
    /// verifies as Trusted against the handler's unpadded fingerprint (and
    /// vice versa). This guards the Task 12 cutover.
    #[test]
    fn verify_normalizes_padding_across_encodings() {
        let hash = [0u8; 32];
        // What the russh handler / ssh_key Display produces (unpadded).
        let unpadded = sha256_fp(&hash);
        assert!(!unpadded.ends_with('='), "handler fingerprint must be unpadded");
        // What the legacy ssh.rs STANDARD encoder wrote to the shared store.
        let padded = format!(
            "SHA256:{}",
            base64::engine::general_purpose::STANDARD.encode(hash)
        );
        assert!(padded.ends_with('='), "legacy fixture should be padded");

        // Store holds the legacy PADDED entry; handler presents UNPADDED.
        let mut store = HashMap::new();
        store.insert(
            "h:22".to_string(),
            KnownHostEntry { fingerprint: padded.clone(), key_type: "Ed25519".into() },
        );
        assert_eq!(verify(&store, "h", 22, &unpadded, "Ed25519"), HostKeyVerdict::Trusted);

        // And the reverse: store holds UNPADDED, handler presents PADDED.
        let mut store2 = HashMap::new();
        store2.insert(
            "h:22".to_string(),
            KnownHostEntry { fingerprint: unpadded, key_type: "Ed25519".into() },
        );
        assert_eq!(verify(&store2, "h", 22, &padded, "Ed25519"), HostKeyVerdict::Trusted);
    }
}
