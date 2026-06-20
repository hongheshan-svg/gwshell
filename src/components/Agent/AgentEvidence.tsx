import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../../stores/agentStore';

export const AgentEvidence: React.FC = () => {
  const { t } = useTranslation();
  const evidence = useAgentStore((s) => s.evidence);

  if (evidence.length === 0) {
    return <div className="agent-empty">{t('agent_no_evidence')}</div>;
  }

  return (
    <div className="agent-evidence-list">
      {evidence.map((item) => (
        <details className="agent-evidence-item" key={item.id}>
          <summary>{item.label}</summary>
          <pre>{item.body}</pre>
        </details>
      ))}
    </div>
  );
};
