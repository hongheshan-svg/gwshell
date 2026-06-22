import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { AgentPolicySettings } from '../types/agent';

export const defaultAgentPolicySettings: AgentPolicySettings = {
  auto_continue_enabled: true,
  live_log_auto_analysis: true,
  max_auto_continuations: 8,
  auto_execute_read_only: true,
  auto_execute_low_risk: true,
  auto_execute_command_allowlist: [],
  auto_execute_service_denylist: [],
  maintenance_window_enabled: false,
  maintenance_window_start: '00:00',
  maintenance_window_end: '23:59',
  log_filter_enabled: true,
  log_interest_keywords: ['error', 'warn', 'panic', 'fatal', 'oom', 'timeout', 'exception', 'failed', 'denied', 'refused', 'unavailable'],
  disk_alert_percent: 90,
  memory_alert_percent: 90,
  alert_auto_start_agent: true,
};

interface AgentPolicyStore {
  policy: AgentPolicySettings;
  loaded: boolean;
  load: () => Promise<void>;
  setPolicy: (policy: AgentPolicySettings) => void;
  save: (policy: AgentPolicySettings) => Promise<void>;
}

export const useAgentPolicyStore = create<AgentPolicyStore>((set) => ({
  policy: defaultAgentPolicySettings,
  loaded: false,

  load: async () => {
    const loaded = await invoke<AgentPolicySettings>('load_agent_policy_settings');
    set({ policy: { ...defaultAgentPolicySettings, ...loaded }, loaded: true });
  },

  setPolicy: (policy) => set({ policy }),

  save: async (policy) => {
    set({ policy, loaded: true });
    await invoke('save_agent_policy_settings', { settings: policy });
  },
}));
