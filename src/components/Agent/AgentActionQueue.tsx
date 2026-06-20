import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../../stores/agentStore';
import type { AgentToolCall } from '../../types/agent';

function payloadLabel(action: AgentToolCall): string {
  if (typeof action.payload.command === 'string') {
    return action.payload.command;
  }
  return JSON.stringify(action.payload);
}

export const AgentActionQueue: React.FC = () => {
  const { t } = useTranslation();
  const actions = useAgentStore((s) => s.actions);

  if (actions.length === 0) {
    return <div className="agent-empty">{t('agent_no_actions')}</div>;
  }

  return (
    <div className="agent-action-list">
      {actions.map((action) => (
        <div className={`agent-action agent-risk-${action.risk}`} key={action.id}>
          <div className="agent-action-tool">{action.tool}</div>
          <div className="agent-action-reason">{action.reason}</div>
          <code>{payloadLabel(action)}</code>
        </div>
      ))}
    </div>
  );
};
