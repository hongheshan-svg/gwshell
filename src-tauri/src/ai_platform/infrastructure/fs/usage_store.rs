use crate::ai_platform::domain::usage::{ModelPricing, UsageRecord};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsageStore {
    #[serde(default)]
    pub records: Vec<UsageRecord>,
    #[serde(default)]
    pub custom_pricing: Vec<ModelPricing>,
}

#[derive(Debug, Clone)]
pub struct LoadedUsageStore {
    pub store: UsageStore,
    pub source: String,
}

pub fn load_or_initialize_store() -> Result<LoadedUsageStore, String> {
    let path = store_path().ok_or("Cannot determine AI platform data directory")?;
    if path.exists() {
        let content = fs::read_to_string(&path).map_err(|error| error.to_string())?;
        let store = serde_json::from_str(&content).map_err(|error| error.to_string())?;
        return Ok(LoadedUsageStore {
            store,
            source: "ai-platform-store".to_string(),
        });
    }

    if let Some(legacy_path) = legacy_store_path() {
        if legacy_path.exists() {
            let content = fs::read_to_string(&legacy_path).map_err(|error| error.to_string())?;
            let store: UsageStore = serde_json::from_str(&content).map_err(|error| error.to_string())?;
            save_store(&store)?;
            return Ok(LoadedUsageStore {
                store,
                source: "legacy-import".to_string(),
            });
        }
    }

    Ok(LoadedUsageStore {
        store: UsageStore::default(),
        source: "empty-store".to_string(),
    })
}

pub fn save_store(store: &UsageStore) -> Result<(), String> {
    let path = store_path().ok_or("Cannot determine AI platform data directory")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let content = serde_json::to_string_pretty(store).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

fn store_path() -> Option<PathBuf> {
    dirs::data_local_dir().map(|dir| dir.join("gwshell").join("ai-platform").join("usage_records.json"))
}

fn legacy_store_path() -> Option<PathBuf> {
    dirs::data_local_dir().map(|dir| dir.join("gwshell").join("usage_records.json"))
}