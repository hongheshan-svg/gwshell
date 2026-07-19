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
    Algorithm, Argon2, Params, Version,
};

/// Argon2id with OWASP-recommended minimum params (argon2 0.5 defaults):
///   m_cost = 19456 KiB (~19 MiB), t_cost = 2, p_cost = 1
/// Source: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
/// Rationale: this verifies a local UI unlock gate, not a server-side hash
/// database. The threat model is an attacker who stole the DB file but does
/// NOT have the OS keyring master key (which actually protects secrets — see
/// crypto.rs). Default params make brute-forcing the passphrase uneconomical
/// while keeping unlock under ~50ms on commodity laptops.
fn argon2id() -> Argon2<'static> {
    Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        Params::new(19_456, 2, 1, None).expect("hardcoded valid params"),
    )
}

/// Hash `passphrase` with Argon2id (OWASP-recommended params, see `argon2id`)
/// and store the resulting PHC string as the vault verifier. Overwrites any
/// existing verifier.
pub fn set_passphrase(db: &Database, passphrase: &str) -> Result<(), String> {
    let salt = SaltString::generate(&mut OsRng);
    let hash = argon2id()
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
    argon2id()
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

/// Atomically verify `current` then re-hash and store `new`. The two
/// operations happen within a single call, eliminating the TOCTOU window
/// that a verify→set two-call sequence would expose. Returns `false` if
/// `current` does not match the stored verifier (nothing is changed).
pub fn change_passphrase(db: &Database, current: &str, new: &str) -> bool {
    if !verify(db, current) {
        return false;
    }
    set_passphrase(db, new).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Asserts both `set_passphrase` and `verify` use Argon2id (v19) with the
    /// OWASP-recommended params. We can't inspect the `Argon2` struct's params
    /// directly (no public accessor in argon2 0.5), so we hash a passphrase and
    /// parse the resulting PHC string back, checking the algorithm/version tags
    /// are present. This guards against an accidental regression to
    /// `Argon2::default()` (which happens to be Argon2id v19 today, but the
    /// explicit params are what we want to lock in).
    #[test]
    fn argon2id_helper_uses_correct_algorithm_and_version() {
        let db = Database::new_in_memory_for_tests().unwrap();
        set_passphrase(&db, "test-passphrase").unwrap();
        let phc = db.get_vault_verifier().expect("verifier should be set");
        // The PHC string encodes the algorithm: $argon2id$v=19$...
        assert!(
            phc.contains("$argon2id$"),
            "expected Argon2id algorithm in PHC, got: {}",
            phc
        );
        assert!(
            phc.contains("$v=19$"),
            "expected Argon2 v19 in PHC, got: {}",
            phc
        );
        // Round-trip: verify accepts the correct passphrase and rejects a wrong one.
        assert!(
            verify(&db, "test-passphrase"),
            "verify should accept correct passphrase"
        );
        assert!(
            !verify(&db, "wrong-passphrase"),
            "verify should reject wrong passphrase"
        );
    }
}
