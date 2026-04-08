import { invoke } from '@tauri-apps/api/core';

export interface ProviderApps {
  claude: boolean;
  codex: boolean;
  gemini: boolean;
  opencode: boolean;
  openclaw: boolean;
}

export interface ClaudeModels {
  model?: string;
  haikuModel?: string;
  sonnetModel?: string;
  opusModel?: string;
}

export interface CodexModels {
  model?: string;
  reasoningEffort?: string;
}

export interface GeminiModels {
  model?: string;
}

export interface OpenCodeModels {
  model?: string;
}

export interface OpenClawModels {
  model?: string;
}

export interface ProviderModels {
  claude?: ClaudeModels;
  codex?: CodexModels;
  gemini?: GeminiModels;
  opencode?: OpenCodeModels;
  openclaw?: OpenClawModels;
}

export interface ProviderRecord {
  id: string;
  name: string;
  providerType: string;
  baseUrl: string;
  apiKey: string;
  apps: ProviderApps;
  models: ProviderModels;
  enabled: boolean;
  websiteUrl?: string;
  notes?: string;
  icon?: string;
  iconColor?: string;
  createdAt?: number;
  updatedAt?: number;
  failoverPriority?: number;
}

export interface ActiveProviderSet {
  claude?: string;
  codex?: string;
  gemini?: string;
  opencode?: string;
  openclaw?: string;
}

export interface ProviderSnapshot {
  providers: ProviderRecord[];
  active: ActiveProviderSet;
  source: string;
  healthChecks: ProviderHealth[];
  switchHistory: ProviderSwitchHistory[];
}

export interface ProviderHealth {
  providerId: string;
  status: string;
  latencyMs?: number;
  httpStatus?: number;
  checkMode: string;
  target: string;
  message: string;
  checkedAt: number;
}

export interface ProviderSwitchHistory {
  providerId: string;
  providerName: string;
  app: string;
  switchedAt: number;
}

export function getAiPlatformProviders() {
  return invoke<ProviderSnapshot>('ai_platform_list_providers');
}

export function saveAiPlatformProvider(provider: ProviderRecord) {
  return invoke<ProviderSnapshot>('ai_platform_save_provider', { provider });
}

export function deleteAiPlatformProvider(providerId: string) {
  return invoke<ProviderSnapshot>('ai_platform_delete_provider', { provider_id: providerId });
}

export function switchAiPlatformProvider(providerId: string, app: string) {
  return invoke<ProviderSnapshot>('ai_platform_switch_provider', {
    provider_id: providerId,
    app,
  });
}

export function checkAiPlatformProviderHealth(providerId: string) {
  return invoke<ProviderHealth>('ai_platform_check_provider_health', {
    provider_id: providerId,
  });
}