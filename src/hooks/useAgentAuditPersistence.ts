import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAgentStore } from '../stores/agentStore';
import type { AgentAuditRecord } from '../types/agent';

export function useAgentAuditPersistence(): void {
  const activeSession = useAgentStore((s) => s.activeSession);
  const evidence = useAgentStore((s) => s.evidence);
  const analysisText = useAgentStore((s) => s.analysisText);
  const latestUpdate = useAgentStore((s) => s.latestUpdate);
  const actions = useAgentStore((s) => s.actions);
  const results = useAgentStore((s) => s.results);
  const auditIdsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!activeSession) return;
    const hasReport =
      evidence.length > 0 ||
      analysisText.trim().length > 0 ||
      latestUpdate !== null ||
      actions.length > 0 ||
      results.length > 0;
    if (!hasReport) return;

    let auditId = auditIdsRef.current.get(activeSession.id);
    if (!auditId) {
      auditId = crypto.randomUUID();
      auditIdsRef.current.set(activeSession.id, auditId);
    }

    const record: AgentAuditRecord = {
      id: auditId,
      agent_session_id: activeSession.id,
      target_session_id: activeSession.target_session_id,
      started_at: activeSession.started_at,
      finished_at: activeSession.status === 'running' ? null : Math.floor(Date.now() / 1000),
      objective: activeSession.objective,
      status: activeSession.status,
      report_json: JSON.stringify({
        evidence,
        analysis_text: analysisText,
        latest_update: latestUpdate,
        actions,
        results,
      }),
    };

    const timer = window.setTimeout(() => {
      invoke('save_agent_audit', { record }).catch((err) => {
        console.warn('Failed to save agent audit', err);
      });
    }, 300);

    return () => window.clearTimeout(timer);
  }, [activeSession, evidence, analysisText, latestUpdate, actions, results]);
}
