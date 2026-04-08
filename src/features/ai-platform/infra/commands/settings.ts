import { invoke } from '@tauri-apps/api/core';

export interface DirectorySettingsRecord {
  defaultWorkspaceRoot: string;
  claudeConfigDir: string;
  codexConfigDir: string;
  geminiConfigDir: string;
  opencodeConfigDir: string;
  openclawConfigDir: string;
}

export interface AppearanceSettingsRecord {
  theme: 'dark' | 'light';
  language: 'zh' | 'en';
}

export interface BackupSettingsRecord {
  enabled: boolean;
  intervalHours: number;
  retentionCount: number;
}

export interface WebDavSettingsRecord {
  enabled: boolean;
  baseUrl: string;
  username: string;
  password: string;
  remotePath: string;
  autoSync: boolean;
}

export interface OutboundProxySettingsRecord {
  url: string;
}

export interface AiPlatformSettingsRecord {
  directories: DirectorySettingsRecord;
  appearance: AppearanceSettingsRecord;
  backup: BackupSettingsRecord;
  webdav: WebDavSettingsRecord;
  outboundProxy: OutboundProxySettingsRecord;
}

export interface SettingsStatusItem {
  id: string;
  label: string;
  level: string;
  detail: string;
}

export interface SettingsSnapshot {
  settings: AiPlatformSettingsRecord;
  statuses: SettingsStatusItem[];
  source: string;
}

export function getAiPlatformSettingsSnapshot() {
  return invoke<SettingsSnapshot>('ai_platform_get_settings_snapshot');
}

export function saveAiPlatformSettings(settings: AiPlatformSettingsRecord) {
  return invoke<SettingsSnapshot>('ai_platform_save_settings', { settings });
}