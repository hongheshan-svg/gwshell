import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Server } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import type { SessionConfig } from '../../types';
import { HostDashCard } from './HostDashCard';
import './AssetDashboard.css';

interface Props {
  sessions: SessionConfig[];       // already filtered (pass filteredSessions)
  onConnect: (s: SessionConfig) => void;
  onEdit: (s: SessionConfig) => void;
}

const UNGROUPED_SENTINEL = '__ungrouped__';

export const AssetDashboard: React.FC<Props> = ({ sessions, onConnect, onEdit }) => {
  const { t } = useTranslation('gwshell');
  const tabs = useAppStore((s) => s.tabs);
  const setActiveTab = useAppStore((s) => s.setActiveTab);

  // Build a set of connected sessionIds (ssh tabs that are connected)
  const connectedMap = useMemo(() => {
    const m: Record<string, boolean> = {};
    tabs.forEach((tt) => {
      if (tt.type === 'ssh' && tt.connected) {
        m[tt.sessionId] = true;
      }
    });
    return m;
  }, [tabs]);

  // Group sessions by session.group (preserving insertion order)
  const groups = useMemo(() => {
    const map = new Map<string, SessionConfig[]>();
    sessions.forEach((s) => {
      const key = s.group?.trim() || UNGROUPED_SENTINEL;
      const existing = map.get(key);
      if (existing) {
        existing.push(s);
      } else {
        map.set(key, [s]);
      }
    });
    return map;
  }, [sessions]);

  const onFocus = (s: SessionConfig) => {
    const tab = tabs.find((tt) => tt.sessionId === s.id);
    if (tab) setActiveTab(tab.id);
  };

  // Empty state
  if (sessions.length === 0) {
    return (
      <div className="asset-dash-empty">
        <div className="asset-empty-content">
          <Server size={32} />
          <p>{t('table_empty', 'No sessions yet')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="asset-dash-scroll">
      {Array.from(groups.entries()).map(([groupName, groupSessions]) => (
        <div key={groupName} className="dash-group">
          {(groups.size > 1 || groupName !== UNGROUPED_SENTINEL) && (
            <div className="dash-group-title">
              {groupName === UNGROUPED_SENTINEL
                ? t('dash_ungrouped', 'Ungrouped')
                : groupName}
            </div>
          )}
          <div className="dash-grid">
            {groupSessions.map((s) => (
              <HostDashCard
                key={s.id}
                session={s}
                connected={!!connectedMap[s.id]}
                latency={s.latency}
                onConnect={onConnect}
                onEdit={onEdit}
                onFocus={onFocus}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default AssetDashboard;
