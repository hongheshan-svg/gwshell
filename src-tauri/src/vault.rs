// Master-passphrase vault — an app-access gate, NOT key isolation.
//
// This is a defensive UI lock layer: when enabled, the frontend renders a
// full-screen unlock overlay until the user enters the correct passphrase.
//
// SECURITY MODEL (important — do not "improve" this into key isolation):
//  - We store ONLY an Argon2id hash (PHC string) of the passphrase. Never the
//    plaintext, never in logs/errors.
//  - The vault does NOT encrypt any secrets. SSH/proxy/jump passwords and TOTP
//    secrets remain encrypted at rest by the OS-keyring master key in
//    `crypto.rs` (untouched here). Therefore FORGETTING the passphrase NEVER
//    loses credentials — the user can reset the vault (clear the verifier) and
//    the keyring-encrypted secrets are still recoverable.
//  - Verification uses Argon2's constant-time `verify_password`.

use crate::database::Database;
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};

/// Hash `passphrase` with Argon2id (default params) and store the resulting PHC
/// string as the vault verifier. Overwrites any existing verifier.
pub fn set_passphrase(db: &Database, passphrase: &str) -> Result<(), String> {
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(passphrase.as_bytes(), &salt)
        // Don't leak the passphrase via the error path.
        .map_err(|_| "failed to hash passphrase".to_string())?
        .to_string();
    db.set_vault_verifier(&hash)
}

/// Verify `passphrase` against the stored verifier. Returns `false` if no
/// verifier is set, the stored PHC string is malformed, or the passphrase does
/// not match. Returns `true` only on a successful constant-time match.
pub fn verify(db: &Database, passphrase: &str) -> bool {
    let Some(phc) = db.get_vault_verifier() else {
        return false;
    };
    let Ok(parsed) = PasswordHash::new(&phc) else {
        return false;
    };
    Argon2::default()
        .verify_password(passphrase.as_bytes(), &parsed)
        .is_ok()
}

/// Remove the vault verifier, disabling the lock. Credentials are unaffected.
pub fn clear(db: &Database) -> Result<(), String> {
    db.clear_vault_verifier()
}

/// Whether the vault is enabled (a verifier is present).
pub fn is_enabled(db: &Database) -> bool {
    db.get_vault_verifier().is_some()
}
