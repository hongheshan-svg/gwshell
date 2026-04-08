import { invoke } from '@tauri-apps/api/core';

export interface SessionAssetRecord {
  id: string;
  name: string;
  sessionType: string;
  group?: string;
  target: string;
  projectDir?: string;
  summary: string;
  resumeCommand?: string;
  createdAt?: string;
  expiredAt?: string;
  proxyEnabled: boolean;
  tunnelEnabled: boolean;
}

export interface SessionGroupRecord {
  name: string;
  count: number;
}

export interface SessionsSnapshot {
  sessions: SessionAssetRecord[];
  groups: SessionGroupRecord[];
  deeplinkTemplate: string;
  source: string;
}

export function getAiPlatformSessionsSnapshot() {
  return invoke<SessionsSnapshot>('ai_platform_get_sessions_snapshot');
}

export function deleteAiPlatformSessionRecord(sessionId: string) {
  return invoke<SessionsSnapshot>('ai_platform_delete_session_record', { sessionId });
}