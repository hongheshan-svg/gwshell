import { invoke } from '@tauri-apps/api/core';

export interface AiPlatformHealth {
  status: string;
  frontendRoot: string;
  backendRoot: string;
  bridgeMode: string;
}

export function getAiPlatformHealth() {
  return invoke<AiPlatformHealth>('ai_platform_health');
}