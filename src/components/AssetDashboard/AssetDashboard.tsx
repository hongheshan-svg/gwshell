import React, { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import { Server } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import type { SessionConfig } from '../../types';
import type { MetricsSnapshot } from '../../types/serverMetrics';
import { HostDashCard } from './HostDashCard';
import './AssetDashboard.css';

interface Props {
  sessions: SessionConfig[];       // already filtered (pass filteredSessions)
  onConnect: (s: SessionConfig) => void;
  onEdit: (s: SessionConfig) => void;
}

const UNGROUPED_SENTINEL = '__ungrouped__';
const CPU_HIST_LEN = 40;
const TICK_THROTTLE_MS = 800;

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

  // Derive stable sorted list of connected ssh sessionIds
  const connectedSessionIds = useMemo(() => {
    return tabs
      .filter((tt) => tt.type === 'ssh' && tt.connected)
      .map((tt) => tt.sessionId)
      .filter((id, idx, arr) => arr.indexOf(id) === idx) // dedupe
      .sort();
  }, [tabs]);

  // Use a stable joined string as effect dep to avoid churn on array identity
  const connectedIdsKey = connectedSessionIds.join(',');

  // Snapshots + history in refs to avoid re-renders from within listeners
  const snapshotsRef = useRef<Record<string, MetricsSnapshot>>({});
  const cpuHistRef   = useRef<Record<string, number[]>>({});

  // Throttled force-render (mirrors ServerPanel pattern)
  const [, setTick] = useState(0);
  const tickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTickRef  = useRef<number>(0);

  const scheduleTick = () => {
    const now = Date.now();
    if (now - lastTickRef.current >= TICK_THROTTLE_MS) {
      lastTickRef.current = now;
      setTick((n) => n + 1);
    } else if (!tickTimerRef.current) {
      const delay = TICK_THROTTLE_MS - (now - lastTickRef.current);
      tickTimerRef.current = setTimeout(() => {
        tickTimerRef.current = null;
        lastTickRef.current = Date.now();
        setTick((n) => n + 1);
      }, delay);
    }
  };

  // Per-id teardown function (covers both sync and async-in-flight cases)
  const teardownRef = useRef<Record<string, () => void>>({});
  // Track which ids are currently subscribed
  const subscribedRef = useRef<Set<string>>(new Set());

  const teardownId = (id: string) => {
    const fn = teardownRef.current[id];
    if (fn) {
      fn();
      delete teardownRef.current[id];
    }
    subscribedRef.current.delete(id);
    delete snapshotsRef.current[id];
    delete cpuHistRef.current[id];
    invoke('stop_server_metrics', { sessionId: id }).catch(() => {});
  };

  useEffect(() => {
    const currentIds = new Set(connectedSessionIds);

    // --- Tear down ids that are no longer connected ---
    for (const id of Array.from(subscribedRef.current)) {
      if (!currentIds.has(id)) {
        teardownId(id);
      }
    }

    // --- Subscribe to ids not yet subscribed ---
    for (const id of connectedSessionIds) {
      if (subscribedRef.current.has(id)) continue;
      subscribedRef.current.add(id);

      // Init history array
      if (!cpuHistRef.current[id]) cpuHistRef.current[id] = [];

      // Mutable teardown state captured by the IIFE and the cancel fn
      let dataUnlisten: UnlistenFn | null = null;
      let errUnlisten: UnlistenFn | null = null;
      let cancelled = false;

      // Register a teardown that works even if async setup is still in flight
      teardownRef.current[id] = () => {
        cancelled = true;
        if (dataUnlisten) { dataUnlisten(); dataUnlisten = null; }
        if (errUnlisten)  { errUnlisten();  errUnlisten  = null; }
      };

      (async () => {
        try {
          const dl = await listen<MetricsSnapshot>(
            `server-metrics-${id}`,
            (evt) => {
              const snap = evt.payload;
              snapshotsRef.current[id] = snap;

              // Push cpu history
              const cpuPct = snap.cpu?.total_percent;
              if (cpuPct !== undefined) {
                const hist = cpuHistRef.current[id] ?? [];
                const next = hist.length >= CPU_HIST_LEN ? hist.slice(1) : hist.slice();
                next.push(cpuPct);
                cpuHistRef.current[id] = next;
              }

              scheduleTick();
            }
          );

          const el = await listen(
            `server-metrics-error-${id}`,
            (_evt) => {
              // Clear snapshot so the card falls back to connected-but-no-data view
              delete snapshotsRef.current[id];
              scheduleTick();
            }
          );

          if (cancelled) {
            // Teardown already fired during setup — clean up immediately
            dl();
            el();
            return;
          }

          // Wire into the teardown ref so later calls to teardownId() work
          dataUnlisten = dl;
          errUnlisten  = el;

          // Start backend poller (ref-counted; safe if drawer also watching)
          await invoke('start_server_metrics', { sessionId: id });
        } catch {
          // Ignore — session already gone, invoke failed, etc.
        }
      })();
    }

    // Effect cleanup only needs to clear the throttle timer; full subscriber
    // teardown happens in the unmount effect below.
    return () => {
      if (tickTimerRef.current) {
        clearTimeout(tickTimerRef.current);
        tickTimerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedIdsKey]);

  // On component unmount: stop all remaining subscriptions
  useEffect(() => {
    return () => {
      if (tickTimerRef.current) {
        clearTimeout(tickTimerRef.current);
        tickTimerRef.current = null;
      }
      for (const id of Array.from(subscribedRef.current)) {
        teardownId(id);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            {groupSessions.map((s) => {
              const isConn = !!connectedMap[s.id];
              return (
                <HostDashCard
                  key={s.id}
                  session={s}
                  connected={isConn}
                  snapshot={isConn ? snapshotsRef.current[s.id] ?? null : null}
                  cpuHistory={cpuHistRef.current[s.id]}
                  latency={s.latency}
                  onConnect={onConnect}
                  onEdit={onEdit}
                  onFocus={onFocus}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

export default AssetDashboard;
