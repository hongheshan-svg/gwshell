use super::types::AiProviderSettings;
use crate::{crypto, database::Database};

const SETTINGS_KEY: &str = "agent_ai_provider_settings";
const SECRET_KEY: &str = "agent_ai_provider_api_key";

pub fn load_settings(db: &Database) -> Result<AiProviderSettings, String> {
    let mut settings = match db.load_app_setting_key(SETTINGS_KEY)? {
        Some(raw) => serde_json::from_str::<AiProviderSettings>(&raw).unwrap_or_default(),
        None => AiProviderSettings::default(),
    };
    settings.api_key_configured = load_api_key(db)?.is_some();
    Ok(settings)
}

pub fn save_settings(db: &Database, mut settings: AiProviderSettings) -> Result<(), String> {
    settings.api_key_configured = load_api_key(db)?.is_some();
    let raw = serde_json::to_string(&settings).map_err(|e| e.to_string())?;
    db.save_app_setting_key(SETTINGS_KEY, &raw)
}

pub fn set_api_key(db: &Database, api_key: &str) -> Result<(), String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return clear_api_key(db);
    }

    let encrypted = encrypt_api_key(api_key);
    db.save_app_setting_key(SECRET_KEY, &encrypted)
}

pub fn clear_api_key(db: &Database) -> Result<(), String> {
    db.delete_app_setting_key(SECRET_KEY)
}

pub fn load_api_key(db: &Database) -> Result<Option<String>, String> {
    let Some(stored) = db.load_app_setting_key(SECRET_KEY)? else {
        return Ok(None);
    };
    let decrypted = crypto::decrypt_secret(&stored);
    if decrypted.trim().is_empty() {
        Ok(None)
    } else {
        Ok(Some(decrypted))
    }
}

#[cfg(not(test))]
fn encrypt_api_key(api_key: &str) -> String {
    crypto::encrypt_secret(api_key)
}

#[cfg(test)]
fn encrypt_api_key(api_key: &str) -> String {
    // Unit tests cover provider persistence without invoking platform keyring UI.
    api_key.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
