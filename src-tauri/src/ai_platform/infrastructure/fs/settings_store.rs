use crate::ai_platform::domain::settings::AiPlatformSettingsRecord;
use std::fs;
use std::path::PathBuf;

pub fn load_store() -> Result<AiPlatformSettingsRecord, String> {
    let path = store_path().ok_or("Cannot determine AI platform data directory")?;
    if !path.exists() {
        return Ok(AiPlatformSettingsRecord::default());
    }
    let content = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

pub fn save_store(store: &AiPlatformSettingsRecord) -> Result<(), String> {
    let path = store_path().ok_or("Cannot determine AI platform data directory")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let content = serde_json::to_string_pretty(store).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

fn store_path() -> Option<PathBuf> {
    dirs::data_local_dir().map(|dir| dir.join("gwshell").join("ai-platform").join("settings.json"))
}