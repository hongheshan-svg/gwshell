use crate::ai_platform::application::usage::service;
use crate::ai_platform::domain::usage::{ModelPricing, UsageRecord};
use crate::ai_platform::interfaces::dto::usage::UsageSummaryDto;

#[tauri::command]
pub async fn ai_platform_get_usage_summary(days: Option<u32>) -> Result<UsageSummaryDto, String> {
    tokio::task::spawn_blocking(move || service::get_usage_summary(days.unwrap_or(30)))
        .await
        .map_err(|error| format!("task join: {error}"))?
}

#[tauri::command]
pub async fn ai_platform_clear_usage_records() -> Result<(), String> {
    tokio::task::spawn_blocking(service::clear_usage_records)
        .await
        .map_err(|error| format!("task join: {error}"))?
}

#[tauri::command]
pub async fn ai_platform_add_usage_record(record: UsageRecord) -> Result<(), String> {
    tokio::task::spawn_blocking(move || service::add_usage_record(record))
        .await
        .map_err(|error| format!("task join: {error}"))?
}

#[tauri::command]
pub async fn ai_platform_get_model_pricing() -> Result<Vec<ModelPricing>, String> {
    tokio::task::spawn_blocking(service::get_model_pricing)
        .await
        .map_err(|error| format!("task join: {error}"))?
}

#[tauri::command]
pub async fn ai_platform_save_model_pricing(pricing: Vec<ModelPricing>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || service::save_model_pricing(pricing))
        .await
        .map_err(|error| format!("task join: {error}"))?
}