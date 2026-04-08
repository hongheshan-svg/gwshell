import { invoke } from '@tauri-apps/api/core';

export interface SkillRootRecord {
  id: string;
  path: string;
  label: string;
}

export interface SkillRecord {
  id: string;
  rootId: string;
  name: string;
  description: string;
  path: string;
  skillFile: string;
  enabled: boolean;
}

export interface SkillsSnapshot {
  roots: SkillRootRecord[];
  skills: SkillRecord[];
  source: string;
}

export function getAiPlatformSkillsSnapshot() {
  return invoke<SkillsSnapshot>('ai_platform_get_skills_snapshot');
}

export function addAiPlatformSkillRoot(path: string) {
  return invoke<SkillsSnapshot>('ai_platform_add_skill_root', { path });
}

export function removeAiPlatformSkillRoot(rootId: string) {
  return invoke<SkillsSnapshot>('ai_platform_remove_skill_root', { rootId });
}

export function setAiPlatformSkillEnabled(skillId: string, enabled: boolean) {
  return invoke<SkillsSnapshot>('ai_platform_set_skill_enabled', { skillId, enabled });
}