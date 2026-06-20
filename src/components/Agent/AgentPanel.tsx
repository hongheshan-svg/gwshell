import React from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import { useAgentStore } from '../../stores/agentStore';
import { AgentObjective } from './AgentObjective';
import { AgentAnalysisStream } from './AgentAnalysisStream';
import { AgentEvidence } from './AgentEvidence';
import { AgentActionQueue } from './AgentActionQueue';
import { AgentAuditTimeline } from './AgentAuditTimeline';

export const AgentPanel: React.FC = () => {
  const { t } = useTranslation();
  const open = useAppStore((s) => s.agentPanelOpen);
  const toggle = useAppStore((s) => s.toggleAgentPanel);
  const activeSession = useAgentStore((s) => s.activeSession);
  const error = useAgentStore((s) => s.error);
  if (!open) return null;

  return (
    <aside className="agent-panel" aria-label={t('agent_panel_title')}>
      <div className="agent-panel-header">
        <span>{t('agent_panel_title')}</span>
        <button className="agent-panel-close" onClick={toggle} title={t('agent_panel_close')} type="button">
          <X size={16} />
        </button>
      </div>
      <div className="agent-panel-body">
        <AgentObjective />
        {error && <div className="agent-error">{error}</div>}
        {activeSession && <div className="agent-session-id">{activeSession.objective}</div>}
        <AgentAnalysisStream />
        <AgentActionQueue />
        <AgentAuditTimeline />
        <AgentEvidence />
      </div>
    </aside>
  );
};
