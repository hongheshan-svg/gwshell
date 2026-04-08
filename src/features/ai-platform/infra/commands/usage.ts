import { invoke } from '@tauri-apps/api/core';

export interface ProviderUsage {
  provider: string;
  cost: number;
  tokens: number;
  requests: number;
}

export interface ModelUsage {
  model: string;
  cost: number;
  tokens: number;
  requests: number;
}

export interface DailyUsage {
  date: string;
  cost: number;
  tokens: number;
  requests: number;
}

export interface ModelPricing {
  model: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  currency: string;
}

export interface UsageSummary {
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
  byProvider: ProviderUsage[];
  byModel: ModelUsage[];
  dailyTrend: DailyUsage[];
  customPricing: ModelPricing[];
  days: number;
  source: string;
}

export function getAiPlatformUsageSummary(days: number) {
  return invoke<UsageSummary>('ai_platform_get_usage_summary', { days });
}

export function clearAiPlatformUsageRecords() {
  return invoke('ai_platform_clear_usage_records');
}