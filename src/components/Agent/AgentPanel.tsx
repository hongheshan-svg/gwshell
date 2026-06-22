import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import { useAgentStore } from '../../stores/agentStore';
import { useAgentAuditPersistence } from '../../hooks/useAgentAuditPersistence';
import { useAgentAutoContinuation } from '../../hooks/useAgentAutoContinuation';
import { AgentObjective } from './AgentObjective';
import { AgentAnalysisStream } from './AgentAnalysisStream';
import { AgentEvidence } from './AgentEvidence';
import { AgentActionQueue } from './AgentActionQueue';
import { AgentAuditTimeline } from './AgentAuditTimeline';
import { AgentAuditHistory } from './AgentAuditHistory';
import { AgentPolicyControls } from './AgentPolicyControls';
import { AgentSessionList } from './AgentSessionList';
import { AgentManualEvidence } from './AgentManualEvidence';
import { AgentReportExport } from './AgentReportExport';

export const AgentPanel: React.FC = () => {
  const { t } = useTranslation();
  useAgentAuditPersistence();
  const autoContinuation = useAgentAutoContinuation();
  const open = useAppStore((s) => s.agentPanelOpen);
  const toggle = useAppStore((s) => s.toggleAgentPanel);
  const activeSession = useAgentStore((s) => s.activeSession);
  const error = useAgentStore((s) => s.error);
  const setError = useAgentStore((s) => s.setError);
  if (!open) return null;

  const cancelAgent = async () => {
    if (!activeSession || activeSession.status !== 'running') return;
    try {
      setError(null);
      await invoke('cancel_agent_session', { agentSessionId: activeSession.id });
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <aside className="agent-panel" aria-label={t('agent_panel_title')}>
      <div className="agent-panel-header">
        <span>{t('agent_panel_title')}</span>
        <div className="agent-panel-header-actions">
          {activeSession?.status === 'running' && (
            <button className="agent-panel-link-btn" onClick={() => void cancelAgent()} type="button">
              {t('agent_cancel')}
            </button>
          )}
          <button className="agent-panel-close" onClick={toggle} title={t('agent_panel_close')} type="button">
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="agent-panel-body">
        <AgentObjective />
        {error && <div className="agent-error">{error}</div>}
        {activeSession && (
          <div className="agent-session-id">
            <strong>{activeSession.status}</strong>
            <span>{activeSession.objective}</span>
            <small>
              {autoContinuation.inFlight
                ? t('agent_auto_continue_running')
                : autoContinuation.enabled
                ? t('agent_auto_continue_status', { count: autoContinuation.count, max: autoContinuation.max })
                : t('agent_auto_continue_disabled')}
            </small>
          </div>
        )}
        <AgentPolicyControls />
        <AgentReportExport />
        <AgentAnalysisStream />
        <AgentActionQueue />
        <AgentAuditTimeline />
        <AgentManualEvidence />
        <AgentEvidence />
        <AgentSessionList />
        <AgentAuditHistory />
      </div>
    </aside>
  );
};
