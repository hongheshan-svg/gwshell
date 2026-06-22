import React, { useState } from 'react';
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
  const activeSession = useAgentStore((s) => s.activeSession);
  const setError = useAgentStore((s) => s.setError);
  const [liveStreams, setLiveStreams] = useState<Record<string, string>>({});

  if (actions.length === 0) {
    return <div className="agent-empty">{t('agent_no_actions')}</div>;
  }

  const runAction = async (action: AgentToolCall) => {
    if (action.tool === 'stream_log' || action.tool === 'docker_logs') {
      await toggleLiveStream(action);
      return;
    }
    if (action.risk === 'high' || action.risk === 'blocked') return;
    if (action.risk !== 'read_only' && !window.confirm(t('agent_action_confirm', { risk: action.risk }))) return;
    setError(null);
    try {
      const result = await invoke<AgentToolResult>('execute_agent_action', { action });
      useAgentStore.getState().pushResult(result);
    } catch (err) {
      setError(String(err));
    }
  };

  const toggleLiveStream = async (action: AgentToolCall) => {
    if (!activeSession) return;
    setError(null);
    try {
      const streamId = liveStreams[action.id];
      if (streamId) {
        await invoke('stop_agent_log_stream', { streamId });
        setLiveStreams((streams) => {
          const next = { ...streams };
          delete next[action.id];
          return next;
        });
        return;
      }

      const startedId = await invoke<string>('start_agent_log_stream', {
        agentSessionId: activeSession.id,
        action,
      });
      setLiveStreams((streams) => ({ ...streams, [action.id]: startedId }));
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
          {action.expected_result && <div className="agent-action-expected">{action.expected_result}</div>}
          <code>{payloadLabel(action)}</code>
          <button
            className="settings-btn-outline"
            disabled={action.risk === 'high' || action.risk === 'blocked'}
            onClick={() => void runAction(action)}
            type="button"
          >
            {liveStreams[action.id]
              ? t('agent_action_stop_stream')
              : action.tool === 'stream_log' || action.tool === 'docker_logs'
                ? t('agent_action_start_stream')
                : action.risk === 'read_only'
              ? t('agent_action_run')
              : action.risk === 'high' || action.risk === 'blocked'
                ? t('agent_action_policy_blocked')
                : t('agent_action_review_run')}
          </button>
        </div>
      ))}
    </div>
  );
};
