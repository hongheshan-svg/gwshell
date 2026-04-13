/** Mirrors src-tauri/src/ai_platform/domain/settings.rs */

export interface DirectorySettingsRecord {
  defaultWorkspaceRoot: string;
  claudeConfigDir: string;
  codexConfigDir: string;
  geminiConfigDir: string;
  opencodeConfigDir: string;
  openclawConfigDir: string;
}

export interface AppearanceSettingsRecord {
  theme: string;
  language: string;
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

export interface SettingsStatusItemDto {
  id: string;
  label: string;
  level: string;
  detail: string;
}

export interface SettingsSnapshotDto {
  settings: AiPlatformSettingsRecord;
  statuses: SettingsStatusItemDto[];
  source: string;
}
