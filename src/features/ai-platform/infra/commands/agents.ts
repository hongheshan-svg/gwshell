import { invoke } from '@tauri-apps/api/core';

export interface AgentCategoryRecord {
  id: string;
  name: string;
  description: string;
}

export interface AgentAssignmentRecord {
  agentKey: string;
  providerId?: string;
  model?: string;
  timeoutSeconds?: number;
}

export interface AgentProviderOption {
  providerId: string;
  providerName: string;
  model: string;
}

export interface AgentSnapshotItem {
  key: string;
  name: string;
  category: string;
  description: string;
  enabled: boolean;
  assignment: AgentAssignmentRecord;
}

export interface AgentsSnapshot {
  categories: AgentCategoryRecord[];
  agents: AgentSnapshotItem[];
  providerOptions: AgentProviderOption[];
  routingMode: string;
  source: string;
}

export function getAiPlatformAgentsSnapshot() {
  return invoke<AgentsSnapshot>('ai_platform_get_agents_snapshot');
}

export function setAiPlatformAgentEnabled(agentKey: string, enabled: boolean) {
  return invoke<AgentsSnapshot>('ai_platform_set_agent_enabled', { agentKey, enabled });
}

export function saveAiPlatformAgentAssignment(assignment: AgentAssignmentRecord) {
  return invoke<AgentsSnapshot>('ai_platform_save_agent_assignment', { assignment });
}

export function setAiPlatformAgentsRoutingMode(routingMode: string) {
  return invoke<AgentsSnapshot>('ai_platform_set_agents_routing_mode', { routingMode });
}