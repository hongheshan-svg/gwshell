use crate::ai_platform::domain::usage::{ModelPricing, ModelUsage, ProviderUsage, UsageRecord};
use crate::ai_platform::infrastructure::fs::usage_store::{load_or_initialize_store, save_store};
use crate::ai_platform::interfaces::dto::usage::UsageSummaryDto;
use std::collections::{BTreeMap, HashMap};

pub fn get_usage_summary(days: u32) -> Result<UsageSummaryDto, String> {
    let loaded = load_or_initialize_store()?;
    let now = current_epoch_ms();
    let cutoff = now - i64::from(days) * 86_400 * 1000;
    let filtered: Vec<&UsageRecord> = loaded
        .store
        .records
        .iter()
        .filter(|record| record.timestamp >= cutoff)
        .collect();

    let total_cost = filtered.iter().map(|record| record.cost).sum();
    let total_tokens = filtered.iter().map(|record| record.total_tokens).sum();
    let total_requests = filtered.len();

    let mut by_provider: HashMap<String, ProviderUsage> = HashMap::new();
    let mut by_model: HashMap<String, ModelUsage> = HashMap::new();
    let mut daily_trend: BTreeMap<String, crate::ai_platform::domain::usage::DailyUsage> = BTreeMap::new();

    for record in filtered {
        by_provider
            .entry(record.provider.clone())
            .and_modify(|item| {
                item.cost += record.cost;
                item.tokens += record.total_tokens;
                item.requests += 1;
            })
            .or_insert(ProviderUsage {
                provider: record.provider.clone(),
                cost: record.cost,
                tokens: record.total_tokens,
                requests: 1,
            });

        by_model
            .entry(record.model.clone())
            .and_modify(|item| {
                item.cost += record.cost;
                item.tokens += record.total_tokens;
                item.requests += 1;
            })
            .or_insert(ModelUsage {
                model: record.model.clone(),
                cost: record.cost,
                tokens: record.total_tokens,
                requests: 1,
            });

        let date = ms_to_date(record.timestamp);
        daily_trend
            .entry(date.clone())
            .and_modify(|item| {
                item.cost += record.cost;
                item.tokens += record.total_tokens;
                item.requests += 1;
            })
            .or_insert(crate::ai_platform::domain::usage::DailyUsage {
                date,
                cost: record.cost,
                tokens: record.total_tokens,
                requests: 1,
            });
    }

    let mut by_provider = by_provider.into_values().collect::<Vec<_>>();
    by_provider.sort_by(|left, right| right.cost.total_cmp(&left.cost));
    let mut by_model = by_model.into_values().collect::<Vec<_>>();
    by_model.sort_by(|left, right| right.cost.total_cmp(&left.cost));

    Ok(UsageSummaryDto {
        total_cost,
        total_tokens,
        total_requests,
        by_provider,
        by_model,
        daily_trend: daily_trend.into_values().collect(),
        custom_pricing: loaded.store.custom_pricing,
        days,
        source: loaded.source,
    })
}

pub fn clear_usage_records() -> Result<(), String> {
    let mut loaded = load_or_initialize_store()?;
    loaded.store.records.clear();
    save_store(&loaded.store)
}

pub fn add_usage_record(record: UsageRecord) -> Result<(), String> {
    let mut loaded = load_or_initialize_store()?;
    loaded.store.records.push(record);
    save_store(&loaded.store)
}

pub fn get_model_pricing() -> Result<Vec<ModelPricing>, String> {
    let loaded = load_or_initialize_store()?;
    Ok(loaded.store.custom_pricing)
}

pub fn save_model_pricing(pricing: Vec<ModelPricing>) -> Result<(), String> {
    let mut loaded = load_or_initialize_store()?;
    loaded.store.custom_pricing = pricing;
    save_store(&loaded.store)
}

fn current_epoch_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn ms_to_date(ms: i64) -> String {
    let secs = ms / 1000;
    let days = secs / 86_400;
    let (year, month, day) = epoch_days_to_ymd(days as i32);
    format!("{:04}-{:02}-{:02}", year, month, day)
}

fn epoch_days_to_ymd(days: i32) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i32 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}