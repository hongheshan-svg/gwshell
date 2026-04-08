import { invoke } from '@tauri-apps/api/core';

export interface PromptFileRecord {
  tool: string;
  filename: string;
  content: string;
  exists: boolean;
  path: string;
}

export interface PromptTemplateRecord {
  id: string;
  name: string;
  content: string;
}

export interface PromptSnapshot {
  projectDir: string;
  files: PromptFileRecord[];
  templates: PromptTemplateRecord[];
}

export interface PromptSyncResult {
  sourceTool: string;
  syncedTools: string[];
  syncedFiles: string[];
  message: string;
}

export function getAiPlatformPromptSnapshot(projectDir: string) {
  return invoke<PromptSnapshot>('ai_platform_get_prompt_snapshot', { projectDir });
}

export function writeAiPlatformPromptFile(filePath: string, content: string) {
  return invoke('ai_platform_write_prompt_file', { filePath, content });
}

export function syncAiPlatformPromptFiles(
  projectDir: string,
  sourceTool: string,
  targetTools: string[],
  content: string,
) {
  return invoke<PromptSyncResult>('ai_platform_sync_prompt_files', {
    projectDir,
    sourceTool,
    targetTools,
    content,
  });
}