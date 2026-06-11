// Secret-at-rest encryption.
//
// SSH/proxy/jump passwords and TOTP secrets used to be stored as plaintext in
// the SQLite database. Here we encrypt them with AES-256-GCM using a random
// 32-byte master key that lives in the OS credential store (Windows Credential
// Manager / macOS Keychain / Linux Secret Service), so the database file alone
// no longer reveals any credentials.
//
// Design notes:
//  - Encrypted values are tagged with the `enc:v1:` prefix; values without it
//    are treated as legacy plaintext and returned as-is on read (so existing
//    databases keep working and are upgraded transparently on the next save).
//  - If the OS keyring is unavailable, we degrade to plaintext (same behavior as
//    before) rather than losing data or crashing.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use std::sync::OnceLock;

use crate::session::SessionConfig;

const ENC_PREFIX: &str = "enc:v1:";
const KEYRING_SERVICE: &str = "gwshell";
const KEYRING_USER: &str = "db-master-key";
const NONCE_LEN: usize = 12;

/// Fill `N` bytes with cryptographically secure randomness.
fn random_bytes<const N: usize>() -> Option<[u8; N]> {
    let mut b = [0u8; N];
    getrandom::getrandom(&mut b).ok()?;
    Some(b)
}

/// The process-wide master key, loaded from (or created in) the OS keyring once.
/// `None` means no keyring backend is available — callers then fall back to
/// plaintext so nothing breaks and no data is lost.
fn master_key() -> Option<[u8; 32]> {
    static KEY: OnceLock<Option<[u8; 32]>> = OnceLock::new();
    *KEY.get_or_init(load_or_create_key)
}

/// Whether secrets can actually be encrypted at rest (i.e. an OS keyring backend
/// is available). When false, `encrypt_secret` degrades to plaintext storage —
/// the frontend queries this to warn the user that saved credentials are not
/// protected on this machine.
pub fn secret_storage_available() -> bool {
    master_key().is_some()
}

/// Log one prominent warning the first time a secret is persisted without
/// encryption, so the degradation is never completely silent.
fn warn_plaintext_once() {
    use std::sync::atomic::{AtomicBool, Ordering};
    static WARNED: AtomicBool = AtomicBool::new(false);
    if !WARNED.swap(true, Ordering::Relaxed) {
        eprintln!(
            "[gwshell] WARNING: no OS keyring backend available — SSH/proxy \
             passwords and TOTP secrets are being stored UNENCRYPTED in the \
             local database."
        );
    }
}

fn load_or_create_key() -> Option<[u8; 32]> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).ok()?;

    // Reuse an existing key if present and well-formed.
    if let Ok(stored) = entry.get_password() {
        if let Ok(bytes) = BASE64.decode(stored.as_bytes()) {
            if bytes.len() == 32 {
                let mut k = [0u8; 32];
                k.copy_from_slice(&bytes);
                return Some(k);
            }
        }
    }

    // Otherwise generate and persist a fresh key.
    let key = random_bytes::<32>()?;
    entry.set_password(&BASE64.encode(key)).ok()?;
    Some(key)
}

/// Encrypt a secret for at-rest storage. Empty input stays empty; an
/// already-encrypted value is returned unchanged; if no keyring is available the
/// plaintext is returned as-is (never lose data).
pub fn encrypt_secret(plaintext: &str) -> String {
    if plaintext.is_empty() || plaintext.starts_with(ENC_PREFIX) {
        return plaintext.to_string();
    }
    let Some(key) = master_key() else {
        warn_plaintext_once();
        return plaintext.to_string();
    };
    let Some(nonce_bytes) = random_bytes::<NONCE_LEN>() else {
        return plaintext.to_string();
    };
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let nonce = Nonce::from_slice(&nonce_bytes);
    match cipher.encrypt(nonce, plaintext.as_bytes()) {
        Ok(ciphertext) => {
            let mut blob = Vec::with_capacity(NONCE_LEN + ciphertext.len());
            blob.extend_from_slice(&nonce_bytes);
            blob.extend_from_slice(&ciphertext);
            format!("{}{}", ENC_PREFIX, BASE64.encode(blob))
        }
        Err(_) => plaintext.to_string(),
    }
}

/// Decrypt a stored secret. Legacy plaintext (no `enc:v1:` prefix) is returned
/// unchanged so existing databases keep working.
///
/// Once a value carries the `enc:v1:` prefix it was genuinely encrypted, so a
/// decode/decrypt failure (missing keyring, wrong/rotated key after a machine
/// migration or keychain reset) means we cannot recover the secret. In that
/// case we return an EMPTY string rather than the `enc:v1:<base64>` ciphertext:
/// the ciphertext would otherwise be handed to ssh as a literal password,
/// producing an opaque auth failure. Returning empty makes the credential read
/// as "missing" so the user re-enters it; the encrypted DB value is untouched
/// and recovers automatically once the correct key is available again.
pub fn decrypt_secret(stored: &str) -> String {
    let Some(rest) = stored.strip_prefix(ENC_PREFIX) else {
        return stored.to_string();
    };
    let Some(key) = master_key() else {
        return String::new();
    };
    let Ok(blob) = BASE64.decode(rest.as_bytes()) else {
        return String::new();
    };
    if blob.len() <= NONCE_LEN {
        return String::new();
    }
    let (nonce_bytes, ciphertext) = blob.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let nonce = Nonce::from_slice(nonce_bytes);
    match cipher.decrypt(nonce, ciphertext) {
        Ok(plaintext) => String::from_utf8_lossy(&plaintext).to_string(),
        Err(_) => String::new(),
    }
}

fn enc_field(field: &mut Option<String>) {
    if let Some(v) = field {
        *v = encrypt_secret(v);
    }
}

fn dec_field(field: &mut Option<String>) {
    if let Some(v) = field {
        *v = decrypt_secret(v);
    }
}

/// The secret-bearing fields of a session config.
fn for_each_secret(config: &mut SessionConfig, f: impl Fn(&mut Option<String>)) {
    f(&mut config.password);
    f(&mut config.jump_password);
    f(&mut config.proxy_password);
    f(&mut config.totp_code);
}

pub fn encrypt_session_secrets(config: &mut SessionConfig) {
    for_each_secret(config, enc_field);
}

pub fn decrypt_session_secrets(config: &mut SessionConfig) {
    for_each_secret(config, dec_field);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plaintext_passthrough_when_no_prefix() {
        // decrypt() must return legacy plaintext unchanged.
        assert_eq!(decrypt_secret("hunter2"), "hunter2");
    }

    #[test]
    fn empty_stays_empty() {
        assert_eq!(encrypt_secret(""), "");
    }

    #[test]
    fn roundtrip_when_keyring_available() {
        // Only meaningful where a keyring backend exists; otherwise both calls
        // are no-ops and the assertion still holds.
        let enc = encrypt_secret("s3cr3t");
        let dec = decrypt_secret(&enc);
        assert_eq!(dec, "s3cr3t");
    }

    #[test]
    fn corrupt_encrypted_value_decrypts_to_empty_not_ciphertext() {
        // A value that carries the enc:v1: prefix but cannot be decoded/decrypted
        // (corruption, missing/rotated key) must NEVER be returned verbatim — it
        // would otherwise be handed to ssh as a literal password. Holds whether
        // or not a keyring backend is present on the test machine.
        assert_eq!(decrypt_secret("enc:v1:not-valid-base64!!!"), "");
    }
}
