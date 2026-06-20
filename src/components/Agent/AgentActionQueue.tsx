import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../../stores/agentStore';
import type { AgentToolCall, AgentToolResult } from '../../types/agent';

function payloadLabel(action: AgentToolCall): string {
  if (typeof action.payload.command === 'string') {
    return action.payload.command;
  }
  return JSON.stringify(action.payload);
}

export const AgentActionQueue: React.FC = () => {
  const { t } = useTranslation();
  const actions = useAgentStore((s) => s.actions);
  const setError = useAgentStore((s) => s.setError);

  if (actions.length === 0) {
    return <div className="agent-empty">{t('agent_no_actions')}</div>;
  }

  const runAction = async (action: AgentToolCall) => {
    if (action.risk !== 'read_only' && !window.confirm(`Run ${action.risk} action?`)) return;
    setError(null);
    try {
      const result = await invoke<AgentToolResult>('execute_agent_action', { action });
      useAgentStore.getState().pushResult(result);
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <div className="agent-action-list">
      {actions.map((action) => (
        <div className={`agent-action agent-risk-${action.risk}`} key={action.id}>
          <div className="agent-action-tool">{action.tool}</div>
          <div className="agent-action-reason">{action.reason}</div>
          <code>{payloadLabel(action)}</code>
          <button className="settings-btn-outline" onClick={() => void runAction(action)} type="button">
            {action.risk === 'read_only' ? 'Run' : 'Review and run'}
          </button>
        </div>
      ))}
    </div>
  );
};
