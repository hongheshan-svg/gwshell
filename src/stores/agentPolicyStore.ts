import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { AgentPolicySettings } from '../types/agent';
import { useToastStore } from './toastStore';
import i18n from '../i18n';

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
  log_interest_keywords: [
    'error',
    'warn',
    'panic',
    'fatal',
    'oom',
    'timeout',
    'exception',
    'failed',
    'denied',
    'refused',
    'unavailable',
  ],
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

export const useAgentPolicyStore = create<AgentPolicyStore>((set, get) => ({
  policy: defaultAgentPolicySettings,
  loaded: false,

  load: async () => {
    const loaded = await invoke<AgentPolicySettings>('load_agent_policy_settings');
    set({ policy: { ...defaultAgentPolicySettings, ...loaded }, loaded: true });
  },

  setPolicy: (policy) => set({ policy }),

  save: async (policy) => {
    // Capture the pre-save policy so a rollback restores it.
    const previous = get().policy;
    set({ policy, loaded: true });
    try {
      await invoke('save_agent_policy_settings', { settings: policy });
    } catch (err) {
      // Roll back the optimistic update so the UI matches the backend.
      set({ policy: previous });
      console.error('Failed to save agent policy, rolled back:', err);
      useToastStore.getState().pushToast({
        kind: 'error',
        title: i18n.t('toast.agentPolicySaveFailed'),
        message: String(err),
      });
    }
  },
}));
