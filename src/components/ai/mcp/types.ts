export type McpAppId = "claude" | "codex" | "gemini" | "opencode";

/** Matches src-tauri/src/ai_platform/domain/mcp.rs McpServerRecord */
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

export interface McpSnapshotDto {
  servers: McpServerRecord[];
  templates: McpServerRecord[];
  source: string;
  validations: McpServerValidationDto[];
  syncStatuses: McpAppSyncStatusDto[];
}

export interface McpServerValidationDto {
  serverId: string;
  status: string;
  issues: string[];
}

export interface McpAppSyncStatusDto {
  app: string;
  status: string;
  configPath: string;
  exists: boolean;
  targetedServers: number;
  syncedServers: number;
  message: string;
}

export interface McpSyncResultDto {
  status: string;
  message: string;
  syncedApps: string[];
  appResults: McpAppSyncStatusDto[];
}
