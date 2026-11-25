// "Full backup" asset export: sessions WITH their secrets (passwords, TOTP,
// jump/proxy passwords) and the contents of referenced private-key files, so a
// restore on another machine connects without any re-entry.
//
// The payload is AES-256-GCM sealed with a key built into the app. That key
// ships in the public source, so this only keeps secrets from being readable
// at a glance / greppable — anyone holding the file can recover every secret.
// The UI labels the file accordingly; the regular JSON/CSV exports stay
// secret-free.

use crate::session::SessionConfig;
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const FORMAT: &str = "gwshell-full-backup";
const VERSION: u32 = 1;
const NONCE_LEN: usize = 12;
/// Private keys are small; anything bigger is not a key file and is skipped.
const MAX_KEY_FILE_BYTES: u64 = 64 * 1024;

#[derive(serde::Serialize, serde::Deserialize)]
struct Envelope {
    format: String,
    version: u32,
    payload: String,
}

#[derive(serde::Serialize, serde::Deserialize, Default)]
pub struct Payload {
    pub sessions: Vec<SessionConfig>,
    /// Private-key file contents, keyed by the path string as stored in the
    /// session (`private_key_path` / `jump_private_key_path`).
    #[serde(default)]
    pub keys: BTreeMap<String, String>,
}

fn cipher() -> Aes256Gcm {
    let digest = ring::digest::digest(&ring::digest::SHA256, b"gwshell-full-backup-v1");
    Aes256Gcm::new_from_slice(digest.as_ref()).expect("SHA-256 output is 32 bytes")
}

fn seal(plaintext: &[u8]) -> Result<String, String> {
    let mut nonce = [0u8; NONCE_LEN];
    getrandom::getrandom(&mut nonce).map_err(|e| format!("random nonce: {}", e))?;
    let ct = cipher()
        .encrypt(Nonce::from_slice(&nonce), plaintext)
        .map_err(|_| "backup encryption failed".to_string())?;
    let mut out = nonce.to_vec();
    out.extend_from_slice(&ct);
    Ok(BASE64.encode(out))
}

fn open(sealed: &str) -> Result<Vec<u8>, String> {
    let raw = BASE64
        .decode(sealed.trim())
        .map_err(|_| "Backup file is corrupted (bad encoding)".to_string())?;
    if raw.len() <= NONCE_LEN {
        return Err("Backup file is corrupted (too short)".to_string());
    }
    let (nonce, ct) = raw.split_at(NONCE_LEN);
    cipher()
        .decrypt(Nonce::from_slice(nonce), ct)
        .map_err(|_| "Backup file is corrupted or was modified".to_string())
}

/// Read a key file referenced by a session, if it is a plausible key file.
pub fn read_key_file(stored_path: &str) -> Option<String> {
    let path = crate::ssh_config::expand_tilde(stored_path);
    let meta = std::fs::metadata(&path).ok()?;
    if !meta.is_file() || meta.len() > MAX_KEY_FILE_BYTES {
        return None;
    }
    std::fs::read_to_string(&path).ok()
}

fn key_paths(s: &SessionConfig) -> impl Iterator<Item = &str> {
    [
        s.private_key_path.as_deref(),
        s.jump_private_key_path.as_deref(),
    ]
    .into_iter()
    .flatten()
    .map(str::trim)
    .filter(|p| !p.is_empty())
}

/// Build the sealed backup file. `read_key` resolves a stored key path to the
/// file's contents (injected for tests).
pub fn build(
    sessions: &[SessionConfig],
    read_key: impl Fn(&str) -> Option<String>,
) -> Result<String, String> {
    let mut keys = BTreeMap::new();
    for s in sessions {
        for p in key_paths(s) {
            if !keys.contains_key(p) {
                if let Some(content) = read_key(p) {
                    keys.insert(p.to_string(), content);
                }
            }
        }
    }
    let payload = Payload {
        sessions: sessions.to_vec(),
        keys,
    };
    let plaintext = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    let envelope = Envelope {
        format: FORMAT.to_string(),
        version: VERSION,
        payload: seal(&plaintext)?,
    };
    serde_json::to_string_pretty(&envelope).map_err(|e| e.to_string())
}

/// `Ok(None)` when `raw` is not a full backup (caller falls back to the plain
/// JSON/CSV importers).
pub fn parse(raw: &str) -> Result<Option<Payload>, String> {
    let content = raw.strip_prefix('\u{FEFF}').unwrap_or(raw).trim();
    if !content.starts_with('{') || !content.contains(FORMAT) {
        return Ok(None);
    }
    let Ok(envelope) = serde_json::from_str::<Envelope>(content) else {
        return Ok(None);
    };
    if envelope.format != FORMAT {
        return Ok(None);
    }
    if envelope.version > VERSION {
        return Err(format!(
            "Backup version {} is newer than this GWShell supports; please update GWShell",
            envelope.version
        ));
    }
    let plaintext = open(&envelope.payload)?;
    let mut payload: Payload = serde_json::from_slice(&plaintext)
        .map_err(|e| format!("Backup contents are unreadable: {}", e))?;
    for s in &mut payload.sessions {
        if s.id.trim().is_empty() {
            s.id = uuid::Uuid::new_v4().to_string();
        }
    }
    Ok(Some(payload))
}

fn write_private_file(path: &Path, content: &str) -> Result<(), String> {
    use std::io::Write;
    let mut opts = std::fs::OpenOptions::new();
    opts.create(true).write(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts
        .open(path)
        .map_err(|e| format!("{}: {}", path.display(), e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = f.set_permissions(std::fs::Permissions::from_mode(0o600));
    }
    f.write_all(content.as_bytes())
        .map_err(|e| format!("{}: {}", path.display(), e))
}

/// Make every bundled private key usable on this machine. A key whose original
/// path already holds the same content is left alone; otherwise the key is
/// written (owner-only) under `keys_dir` and the session is repointed there.
/// Existing files are never overwritten.
pub fn restore_key_files(
    sessions: &mut [SessionConfig],
    keys: &BTreeMap<String, String>,
    keys_dir: &Path,
    expand: impl Fn(&str) -> PathBuf,
) -> Result<(), String> {
    let mut resolved: BTreeMap<String, String> = BTreeMap::new();
    for (stored, content) in keys {
        let original = expand(stored);
        let same = std::fs::read_to_string(&original).is_ok_and(|c| c == *content);
        let target = if same {
            stored.clone()
        } else {
            std::fs::create_dir_all(keys_dir)
                .map_err(|e| format!("{}: {}", keys_dir.display(), e))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(keys_dir, std::fs::Permissions::from_mode(0o700));
            }
            // Content-addressed name: identical keys share one file, and a
            // re-import of the same backup reuses it instead of piling up.
            let digest = ring::digest::digest(&ring::digest::SHA256, content.as_bytes());
            let hex: String = digest.as_ref()[..8]
                .iter()
                .map(|b| format!("{:02x}", b))
                .collect();
            let base = original
                .file_name()
                .and_then(|n| n.to_str())
                .filter(|n| !n.is_empty())
                .unwrap_or("key");
            let path = keys_dir.join(format!("{}-{}", base, hex));
            let existing = std::fs::read_to_string(&path).ok();
            if existing.as_deref() != Some(content.as_str()) {
                if existing.is_some() {
                    return Err(format!(
                        "{} already exists with different contents",
                        path.display()
                    ));
                }
                write_private_file(&path, content)?;
            }
            path.to_string_lossy().into_owned()
        };
        resolved.insert(stored.clone(), target);
    }

    for s in sessions {
        for field in [&mut s.private_key_path, &mut s.jump_private_key_path] {
            if let Some(p) = field.as_ref() {
                if let Some(target) = resolved.get(p.trim()) {
                    *field = Some(target.clone());
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::AuthMethod;

    fn session() -> SessionConfig {
        SessionConfig {
            id: "s-1".into(),
            name: "prod".into(),
            host: Some("10.0.0.1".into()),
            auth_method: AuthMethod::PublicKey,
            password: Some("key-passphrase".into()),
            totp_code: Some("JBSWY3DPEHPK3PXP".into()),
            jump_password: Some("jump-secret".into()),
            proxy_password: Some("proxy-secret".into()),
            private_key_path: Some("~/.ssh/id_test".into()),
            jump_private_key_path: Some("~/.ssh/id_test".into()),
            ..Default::default()
        }
    }

    const KEY: &str =
        "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----\n";

    #[test]
    fn roundtrip_keeps_secrets_and_keys_but_file_is_not_plaintext() {
        let out = build(&[session()], |p| {
            (p == "~/.ssh/id_test").then(|| KEY.into())
        })
        .unwrap();
        for secret in [
            "key-passphrase",
            "JBSWY3DPEHPK3PXP",
            "jump-secret",
            "proxy-secret",
            "OPENSSH",
        ] {
            assert!(!out.contains(secret), "{} leaked in plaintext", secret);
        }

        let payload = parse(&out).unwrap().expect("recognized as full backup");
        let s = &payload.sessions[0];
        assert_eq!(s.password.as_deref(), Some("key-passphrase"));
        assert_eq!(s.totp_code.as_deref(), Some("JBSWY3DPEHPK3PXP"));
        assert_eq!(s.jump_password.as_deref(), Some("jump-secret"));
        assert_eq!(s.proxy_password.as_deref(), Some("proxy-secret"));
        assert_eq!(payload.keys.len(), 1, "shared key path bundled once");
        assert_eq!(payload.keys["~/.ssh/id_test"], KEY);
    }

    #[test]
    fn parse_ignores_other_json_and_rejects_tampering() {
        assert!(parse(r#"[{"id":"a","name":"x"}]"#).unwrap().is_none());
        assert!(parse(r#"{"sessions":[]}"#).unwrap().is_none());

        let out = build(&[session()], |_| None).unwrap();
        let mut env: Envelope = serde_json::from_str(&out).unwrap();
        let mut raw = BASE64.decode(&env.payload).unwrap();
        let last = raw.len() - 1;
        raw[last] ^= 1;
        env.payload = BASE64.encode(raw);
        let tampered = serde_json::to_string(&env).unwrap();
        assert!(parse(&tampered).is_err());
    }

    #[test]
    fn restore_writes_missing_keys_owner_only_and_repoints_sessions() {
        let dir = tempfile::tempdir().unwrap();
        let keys_dir = dir.path().join("keys");
        let mut sessions = vec![session()];
        let keys = BTreeMap::from([("~/.ssh/id_test".to_string(), KEY.to_string())]);
        let expand = |p: &str| dir.path().join(p.trim_start_matches("~/"));

        restore_key_files(&mut sessions, &keys, &keys_dir, expand).unwrap();
        let new_path = sessions[0].private_key_path.clone().unwrap();
        assert!(new_path.starts_with(keys_dir.to_str().unwrap()));
        assert_eq!(
            sessions[0].jump_private_key_path.as_deref(),
            Some(new_path.as_str())
        );
        assert_eq!(std::fs::read_to_string(&new_path).unwrap(), KEY);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&new_path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }

        // Re-import reuses the same file.
        let mut again = vec![session()];
        restore_key_files(&mut again, &keys, &keys_dir, expand).unwrap();
        assert_eq!(
            again[0].private_key_path.as_deref(),
            Some(new_path.as_str())
        );
    }

    #[test]
    fn restore_keeps_original_path_when_same_key_already_present() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".ssh")).unwrap();
        std::fs::write(dir.path().join(".ssh/id_test"), KEY).unwrap();
        let mut sessions = vec![session()];
        let keys = BTreeMap::from([("~/.ssh/id_test".to_string(), KEY.to_string())]);
        let expand = |p: &str| dir.path().join(p.trim_start_matches("~/"));

        restore_key_files(&mut sessions, &keys, &dir.path().join("keys"), expand).unwrap();
        assert_eq!(
            sessions[0].private_key_path.as_deref(),
            Some("~/.ssh/id_test")
        );
        assert!(!dir.path().join("keys").exists());
    }
}
