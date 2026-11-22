import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../../stores/agentStore';
import { useConfirm } from '../../hooks/useConfirm';
import type { AgentToolCall, AgentToolResult } from '../../types/agent';

function payloadLabel(action: AgentToolCall): string {
  if (typeof action.payload.command === 'string') {
    return action.payload.command;
  }
  return JSON.stringify(action.payload);
}

export const AgentActionQueue: React.FC = () => {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const actions = useAgentStore((s) => s.actions);
  const activeSession = useAgentStore((s) => s.activeSession);
  const setError = useAgentStore((s) => s.setError);
  const removeAction = useAgentStore((s) => s.removeAction);
  const [liveStreams, setLiveStreams] = useState<Record<string, string>>({});
  const [runningIds, setRunningIds] = useState<ReadonlySet<string>>(new Set());

  if (actions.length === 0) {
    return <div className="agent-empty">{t('agent_no_actions')}</div>;
  }

  const isObserveOnly = activeSession?.autonomy === 'observe';

  const runAction = async (action: AgentToolCall) => {
    if (runningIds.has(action.id)) return;
    if (action.tool === 'stream_log' || action.tool === 'docker_logs') {
      await toggleLiveStream(action);
      return;
    }
    if (action.risk === 'high' || action.risk === 'blocked') return;
    if (isObserveOnly && action.risk !== 'read_only') return;
    if (action.risk !== 'read_only') {
      const ok = await confirm({
        title: t('agent_action_confirm_title'),
        message: t('agent_action_confirm', { risk: action.risk }),
        danger: true,
        confirmLabel: t('common.confirm'),
        cancelLabel: t('common.cancel'),
      });
      if (!ok) return;
    }
    setError(null);
    setRunningIds((prev) => new Set(prev).add(action.id));
    try {
      const result = await invoke<AgentToolResult>('execute_agent_action', {
        action,
        agentSessionId: activeSession?.id ?? null,
      });
      useAgentStore.getState().pushResult(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setRunningIds((prev) => {
        const next = new Set(prev);
        next.delete(action.id);
        return next;
      });
    }
  };

  const rejectAction = (action: AgentToolCall) => {
    removeAction(action.id);
    useAgentStore.getState().pushResult({
      call_id: action.id,
      ok: false,
      output: '',
      error: t('agent_action_rejected'),
      verification: null,
    });
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
      {actions.map((action) => {
        const isStream = action.tool === 'stream_log' || action.tool === 'docker_logs';
        const observeBlocked = isObserveOnly && !isStream && action.risk !== 'read_only';
        const policyBlocked = action.risk === 'high' || action.risk === 'blocked';
        const isRunning = runningIds.has(action.id);
        return (
          <div className={`agent-action agent-risk-${action.risk}`} key={action.id}>
            <div className="agent-action-tool">{action.tool}</div>
            <div className="agent-action-reason">{action.reason}</div>
            {action.expected_result && (
              <div className="agent-action-expected">{action.expected_result}</div>
            )}
            <code>{payloadLabel(action)}</code>
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <button
                className="settings-btn-outline"
                disabled={policyBlocked || observeBlocked || isRunning}
                onClick={() => void runAction(action)}
                type="button"
              >
                {liveStreams[action.id]
                  ? t('agent_action_stop_stream')
                  : isStream
                    ? t('agent_action_start_stream')
                    : observeBlocked
                      ? t('agent_action_observe_blocked')
                      : action.risk === 'read_only'
                        ? t('agent_action_run')
                        : policyBlocked
                          ? t('agent_action_policy_blocked')
                          : t('agent_action_review_run')}
              </button>
              {!isStream && (
                <button
                  className="settings-btn-outline"
                  disabled={isRunning}
                  onClick={() => rejectAction(action)}
                  type="button"
                >
                  {t('agent_action_reject')}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
