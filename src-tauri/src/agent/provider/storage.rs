use crate::agent::types::AiProviderSettings;
use crate::database::Database;

const SETTINGS_KEY: &str = "agent_ai_provider_settings";
const SECRET_KEY: &str = "agent_ai_provider_api_key";
const KEY_STORAGE_UNAVAILABLE: &str = "Could not save the API key: the system keychain is unavailable, so GWShell can't encrypt it. Unlock or allow keychain access for GWShell and save the key again.";
const KEY_UNREADABLE: &str = "The saved AI API key can't be decrypted (the system keychain is locked, access was denied, or its key changed). Enter the API key again in Settings > AI.";

pub fn load_settings(db: &Database) -> Result<AiProviderSettings, String> {
    let mut settings = match db.load_app_setting_key(SETTINGS_KEY)? {
        Some(raw) => serde_json::from_str::<AiProviderSettings>(&raw).unwrap_or_default(),
        None => AiProviderSettings::default(),
    };
    settings.api_key_configured = api_key_is_configured(db)?;
    Ok(settings)
}

pub fn save_settings(db: &Database, mut settings: AiProviderSettings) -> Result<(), String> {
    settings.api_key_configured = api_key_is_configured(db)?;
    let raw = serde_json::to_string(&settings).map_err(|e| e.to_string())?;
    db.save_app_setting_key(SETTINGS_KEY, &raw)
}

pub fn set_api_key(db: &Database, api_key: &str) -> Result<(), String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return clear_api_key(db);
    }

    let encrypted = encrypt_api_key(api_key);
    if encrypted.trim().is_empty() {
        // encrypt_secret drops secrets it cannot encrypt rather than storing
        // plaintext. Saving "" here used to look like success while the key
        // silently vanished, so every AI request then failed with "not configured".
        return Err(KEY_STORAGE_UNAVAILABLE.into());
    }
    db.save_app_setting_key(SECRET_KEY, &encrypted)
}

pub fn clear_api_key(db: &Database) -> Result<(), String> {
    db.delete_app_setting_key(SECRET_KEY)
}

fn api_key_is_configured(db: &Database) -> Result<bool, String> {
    Ok(db
        .load_app_setting_key(SECRET_KEY)?
        .is_some_and(|stored| !stored.trim().is_empty()))
}

pub fn load_api_key(db: &Database) -> Result<Option<String>, String> {
    let Some(stored) = db.load_app_setting_key(SECRET_KEY)? else {
        return Ok(None);
    };
    if stored.trim().is_empty() {
        return Ok(None);
    }
    let decrypted = decrypt_api_key(&stored);
    if decrypted.trim().is_empty() {
        // A key is saved (the settings page says "configured") but can't be
        // decrypted: the keychain master key is unreadable or was replaced.
        return Err(KEY_UNREADABLE.into());
    }
    Ok(Some(decrypted.trim().to_string()))
}

#[cfg(not(test))]
fn decrypt_api_key(stored: &str) -> String {
    crate::crypto::decrypt_secret(stored)
}

#[cfg(test)]
fn decrypt_api_key(stored: &str) -> String {
    // Mirrors crypto::decrypt_secret when the keychain key is unusable: an
    // encrypted value comes back empty.
    if stored.starts_with("enc:v1:") {
        String::new()
    } else {
        stored.to_string()
    }
}

#[cfg(not(test))]
fn encrypt_api_key(api_key: &str) -> String {
    crate::crypto::encrypt_secret(api_key)
}

#[cfg(test)]
fn encrypt_api_key(api_key: &str) -> String {
    // Unit tests cover provider persistence without invoking platform keyring UI.
    api_key.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::provider::{provider_requires_api_key, validate_provider_settings};

    const TEST_API_KEY: &str = "sk-test-provider-key";

    fn db() -> Database {
        Database::new_in_memory_for_tests().unwrap()
    }

    #[test]
    fn serialized_settings_do_not_need_api_key_value() {
        let raw = serde_json::to_string(&AiProviderSettings::default()).unwrap();
        assert!(!raw.contains("sk-"));
        assert!(raw.contains("api_key_configured"));
    }

    #[test]
    fn load_settings_defaults_when_nothing_is_persisted() {
        let db = db();

        let settings = load_settings(&db).unwrap();

        assert_eq!(settings.enabled, AiProviderSettings::default().enabled);
        assert_eq!(settings.provider, AiProviderSettings::default().provider);
        assert_eq!(settings.base_url, AiProviderSettings::default().base_url);
        assert_eq!(settings.model, AiProviderSettings::default().model);
        assert!(!settings.api_key_configured);
    }

    #[test]
    fn set_api_key_roundtrips_and_marks_settings_configured() {
        let db = db();

        set_api_key(&db, TEST_API_KEY).unwrap();

        assert_eq!(load_api_key(&db).unwrap().as_deref(), Some(TEST_API_KEY));
        assert!(load_settings(&db).unwrap().api_key_configured);
    }

    #[test]
    fn load_settings_marks_key_configured_without_decrypting_key() {
        let db = db();
        db.save_app_setting_key(SECRET_KEY, "enc:v1:not-valid-base64")
            .unwrap();

        let settings = load_settings(&db).unwrap();

        assert!(settings.api_key_configured);
        let error = load_api_key(&db).unwrap_err();
        assert!(error.contains("can't be decrypted"), "{error}");
    }

    #[test]
    fn save_settings_does_not_write_raw_api_key_to_settings_json() {
        let db = db();
        set_api_key(&db, TEST_API_KEY).unwrap();
        let settings = AiProviderSettings {
            enabled: true,
            model: "provider-model".to_string(),
            api_key_configured: false,
            ..AiProviderSettings::default()
        };

        save_settings(&db, settings).unwrap();

        let raw = db.load_app_setting_key(SETTINGS_KEY).unwrap().unwrap();
        assert!(!raw.contains(TEST_API_KEY));
        assert!(raw.contains("\"api_key_configured\":true"));
        let saved: AiProviderSettings = serde_json::from_str(&raw).unwrap();
        assert!(saved.api_key_configured);
        assert_eq!(saved.model, "provider-model");
    }

    #[test]
    fn clear_api_key_removes_key_and_marks_settings_unconfigured() {
        let db = db();
        set_api_key(&db, TEST_API_KEY).unwrap();

        clear_api_key(&db).unwrap();

        assert_eq!(load_api_key(&db).unwrap(), None);
        assert!(!load_settings(&db).unwrap().api_key_configured);
    }

    #[test]
    fn save_settings_recomputes_stale_configured_flag_from_stored_key_state() {
        let db = db();
        let settings = AiProviderSettings {
            api_key_configured: true,
            ..AiProviderSettings::default()
        };

        save_settings(&db, settings).unwrap();

        let raw = db.load_app_setting_key(SETTINGS_KEY).unwrap().unwrap();
        let saved: AiProviderSettings = serde_json::from_str(&raw).unwrap();
        assert!(!saved.api_key_configured);
        assert!(!load_settings(&db).unwrap().api_key_configured);
    }

    #[test]
    fn ollama_provider_is_supported_without_api_key() {
        let settings = AiProviderSettings {
            provider: "ollama".into(),
            base_url: "http://localhost:11434/v1".into(),
            model: "llama3.1".into(),
            ..AiProviderSettings::default()
        };

        assert!(validate_provider_settings(&settings).is_ok());
        assert!(!provider_requires_api_key(&settings));
    }

    #[test]
    fn anthropic_compatible_provider_is_supported_and_requires_api_key() {
        let settings = AiProviderSettings {
            provider: "anthropic_compatible".into(),
            base_url: "https://api.anthropic.com/v1".into(),
            model: "claude-sonnet-4-5".into(),
            ..AiProviderSettings::default()
        };

        assert!(validate_provider_settings(&settings).is_ok());
        assert!(provider_requires_api_key(&settings));
    }
}
