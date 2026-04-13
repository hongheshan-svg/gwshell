/** Mirrors src-tauri/src/ai_platform/domain/usage.rs */

export interface UsageRecord {
  id: string;
  timestamp: number;
  provider: string;
  model: string;
  tool: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  currency: string;
}

export interface ModelPricing {
  model: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  currency: string;
}

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

export interface UsageSummaryDto {
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

export type TimeRange = "1d" | "7d" | "30d";
