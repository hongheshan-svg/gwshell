use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
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

/// Format a raw SHA-256 host-key hash as the `SHA256:<base64>` string the UI shows.
pub fn format_fingerprint(sha256: &[u8]) -> String {
    format!("SHA256:{}", BASE64.encode(sha256))
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
        Some(e) if e.fingerprint == fingerprint => HostKeyVerdict::Trusted,
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

    #[test]
    fn format_fingerprint_prefixes_sha256() {
        assert_eq!(format_fingerprint(&[0, 0, 0]), "SHA256:AAAA");
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
}
