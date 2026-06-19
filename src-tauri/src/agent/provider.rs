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

    let encrypted = crypto::encrypt_secret(api_key);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialized_settings_do_not_need_api_key_value() {
        let raw = serde_json::to_string(&AiProviderSettings::default()).unwrap();
        assert!(!raw.contains("sk-"));
        assert!(raw.contains("api_key_configured"));
    }

    #[test]
    fn provider_storage_api_has_expected_signatures() {
        let _load: fn(&Database) -> Result<AiProviderSettings, String> = load_settings;
        let _save: fn(&Database, AiProviderSettings) -> Result<(), String> = save_settings;
        let _set_key: fn(&Database, &str) -> Result<(), String> = set_api_key;
        let _clear_key: fn(&Database) -> Result<(), String> = clear_api_key;
        let _load_key: fn(&Database) -> Result<Option<String>, String> = load_api_key;
    }
}
