use crate::ai_platform::domain::usage::{DailyUsage, ModelPricing, ModelUsage, ProviderUsage};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummaryDto {
    pub total_cost: f64,
    pub total_tokens: u64,
    pub total_requests: usize,
    pub by_provider: Vec<ProviderUsage>,
    pub by_model: Vec<ModelUsage>,
    pub daily_trend: Vec<DailyUsage>,
    pub custom_pricing: Vec<ModelPricing>,
    pub days: u32,
    pub source: String,
}