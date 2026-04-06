use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

// ============================================================================
// Usage tracking data structures
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageRecord {
    pub id: String,
    pub timestamp: i64,
    pub provider: String,
    pub model: String,
    pub tool: String,
    #[serde(rename = "inputTokens")]
    pub input_tokens: u64,
    #[serde(rename = "outputTokens")]
    pub output_tokens: u64,
    #[serde(rename = "totalTokens")]
    pub total_tokens: u64,
    pub cost: f64,
    pub currency: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UsageStore {
    pub records: Vec<UsageRecord>,
    #[serde(default, rename = "customPricing")]
    pub custom_pricing: Vec<ModelPricing>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelPricing {
    pub model: String,
    #[serde(rename = "inputPricePerMillion")]
    pub input_price_per_million: f64,
    #[serde(rename = "outputPricePerMillion")]
    pub output_price_per_million: f64,
    pub currency: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageSummary {
    #[serde(rename = "totalCost")]
    pub total_cost: f64,
    #[serde(rename = "totalTokens")]
    pub total_tokens: u64,
    #[serde(rename = "totalRequests")]
    pub total_requests: usize,
    #[serde(rename = "byProvider")]
    pub by_provider: Vec<ProviderUsage>,
    #[serde(rename = "byModel")]
    pub by_model: Vec<ModelUsage>,
    #[serde(rename = "dailyTrend")]
    pub daily_trend: Vec<DailyUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderUsage {
    pub provider: String,
    pub cost: f64,
    pub tokens: u64,
    pub requests: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelUsage {
    pub model: String,
    pub cost: f64,
    pub tokens: u64,
    pub requests: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyUsage {
    pub date: String,
    pub cost: f64,
    pub tokens: u64,
    pub requests: usize,
}

// ============================================================================
// Persistence
// ============================================================================

fn usage_store_path() -> Option<PathBuf> {
    dirs::data_local_dir().map(|d| d.join("gwshell").join("usage_records.json"))
}

fn load_usage_store() -> UsageStore {
    usage_store_path()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_usage_store(store: &UsageStore) -> Result<(), String> {
    let path = usage_store_path().ok_or("Cannot determine data directory")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir: {}", e))?;
    }
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(store).map_err(|e| format!("Serialize: {}", e))?;
    fs::write(&tmp, &json).map_err(|e| format!("Write: {}", e))?;
    #[cfg(windows)]
    { let _ = fs::remove_file(&path); }
    fs::rename(&tmp, &path).map_err(|e| format!("Rename: {}", e))?;
    Ok(())
}

// ============================================================================
// Tauri commands
// ============================================================================

#[tauri::command]
pub fn add_usage_record(record: UsageRecord) -> Result<(), String> {
    let mut store = load_usage_store();
    store.records.push(record);
    save_usage_store(&store)
}

#[tauri::command]
pub fn get_usage_summary(days: Option<u32>) -> Result<UsageSummary, String> {
    let store = load_usage_store();
    let now = chrono_now_ms();
    let cutoff = days.map(|d| now - (d as i64) * 86400 * 1000).unwrap_or(0);

    let filtered: Vec<&UsageRecord> = store.records.iter()
        .filter(|r| r.timestamp >= cutoff)
        .collect();

    let total_cost: f64 = filtered.iter().map(|r| r.cost).sum();
    let total_tokens: u64 = filtered.iter().map(|r| r.total_tokens).sum();
    let total_requests = filtered.len();

    // Group by provider
    let mut provider_map: std::collections::HashMap<String, ProviderUsage> = std::collections::HashMap::new();
    for r in &filtered {
        let entry = provider_map.entry(r.provider.clone()).or_insert(ProviderUsage {
            provider: r.provider.clone(), cost: 0.0, tokens: 0, requests: 0,
        });
        entry.cost += r.cost;
        entry.tokens += r.total_tokens;
        entry.requests += 1;
    }

    // Group by model
    let mut model_map: std::collections::HashMap<String, ModelUsage> = std::collections::HashMap::new();
    for r in &filtered {
        let entry = model_map.entry(r.model.clone()).or_insert(ModelUsage {
            model: r.model.clone(), cost: 0.0, tokens: 0, requests: 0,
        });
        entry.cost += r.cost;
        entry.tokens += r.total_tokens;
        entry.requests += 1;
    }

    // Daily trend
    let mut daily_map: std::collections::BTreeMap<String, DailyUsage> = std::collections::BTreeMap::new();
    for r in &filtered {
        let date = ms_to_date(r.timestamp);
        let entry = daily_map.entry(date.clone()).or_insert(DailyUsage {
            date, cost: 0.0, tokens: 0, requests: 0,
        });
        entry.cost += r.cost;
        entry.tokens += r.total_tokens;
        entry.requests += 1;
    }

    Ok(UsageSummary {
        total_cost,
        total_tokens,
        total_requests,
        by_provider: provider_map.into_values().collect(),
        by_model: model_map.into_values().collect(),
        daily_trend: daily_map.into_values().collect(),
    })
}

#[tauri::command]
pub fn clear_usage_records() -> Result<(), String> {
    let mut store = load_usage_store();
    store.records.clear();
    save_usage_store(&store)
}

#[tauri::command]
pub fn save_model_pricing(pricing: Vec<ModelPricing>) -> Result<(), String> {
    let mut store = load_usage_store();
    store.custom_pricing = pricing;
    save_usage_store(&store)
}

#[tauri::command]
pub fn get_model_pricing() -> Result<Vec<ModelPricing>, String> {
    Ok(load_usage_store().custom_pricing)
}

// Simple time helpers (no chrono dependency needed)
fn chrono_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn ms_to_date(ms: i64) -> String {
    let secs = ms / 1000;
    let days = secs / 86400;
    // Simple date calculation from epoch days
    let (year, month, day) = epoch_days_to_ymd(days as i32);
    format!("{:04}-{:02}-{:02}", year, month, day)
}

fn epoch_days_to_ymd(days: i32) -> (i32, u32, u32) {
    // Civil from days algorithm (Howard Hinnant)
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i32 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}
