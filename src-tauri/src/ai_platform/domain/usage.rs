use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageRecord {
	pub id: String,
	pub timestamp: i64,
	pub provider: String,
	pub model: String,
	pub tool: String,
	pub input_tokens: u64,
	pub output_tokens: u64,
	pub total_tokens: u64,
	pub cost: f64,
	pub currency: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPricing {
	pub model: String,
	pub input_price_per_million: f64,
	pub output_price_per_million: f64,
	pub currency: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUsage {
	pub provider: String,
	pub cost: f64,
	pub tokens: u64,
	pub requests: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
	pub model: String,
	pub cost: f64,
	pub tokens: u64,
	pub requests: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyUsage {
	pub date: String,
	pub cost: f64,
	pub tokens: u64,
	pub requests: usize,
}