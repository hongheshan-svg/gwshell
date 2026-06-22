import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAgentStore } from '../stores/agentStore';
import { useAgentPolicyStore } from '../stores/agentPolicyStore';
import type { AgentContinuationRequest } from '../types/agent';

export interface AgentAutoContinuationStatus {
  enabled: boolean;
  inFlight: boolean;
  count: number;
  max: number;
}

export function useAgentAutoContinuation(): AgentAutoContinuationStatus {
  const activeSession = useAgentStore((s) => s.activeSession);
  const evidence = useAgentStore((s) => s.evidence);
  const results = useAgentStore((s) => s.results);
  const setError = useAgentStore((s) => s.setError);
  const policy = useAgentPolicyStore((s) => s.policy);
  const policyLoaded = useAgentPolicyStore((s) => s.loaded);
  const loadPolicy = useAgentPolicyStore((s) => s.load);
  const [runtimeStatus, setRuntimeStatus] = useState({ inFlight: false, count: 0 });
  const analyzedAutoEvidenceRef = useRef(0);
  const analyzedResultsRef = useRef(0);
  const inFlightRef = useRef(false);
  const continuationCountRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!policyLoaded) {
      loadPolicy().catch((err) => setError(String(err)));
    }
  }, [loadPolicy, policyLoaded, setError]);

  useEffect(() => {
    if (!activeSession || activeSession.status === 'cancelled') return;
    if (!policy.auto_continue_enabled) return;
    if (sessionIdRef.current !== activeSession.id) {
      sessionIdRef.current = activeSession.id;
      analyzedAutoEvidenceRef.current = 0;
      analyzedResultsRef.current = 0;
      continuationCountRef.current = 0;
      setRuntimeStatus({ inFlight: false, count: 0 });
    }

    const autoEvidence = evidence.filter((item) =>
      item.source === 'manual' ||
      item.source === 'alert_rules' ||
      (policy.live_log_auto_analysis && item.source === 'live_log')
    );
    const hasNewAutoEvidence = autoEvidence.length > analyzedAutoEvidenceRef.current;
    const hasNewResults = results.length > analyzedResultsRef.current;
    if (!hasNewAutoEvidence && !hasNewResults) return;
    if (inFlightRef.current) return;
    if (continuationCountRef.current >= policy.max_auto_continuations) return;

    const timer = window.setTimeout(() => {
      const snapshot = useAgentStore.getState();
      if (!snapshot.activeSession || snapshot.activeSession.status === 'cancelled') return;

      inFlightRef.current = true;
      continuationCountRef.current += 1;
      setRuntimeStatus({ inFlight: true, count: continuationCountRef.current });
      const request: AgentContinuationRequest = {
        agent_session_id: snapshot.activeSession.id,
        evidence: snapshot.evidence.slice(-30),
        latest_update: snapshot.latestUpdate,
        results: snapshot.results.slice(-20),
      };

      invoke('continue_agent_session', { request })
        .then(() => {
          analyzedAutoEvidenceRef.current = snapshot.evidence.filter((item) =>
            item.source === 'manual' ||
            item.source === 'alert_rules' ||
            (policy.live_log_auto_analysis && item.source === 'live_log')
          ).length;
          analyzedResultsRef.current = snapshot.results.length;
        })
        .catch((err) => setError(String(err)))
        .finally(() => {
          inFlightRef.current = false;
          setRuntimeStatus({ inFlight: false, count: continuationCountRef.current });
        });
    }, hasNewResults ? 500 : 3000);

    return () => window.clearTimeout(timer);
  }, [activeSession, evidence, results, policy, setError]);

  return {
    enabled: policy.auto_continue_enabled,
    inFlight: runtimeStatus.inFlight,
    count: runtimeStatus.count,
    max: policy.max_auto_continuations,
  };
}
