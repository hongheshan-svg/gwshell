use crate::state::AppState;
use crate::vault;
use std::sync::Arc;
use tauri::State;

/// Enable the vault (stores a fresh Argon2id verifier). Fails if the vault is
/// already enabled — changing the passphrase requires `vault_change_passphrase`.
#[tauri::command]
pub async fn vault_set_passphrase(
    passphrase: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || vault::enable(&state.db, &passphrase))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

/// Verify a passphrase against the stored verifier. `false` when not enabled.
#[tauri::command]
pub async fn vault_verify(
    passphrase: String,
    state: State<'_, Arc<AppState>>,
) -> Result<bool, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || vault::verify(&state.db, &passphrase))
        .await
        .map_err(|e| format!("task join: {}", e))
}

/// Disable the vault. Verifies `current_passphrase` first; only clears the
/// verifier if it matches. Returns whether the vault was cleared.
#[tauri::command]
pub async fn vault_clear(
    current_passphrase: String,
    state: State<'_, Arc<AppState>>,
) -> Result<bool, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || -> Result<bool, String> {
        if !vault::verify(&state.db, &current_passphrase) {
            return Ok(false);
        }
        vault::clear(&state.db)?;
        Ok(true)
    })
    .await
    .map_err(|e| format!("task join: {}", e))?
}

/// Whether the vault is currently enabled (a verifier is present).
#[tauri::command]
pub async fn vault_is_enabled(state: State<'_, Arc<AppState>>) -> Result<bool, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || vault::is_enabled(&state.db))
        .await
        .map_err(|e| format!("task join: {}", e))
}

/// Atomically verify `current_passphrase` and, if it matches, store a fresh
/// Argon2id hash of `new_passphrase`. Returns `false` (no error) when the
/// current passphrase is wrong — eliminates the verify→set TOCTOU race that
/// the two-call approach exposes.
#[tauri::command]
pub async fn vault_change_passphrase(
    current_passphrase: String,
    new_passphrase: String,
    state: State<'_, Arc<AppState>>,
) -> Result<bool, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        vault::change_passphrase(&state.db, &current_passphrase, &new_passphrase)
    })
    .await
    .map_err(|e| format!("task join: {}", e))
}
