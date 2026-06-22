import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useAgentStore } from '../stores/agentStore';
import type { AgentAnalysisUpdate, AgentEvidence, AgentSessionInfo, AgentToolCall, AgentToolResult } from '../types/agent';

export async function subscribeAgentEvents(agentSessionId: string): Promise<UnlistenFn[]> {
  const unlisteners: UnlistenFn[] = [];

  try {
    unlisteners.push(await listen<AgentEvidence>(`agent-evidence-${agentSessionId}`, (event) => {
      useAgentStore.getState().pushEvidence(event.payload);
    }));
    unlisteners.push(await listen<{ textDelta: string }>(`agent-analysis-delta-${agentSessionId}`, (event) => {
      useAgentStore.getState().appendAnalysisText(event.payload.textDelta);
    }));
    unlisteners.push(await listen<AgentAnalysisUpdate>(`agent-analysis-update-${agentSessionId}`, (event) => {
      useAgentStore.getState().setLatestUpdate(event.payload);
    }));
    unlisteners.push(await listen<AgentSessionInfo>(`agent-session-update-${agentSessionId}`, (event) => {
      useAgentStore.getState().setActiveSession(event.payload);
    }));
    unlisteners.push(await listen<AgentToolCall>(`agent-action-proposed-${agentSessionId}`, (event) => {
      useAgentStore.getState().upsertAction(event.payload);
    }));
    unlisteners.push(await listen<AgentToolResult>(`agent-action-result-${agentSessionId}`, (event) => {
      useAgentStore.getState().pushResult(event.payload);
    }));
    unlisteners.push(await listen<{ message: string }>(`agent-error-${agentSessionId}`, (event) => {
      useAgentStore.getState().setError(event.payload.message);
    }));
    return unlisteners;
  } catch (error) {
    for (const unlisten of unlisteners) {
      try {
        unlisten();
      } catch {
        // Keep rethrowing the original registration failure.
      }
    }
    throw error;
  }
}
