import { invoke } from '@tauri-apps/api/core';

export interface AuthConnection {
  app: string;
  label: string;
  activeProviderId?: string;
  activeProviderName?: string;
  providerType?: string;
  providerEnabled: boolean;
  localConfigTargets: string[];
  localConfigPresent: boolean;
  providerTokenPresent: boolean;
  localTokenPresent: boolean;
  tokenSource?: string;
  baseUrl?: string;
  model?: string;
  status: string;
  detail: string;
}

export interface AuthStatusItem {
  id: string;
  level: string;
  title: string;
  detail: string;
}

export interface ProviderSwitchHistory {
  providerId: string;
  providerName: string;
  app: string;
  switchedAt: number;
}

export interface AuthSnapshot {
  connections: AuthConnection[];
  statuses: AuthStatusItem[];
  switchHistory: ProviderSwitchHistory[];
  source: string;
}

export function getAiPlatformAuthSnapshot() {
  return invoke<AuthSnapshot>('ai_platform_get_auth_snapshot');
}