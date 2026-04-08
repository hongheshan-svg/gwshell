import { invoke } from '@tauri-apps/api/core';

export interface ProxyServerRecord {
  running: boolean;
  listenHost: string;
  listenPort: number;
  logRequests: boolean;
  connectTimeoutSeconds: number;
  requestTimeoutSeconds: number;
}

export interface ProxyAppSwitchesRecord {
  claude: boolean;
  codex: boolean;
  gemini: boolean;
  opencode: boolean;
  openclaw: boolean;
}

export interface FailoverPolicyRecord {
  enabled: boolean;
  consecutiveFailures: number;
  cooldownSeconds: number;
}

export interface ProxyControlPlaneRecord {
  server: ProxyServerRecord;
  takeover: ProxyAppSwitchesRecord;
  failover: ProxyAppSwitchesRecord;
  failoverPolicy: FailoverPolicyRecord;
  exposeProxyToggle: boolean;
  exposeFailoverToggle: boolean;
}

export interface ProxyAppStatus {
  app: string;
  running: boolean;
  takeoverEnabled: boolean;
  failoverEnabled: boolean;
  queueDepth: number;
  activeProviderId?: string;
  requiresProxy: boolean;
  status: string;
  detail: string;
}

export interface ProxyQueueItem {
  app: string;
  providerId: string;
  providerName: string;
  providerType: string;
  priority: number;
  isActive: boolean;
  requiresProxy: boolean;
}

export interface ProxySnapshot {
  config: ProxyControlPlaneRecord;
  appStatuses: ProxyAppStatus[];
  queue: ProxyQueueItem[];
  source: string;
}

export function getAiPlatformProxySnapshot() {
  return invoke<ProxySnapshot>('ai_platform_get_proxy_snapshot');
}

export function saveAiPlatformProxyConfig(config: ProxyControlPlaneRecord) {
  return invoke<ProxySnapshot>('ai_platform_save_proxy_config', { config });
}