import { invoke } from '@tauri-apps/api/core';

export interface WorkspaceFileRecord {
  id: string;
  kind: string;
  title: string;
  path: string;
  exists: boolean;
  content: string;
}

export interface WorkspaceSnapshot {
  workspaceRoot: string;
  files: WorkspaceFileRecord[];
  dailyMemoryDir: string;
}

export function getAiPlatformWorkspaceSnapshot(workspaceRoot: string) {
  return invoke<WorkspaceSnapshot>('ai_platform_get_workspace_snapshot', { workspaceRoot });
}

export function writeAiPlatformWorkspaceFile(filePath: string, content: string) {
  return invoke('ai_platform_write_workspace_file', { filePath, content });
}

export function createAiPlatformDailyMemory(workspaceRoot: string) {
  return invoke<WorkspaceSnapshot>('ai_platform_create_daily_memory', { workspaceRoot });
}

export function deleteAiPlatformWorkspaceFile(workspaceRoot: string, filePath: string) {
  return invoke<WorkspaceSnapshot>('ai_platform_delete_workspace_file', { workspaceRoot, filePath });
}