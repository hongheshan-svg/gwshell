import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import { useAgentStore } from '../../stores/agentStore';
import type { AgentSessionInfo } from '../../types/agent';

export const AgentSessionList: React.FC = () => {
  const { t } = useTranslation();
  const activeTab = useAppStore((s) => s.tabs.find((tab) => tab.id === s.activeTabId));
  const activeSession = useAgentStore((s) => s.activeSession);
  const setActiveSession = useAgentStore((s) => s.setActiveSession);
  const [query, setQuery] = useState('');
  const [onlyCurrent, setOnlyCurrent] = useState(true);
  const [sessions, setSessions] = useState<AgentSessionInfo[]>([]);

  useEffect(() => {
    invoke<AgentSessionInfo[]>('list_agent_sessions')
      .then(setSessions)
      .catch(() => setSessions([]));
  }, [activeSession?.id, activeSession?.status]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sessions.filter((session) => {
      if (onlyCurrent && activeTab?.sessionId && session.target_session_id !== activeTab.sessionId) return false;
      if (!q) return true;
      return `${session.objective} ${session.status} ${session.target_session_id}`.toLowerCase().includes(q);
    });
  }, [activeTab?.sessionId, onlyCurrent, query, sessions]);

  return (
    <div className="agent-history">
      <div className="agent-section-title">{t('agent_sessions')}</div>
      <div className="agent-session-filter">
        <input
          className="agent-session-filter-input"
          placeholder={t('agent_sessions_search')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          className={`agent-policy-toggle ${onlyCurrent ? 'on' : ''}`}
          onClick={() => setOnlyCurrent((value) => !value)}
          type="button"
        >
          {t('agent_sessions_current')}
        </button>
      </div>
      {filtered.length === 0 ? (
        <div className="agent-empty">{t('agent_sessions_empty')}</div>
      ) : (
        filtered.slice(0, 8).map((session) => (
          <button
            className={`agent-session-list-item ${activeSession?.id === session.id ? 'active' : ''}`}
            key={session.id}
            onClick={() => setActiveSession(session)}
            type="button"
          >
            <span>{session.status}</span>
            {session.objective}
          </button>
        ))
      )}
    </div>
  );
};
