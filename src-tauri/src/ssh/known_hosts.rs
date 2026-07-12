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
    Unknown {
        fingerprint: String,
        key_type: String,
    },
    Mismatch {
        fingerprint: String,
        key_type: String,
    },
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

/// Reduce a host-key type label to a coarse algorithm family so labels written
/// by different SSH stacks compare equal. The legacy libssh2 `ssh.rs` stored
/// Debug-style names ("Ecdsa256", "Ed25519", "Rsa"); the russh handler stores
/// ssh-key's wire names ("ecdsa-sha2-nistp256", "ssh-ed25519", "ssh-rsa").
fn key_family(key_type: &str) -> &'static str {
    let k = key_type.to_ascii_lowercase();
    if k.contains("ed25519") {
        "ed25519"
    } else if k.contains("ecdsa") || k.contains("nistp") {
        "ecdsa"
    } else if k.contains("rsa") {
        "rsa"
    } else if k.contains("dss") || k.contains("dsa") {
        "dsa"
    } else {
        "other"
    }
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
        // Same algorithm family but a different key: the strong tamper signal.
        // Raise the red mismatch warning so the user must intervene.
        Some(e) if key_family(&e.key_type) == key_family(key_type) => HostKeyVerdict::Mismatch {
            fingerprint: fingerprint.to_string(),
            key_type: key_type.to_string(),
        },
        // Different algorithm family: the server simply offered another host-key
        // type (e.g. the old libssh2 backend negotiated ECDSA, russh negotiates
        // Ed25519). This is NOT evidence of MITM — OpenSSH treats an unseen key
        // type as new rather than "identification changed" — so prompt to accept
        // like a first connection instead of the dead-end mismatch warning.
        Some(_) => HostKeyVerdict::Unknown {
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
            let _ = fs::write(&path, json);
            // The trust store decides which servers we'll talk to — keep it
            // out of reach of other local users.
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
            }
        }
    }
}

/// Record `fingerprint` as trusted for `host:port`.
///
/// Refuses to replace an existing entry of the same key family with a
/// different fingerprint: that is exactly the MITM signal `verify` reports as
/// `Mismatch`, and the UI deliberately offers no "trust anyway" path for it
/// (the user must delete the stale entry by hand). Enforcing it here too means
/// a compromised WebView cannot silently re-pin a hostile key through the
/// `ssh_trust_host` IPC command. First-time hosts and cross-family additions
/// (verdict `Unknown`) are recorded as before.
pub fn trust_host(host: &str, port: u16, fingerprint: &str, key_type: &str) -> Result<(), String> {
    let mut hosts = load();
    let key = format!("{}:{}", host, port);
    check_overwrite(&hosts, &key, fingerprint, key_type)?;
    hosts.insert(
        key,
        KnownHostEntry {
            fingerprint: fingerprint.to_string(),
            key_type: key_type.to_string(),
        },
    );
    save(&hosts);
    Ok(())
}

/// The pure overwrite guard behind `trust_host` (split out for unit tests).
fn check_overwrite(
    hosts: &HashMap<String, KnownHostEntry>,
    key: &str,
    fingerprint: &str,
    key_type: &str,
) -> Result<(), String> {
    if let Some(existing) = hosts.get(key) {
        let same_family = key_family(&existing.key_type) == key_family(key_type);
        let same_fp =
            normalize_fingerprint(&existing.fingerprint) == normalize_fingerprint(fingerprint);
        if same_family && !same_fp {
            return Err(format!(
                "Refusing to overwrite the pinned {} key for {} with a different \
                 fingerprint. If the server was genuinely reinstalled, remove the \
                 entry from known_hosts.json and reconnect.",
                key_family(&existing.key_type),
                key
            ));
        }
    }
    Ok(())
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

    #[test]
    fn overwrite_guard_blocks_same_family_repin() {
        // Re-pinning a DIFFERENT fingerprint of the SAME family is the MITM
        // signal — must be refused even when asked directly (IPC hardening).
        assert!(check_overwrite(&store(), "h:22", "SHA256:EVIL", "ssh-ed25519").is_err());
    }

    #[test]
    fn overwrite_guard_allows_first_pin_repin_and_cross_family() {
        // First-time host.
        assert!(check_overwrite(&store(), "new:22", "SHA256:X", "ssh-rsa").is_ok());
        // Idempotent re-pin of the identical fingerprint (padding-insensitive).
        assert!(check_overwrite(&store(), "h:22", "SHA256:AAA=", "ssh-ed25519").is_ok());
        // Different key family = the Unknown verdict path, allowed after prompt.
        assert!(check_overwrite(&store(), "h:22", "SHA256:Y", "ecdsa-sha2-nistp256").is_ok());
    }

    #[test]
    fn verify_unknown_when_key_type_differs() {
        // libssh2 stored an ECDSA key; russh now presents an Ed25519 key for the
        // same host — a different algorithm, not tampering. Must prompt as
        // Unknown (acceptable in the UI), not the dead-end Mismatch warning.
        let mut store = HashMap::new();
        store.insert(
            "h:22".to_string(),
            KnownHostEntry {
                fingerprint: "SHA256:OLD".into(),
                key_type: "Ecdsa256".into(),
            },
        );
        assert!(matches!(
            verify(&store, "h", 22, "SHA256:NEW", "ssh-ed25519"),
            HostKeyVerdict::Unknown { .. }
        ));
    }

    #[test]
    fn verify_mismatch_when_same_family_key_changes() {
        // Same algorithm family (ECDSA, even across libssh2 "Ecdsa256" vs russh
        // "ecdsa-sha2-nistp256" naming) but a different fingerprint = a real key
        // change → the MITM warning must still fire.
        let mut store = HashMap::new();
        store.insert(
            "h:22".to_string(),
            KnownHostEntry {
                fingerprint: "SHA256:OLD".into(),
                key_type: "Ecdsa256".into(),
            },
        );
        assert!(matches!(
            verify(&store, "h", 22, "SHA256:NEW", "ecdsa-sha2-nistp256"),
            HostKeyVerdict::Mismatch { .. }
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
        assert!(
            !unpadded.ends_with('='),
            "handler fingerprint must be unpadded"
        );
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
            KnownHostEntry {
                fingerprint: padded.clone(),
                key_type: "Ed25519".into(),
            },
        );
        assert_eq!(
            verify(&store, "h", 22, &unpadded, "Ed25519"),
            HostKeyVerdict::Trusted
        );

        // And the reverse: store holds UNPADDED, handler presents PADDED.
        let mut store2 = HashMap::new();
        store2.insert(
            "h:22".to_string(),
            KnownHostEntry {
                fingerprint: unpadded,
                key_type: "Ed25519".into(),
            },
        );
        assert_eq!(
            verify(&store2, "h", 22, &padded, "Ed25519"),
            HostKeyVerdict::Trusted
        );
    }
}
