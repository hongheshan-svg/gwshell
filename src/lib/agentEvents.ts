import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useAgentStore } from '../stores/agentStore';
import type { AgentAnalysisUpdate, AgentEvidence, AgentToolCall, AgentToolResult } from '../types/agent';

export async function subscribeAgentEvents(agentSessionId: string): Promise<UnlistenFn[]> {
  const unlisteners = await Promise.all([
    listen<AgentEvidence>(`agent-evidence-${agentSessionId}`, (event) => {
      useAgentStore.getState().pushEvidence(event.payload);
    }),
    listen<{ textDelta: string }>(`agent-analysis-delta-${agentSessionId}`, (event) => {
      useAgentStore.getState().appendAnalysisText(event.payload.textDelta);
    }),
    listen<AgentAnalysisUpdate>(`agent-analysis-update-${agentSessionId}`, (event) => {
      useAgentStore.getState().setLatestUpdate(event.payload);
    }),
    listen<AgentToolCall>(`agent-action-proposed-${agentSessionId}`, (event) => {
      useAgentStore.getState().upsertAction(event.payload);
    }),
    listen<AgentToolResult>(`agent-action-result-${agentSessionId}`, (event) => {
      useAgentStore.getState().pushResult(event.payload);
    }),
    listen<{ message: string }>(`agent-error-${agentSessionId}`, (event) => {
      useAgentStore.getState().setError(event.payload.message);
    }),
  ]);
  return unlisteners;
}
