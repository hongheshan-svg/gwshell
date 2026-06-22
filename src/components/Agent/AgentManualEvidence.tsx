import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../../stores/agentStore';
import type { AgentEvidence } from '../../types/agent';

export const AgentManualEvidence: React.FC = () => {
  const { t } = useTranslation();
  const activeSession = useAgentStore((s) => s.activeSession);
  const [label, setLabel] = useState('');
  const [body, setBody] = useState('');

  const addEvidence = () => {
    if (!activeSession || !body.trim()) return;
    const evidence: AgentEvidence = {
      id: crypto.randomUUID(),
      source: 'manual',
      label: label.trim() || t('agent_manual_context_default_label'),
      body: body.trim(),
      created_at: Math.floor(Date.now() / 1000),
    };
    useAgentStore.getState().pushEvidence(evidence);
    setLabel('');
    setBody('');
  };

  return (
    <div className="agent-manual-context">
      <div className="agent-section-title">{t('agent_manual_context')}</div>
      <input
        className="agent-session-filter-input"
        placeholder={t('agent_manual_context_label')}
        value={label}
        onChange={(event) => setLabel(event.target.value)}
      />
      <textarea
        className="agent-objective-input"
        placeholder={t('agent_manual_context_placeholder')}
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      <button className="settings-btn-outline" disabled={!activeSession || !body.trim()} onClick={addEvidence} type="button">
        {t('agent_manual_context_add')}
      </button>
    </div>
  );
};
