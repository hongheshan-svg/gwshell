import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import { useAgentStore } from '../../stores/agentStore';
import type { AgentAuditRecord } from '../../types/agent';

function auditSummary(record: AgentAuditRecord): string {
  try {
    const report = JSON.parse(record.report_json) as {
      evidence?: unknown[];
      actions?: unknown[];
      results?: unknown[];
      latest_update?: { summary?: string } | null;
    };
    const summary = report.latest_update?.summary;
    const counts = [
      `${report.evidence?.length ?? 0} evidence`,
      `${report.actions?.length ?? 0} actions`,
      `${report.results?.length ?? 0} results`,
    ].join(' / ');
    return summary ? `${summary}\n${counts}` : counts;
  } catch {
    return record.report_json;
  }
}

export const AgentAuditHistory: React.FC = () => {
  const { t } = useTranslation();
  const activeTab = useAppStore((s) => s.tabs.find((tab) => tab.id === s.activeTabId));
  const auditPulse = useAgentStore((s) => `${s.activeSession?.status ?? 'none'}-${s.evidence.length}-${s.results.length}`);
  const [records, setRecords] = useState<AgentAuditRecord[]>([]);

  useEffect(() => {
    if (!activeTab?.sessionId) {
      setRecords([]);
      return;
    }

    let cancelled = false;
    invoke<AgentAuditRecord[]>('list_agent_audits', { targetSessionId: activeTab.sessionId })
      .then((loaded) => {
        if (!cancelled) setRecords(loaded);
      })
      .catch(() => {
        if (!cancelled) setRecords([]);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab?.sessionId, auditPulse]);

  return (
    <div className="agent-history">
      <div className="agent-section-title">{t('agent_audit_history')}</div>
      {records.length === 0 ? (
        <div className="agent-empty">{t('agent_no_audit_history')}</div>
      ) : (
        records.slice(0, 6).map((record) => (
          <details className="agent-history-item" key={record.id}>
            <summary>
              <span>{record.status}</span>
              {record.objective}
            </summary>
            <pre>{auditSummary(record)}</pre>
          </details>
        ))
      )}
    </div>
  );
};
