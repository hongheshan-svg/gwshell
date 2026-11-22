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
//  - If the OS keyring is unavailable (or encryption fails), we REFUSE to
//    persist the secret: it is stored as an empty string so only session
//    metadata reaches disk. The frontend queries `secret_storage_available`
//    and warns the user that passwords will not be saved on this machine.
//    Plaintext credentials must never be written to the database.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use parking_lot::Mutex;

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

/// The process-wide master key, loaded from (or created in) the OS keyring.
/// Cached once retrieved; if an earlier read failed (e.g. locked keychain),
/// subsequent calls retry so unlocking the OS keychain recovers automatically.
fn master_key() -> Option<[u8; 32]> {
    static KEY: Mutex<Option<[u8; 32]>> = Mutex::new(None);
    let mut guard = KEY.lock();
    if let Some(key) = *guard {
        return Some(key);
    }
    let loaded = load_or_create_key();
    if let Some(key) = loaded {
        *guard = Some(key);
    }
    loaded
}

/// Whether `value` already carries the `enc:v1:` ciphertext tag.
pub fn is_encrypted(value: &str) -> bool {
    value.starts_with(ENC_PREFIX)
}

/// Whether secrets can actually be encrypted at rest (i.e. an OS keyring backend
/// is available). When false, `encrypt_secret` refuses to persist secrets —
/// the frontend queries this to warn the user that passwords/TOTP secrets will
/// not be saved on this machine.
pub fn secret_storage_available() -> bool {
    master_key().is_some()
}

/// Log one prominent warning the first time a secret is dropped instead of
/// persisted, so the degradation is never completely silent.
fn warn_secret_dropped_once() {
    use std::sync::atomic::{AtomicBool, Ordering};
    static WARNED: AtomicBool = AtomicBool::new(false);
    if !WARNED.swap(true, Ordering::Relaxed) {
        eprintln!(
            "[gwshell] WARNING: no OS keyring backend available (or encryption \
             failed) — SSH/proxy passwords and TOTP secrets will NOT be saved. \
             Only session metadata is persisted; re-enter credentials on connect."
        );
    }
}

/// What reading the keyring entry produced, decided without side effects so
/// the "create a new key" decision is unit-testable.
#[derive(Debug, PartialEq)]
enum StoredKey {
    /// A well-formed 32-byte key.
    Valid([u8; 32]),
    /// No entry exists yet — the ONLY case in which a new key may be created.
    Missing,
    /// An entry exists but could not be read (access denied, keychain locked,
    /// backend error) or does not decode to 32 bytes. Overwriting it would
    /// permanently destroy every secret encrypted under the real key.
    Unusable,
}

fn classify_stored_key(read: Result<String, keyring::Error>) -> StoredKey {
    match read {
        Ok(stored) => match BASE64.decode(stored.trim().as_bytes()) {
            Ok(bytes) if bytes.len() == 32 => {
                let mut k = [0u8; 32];
                k.copy_from_slice(&bytes);
                StoredKey::Valid(k)
            }
            _ => StoredKey::Unusable,
        },
        Err(keyring::Error::NoEntry) => StoredKey::Missing,
        Err(_) => StoredKey::Unusable,
    }
}

fn load_or_create_key() -> Option<[u8; 32]> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).ok()?;

    match classify_stored_key(entry.get_password()) {
        StoredKey::Valid(key) => Some(key),
        StoredKey::Missing => {
            let key = random_bytes::<32>()?;
            entry.set_password(&BASE64.encode(key)).ok()?;
            Some(key)
        }
        StoredKey::Unusable => {
            // Degrade to "secrets not persisted" for this run instead of
            // replacing the key: a transient denial (user clicked "Deny" on
            // the keychain prompt, locked Secret Service collection) must not
            // turn into permanent loss of all saved credentials.
            eprintln!(
                "[gwshell] WARNING: the keyring master key exists but could not be read; \
                 leaving it untouched. Saved credentials are unavailable this session."
            );
            None
        }
    }
}

/// Encrypt a secret for at-rest storage. Empty input stays empty; an
/// already-encrypted value is returned unchanged. If no keyring is available or
/// encryption fails, returns an EMPTY string: the secret is dropped from
/// persistence rather than ever being written to disk in plaintext. The
/// in-memory copy the caller holds is unaffected, so the current connection
/// still works — the user just has to re-enter the credential next time.
pub fn encrypt_secret(plaintext: &str) -> String {
    if plaintext.is_empty() || plaintext.starts_with(ENC_PREFIX) {
        return plaintext.to_string();
    }
    let Some(key) = master_key() else {
        warn_secret_dropped_once();
        return String::new();
    };
    let Some(nonce_bytes) = random_bytes::<NONCE_LEN>() else {
        warn_secret_dropped_once();
        return String::new();
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
        Err(_) => {
            warn_secret_dropped_once();
            String::new()
        }
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
        let enc = encrypt_secret("s3cr3t");
        if secret_storage_available() {
            assert!(enc.starts_with(ENC_PREFIX), "must never store plaintext");
            assert_eq!(decrypt_secret(&enc), "s3cr3t");
        } else {
            // Degraded machines must DROP the secret, never persist plaintext.
            assert_eq!(enc, "");
        }
    }

    #[test]
    fn encrypt_never_returns_plaintext_for_nonempty_input() {
        // Regardless of keyring availability, the stored form of a non-empty
        // secret is either encrypted (enc:v1:) or empty — plaintext must never
        // be handed back for persistence.
        let enc = encrypt_secret("hunter2");
        assert!(enc.is_empty() || enc.starts_with(ENC_PREFIX));
    }

    #[test]
    fn only_a_missing_entry_allows_creating_a_new_key() {
        let key = [7u8; 32];
        assert_eq!(
            classify_stored_key(Ok(BASE64.encode(key))),
            StoredKey::Valid(key)
        );
        assert_eq!(
            classify_stored_key(Err(keyring::Error::NoEntry)),
            StoredKey::Missing
        );
        // Read failures and malformed entries must never trigger regeneration.
        assert_eq!(
            classify_stored_key(Err(keyring::Error::PlatformFailure("denied".into()))),
            StoredKey::Unusable
        );
        assert_eq!(
            classify_stored_key(Err(keyring::Error::NoStorageAccess("locked".into()))),
            StoredKey::Unusable
        );
        assert_eq!(
            classify_stored_key(Ok("not-a-key".into())),
            StoredKey::Unusable
        );
        assert_eq!(
            classify_stored_key(Ok(BASE64.encode([1u8; 16]))),
            StoredKey::Unusable
        );
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
