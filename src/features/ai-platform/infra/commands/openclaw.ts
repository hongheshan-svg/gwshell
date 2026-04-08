import { invoke } from '@tauri-apps/api/core';

export interface OpenClawProviderOptionRecord {
  providerId: string;
  providerName: string;
  model: string;
  active: boolean;
}

export interface OpenClawEditableConfigRecord {
  envJson: string;
  toolsProfile: string;
  allowList: string[];
  denyList: string[];
  primaryModel: string;
  fallbackModels: string[];
  workspace: string;
  timeoutSeconds?: number;
  contextTokens?: number;
  maxConcurrent?: number;
}

export interface OpenClawHealthItem {
  id: string;
  level: string;
  title: string;
  detail: string;
}

export interface OpenClawSnapshot {
  configPath: string;
  exists: boolean;
  parseError?: string;
  config: OpenClawEditableConfigRecord;
  providerOptions: OpenClawProviderOptionRecord[];
  bridgeSummary: string;
  health: OpenClawHealthItem[];
  source: string;
}

export function getAiPlatformOpenClawSnapshot() {
  return invoke<OpenClawSnapshot>('ai_platform_get_openclaw_snapshot');
}

export function saveAiPlatformOpenClawConfig(config: OpenClawEditableConfigRecord) {
  return invoke<OpenClawSnapshot>('ai_platform_save_openclaw_config', { config });
}