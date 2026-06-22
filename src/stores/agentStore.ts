import { create } from 'zustand';
import type { AgentAnalysisUpdate, AgentEvidence, AgentSessionInfo, AgentToolCall, AgentToolResult } from '../types/agent';

interface AgentStore {
  activeSession: AgentSessionInfo | null;
  evidence: AgentEvidence[];
  analysisText: string;
  latestUpdate: AgentAnalysisUpdate | null;
  actions: AgentToolCall[];
  results: AgentToolResult[];
  error: string | null;
  setActiveSession: (session: AgentSessionInfo | null) => void;
  pushEvidence: (evidence: AgentEvidence) => void;
  appendAnalysisText: (delta: string) => void;
  setLatestUpdate: (update: AgentAnalysisUpdate) => void;
  upsertAction: (action: AgentToolCall) => void;
  pushResult: (result: AgentToolResult) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useAgentStore = create<AgentStore>((set) => ({
  activeSession: null,
  evidence: [],
  analysisText: '',
  latestUpdate: null,
  actions: [],
  results: [],
  error: null,
  setActiveSession: (session) =>
    set((s) => {
      if (session === null) {
        return { activeSession: null, evidence: [], analysisText: '', latestUpdate: null, actions: [], results: [], error: null };
      }

      if (s.activeSession?.id === session.id) {
        return { activeSession: session };
      }

      return { activeSession: session, evidence: [], analysisText: '', latestUpdate: null, actions: [], results: [], error: null };
    }),
  pushEvidence: (evidence) => set((s) => ({ evidence: [...s.evidence, evidence] })),
  appendAnalysisText: (delta) => set((s) => ({ analysisText: s.analysisText + delta })),
  setLatestUpdate: (update) => set({ latestUpdate: update }),
  upsertAction: (action) =>
    set((s) => {
      const index = s.actions.findIndex((a) => a.id === action.id);
      if (index === -1) {
        return { actions: [...s.actions, action] };
      }

      const actions = [...s.actions];
      actions[index] = action;
      return { actions };
    }),
  pushResult: (result) => set((s) => ({ results: [...s.results, result] })),
  setError: (error) => set({ error }),
  reset: () => set({ activeSession: null, evidence: [], analysisText: '', latestUpdate: null, actions: [], results: [], error: null }),
}));
