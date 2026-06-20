import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import { useAgentStore } from '../../stores/agentStore';
import { subscribeAgentEvents } from '../../lib/agentEvents';
import type { AgentSessionInfo } from '../../types/agent';

export const AgentObjective: React.FC = () => {
  const { t } = useTranslation();
  const [objective, setObjective] = useState('');
  const [busy, setBusy] = useState(false);
  const activeTab = useAppStore((s) => s.tabs.find((tab) => tab.id === s.activeTabId));
  const setActiveSession = useAgentStore((s) => s.setActiveSession);
  const setError = useAgentStore((s) => s.setError);
  const unlistenersRef = useRef<UnlistenFn[]>([]);

  const clearSubscriptions = () => {
    for (const unlisten of unlistenersRef.current) {
      unlisten();
    }
    unlistenersRef.current = [];
  };

  useEffect(() => clearSubscriptions, []);

  const start = async () => {
    if (!activeTab || activeTab.type !== 'ssh' || !activeTab.connected) {
      setError(t('agent_requires_connected_ssh'));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      clearSubscriptions();
      const session = await invoke<AgentSessionInfo>('start_agent_session', {
        request: {
          target_session_id: activeTab.sessionId,
          objective,
          autonomy: 'recommend',
        },
      });
      setActiveSession(session);
      unlistenersRef.current = await subscribeAgentEvents(session.id);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="agent-objective">
      <textarea
        className="agent-objective-input"
        value={objective}
        onChange={(e) => setObjective(e.target.value)}
        placeholder={t('agent_objective_placeholder')}
      />
      <button className="settings-btn-primary" onClick={start} disabled={busy || !objective.trim()} type="button">
        {t('agent_start')}
      </button>
    </div>
  );
};
