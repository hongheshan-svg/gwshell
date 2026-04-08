import { invoke } from '@tauri-apps/api/core';

export interface McpSyncApps {
  claude: boolean;
  codex: boolean;
  gemini: boolean;
  opencode: boolean;
}

export interface McpServerRecord {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  syncApps: McpSyncApps;
  enabled: boolean;
}

export interface McpSnapshot {
  servers: McpServerRecord[];
  templates: McpServerRecord[];
  source: string;
  validations: McpServerValidation[];
  syncStatuses: McpAppSyncStatus[];
}

export interface McpSyncResult {
  status: string;
  message: string;
  syncedApps: string[];
  appResults: McpAppSyncStatus[];
}

export interface McpServerValidation {
  serverId: string;
  status: string;
  issues: string[];
}

export interface McpAppSyncStatus {
  app: string;
  status: string;
  configPath: string;
  exists: boolean;
  targetedServers: number;
  syncedServers: number;
  message: string;
}

export function getAiPlatformMcpSnapshot() {
  return invoke<McpSnapshot>('ai_platform_get_mcp_snapshot');
}

export function saveAiPlatformMcpServer(server: McpServerRecord) {
  return invoke<McpSnapshot>('ai_platform_save_mcp_server', { server });
}

export function deleteAiPlatformMcpServer(serverId: string) {
  return invoke<McpSnapshot>('ai_platform_delete_mcp_server', { serverId });
}

export function syncAiPlatformMcpServers() {
  return invoke<McpSyncResult>('ai_platform_sync_mcp_servers');
}