import React, { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import { Server, Zap, FileInput, Search, ArrowRight, Upload } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useLatencyStore } from '../../stores/latencyStore';
import { parseQuickConnect } from '../../lib/quickConnect';
import { focusTerminalTab } from '../../lib/terminalLifecycle';
import type { SessionConfig } from '../../types';
import type { MetricsSnapshot } from '../../types/serverMetrics';
import { ProtocolIcon } from '../Icons/BrandIcons';
import { HostDashCard } from './HostDashCard';
import './AssetDashboard.css';

interface Props {
  sessions: SessionConfig[]; // already filtered (pass filteredSessions)
  hasAnySessions?: boolean;
  onClearSearch?: () => void;
  onConnect: (s: SessionConfig) => void;
  onEdit: (s: SessionConfig) => void;
  onContextMenu?: (e: React.MouseEvent, s: SessionConfig) => void;
}

const UNGROUPED_SENTINEL = '__ungrouped__';
const CPU_HIST_LEN = 40;
const TICK_THROTTLE_MS = 800;

export const AssetDashboard: React.FC<Props> = ({
  sessions,
  hasAnySessions = false,
  onClearSearch,
  onConnect,
  onEdit,
  onContextMenu,
}) => {
  const { t } = useTranslation('gwshell');
  const tabs = useAppStore((s) => s.tabs);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const latencyById = useLatencyStore((s) => s.latency);

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
  const cpuHistRef = useRef<Record<string, number[]>>({});

  // Throttled force-render (mirrors ServerPanel pattern)
  const [, setTick] = useState(0);
  const tickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTickRef = useRef<number>(0);

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
        if (dataUnlisten) {
          dataUnlisten();
          dataUnlisten = null;
        }
        if (errUnlisten) {
          errUnlisten();
          errUnlisten = null;
        }
      };

      void (async () => {
        try {
          const dl = await listen<MetricsSnapshot>(`server-metrics-${id}`, (evt) => {
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
          });

          const el = await listen(`server-metrics-error-${id}`, (_evt) => {
            // Clear snapshot so the card falls back to connected-but-no-data view
            delete snapshotsRef.current[id];
            scheduleTick();
          });

          if (cancelled) {
            // Teardown already fired during setup — clean up immediately
            dl();
            el();
            return;
          }

          // Wire into the teardown ref so later calls to teardownId() work
          dataUnlisten = dl;
          errUnlisten = el;

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
      // subscribedRef.current is stable across renders; reading it in the
      // unmount cleanup is safe without listing it as a dependency.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      for (const id of Array.from(subscribedRef.current)) {
        teardownId(id);
      }
    };
  }, []);

  // Group sessions by session.group (preserving insertion order)
  const groups = useMemo(() => {
    const map = new Map<string, SessionConfig[]>();
    sessions.forEach((s) => {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
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
    if (tab) {
      setActiveTab(tab.id);
      focusTerminalTab(tab.id);
    }
  };

  // Empty state: distinguish "search yielded nothing" from true first-run empty.
  if (sessions.length === 0) {
    if (hasAnySessions) {
      return (
        <div className="asset-dash-empty">
          <div className="asset-no-matches">
            <Search size={26} />
            <p>{t('table_no_matches')}</p>
            {onClearSearch && (
              <button type="button" className="settings-btn-outline" onClick={onClearSearch}>
                {t('table_clear_search')}
              </button>
            )}
          </div>
        </div>
      );
    }
    return <EmptyStateCtas />;
  }

  return (
    <div className="asset-dash-scroll">
      {Array.from(groups.entries()).map(([groupName, groupSessions]) => (
        <div key={groupName} className="dash-group">
          {(groups.size > 1 || groupName !== UNGROUPED_SENTINEL) && (
            <div className="dash-group-title">
              <span>
                {groupName === UNGROUPED_SENTINEL ? t('dash_ungrouped', 'Ungrouped') : groupName}
              </span>
              <span className="dash-group-count">{groupSessions.length}</span>
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
                  snapshot={isConn ? (snapshotsRef.current[s.id] ?? null) : null}
                  cpuHistory={cpuHistRef.current[s.id]}
                  latency={latencyById[s.id]}
                  onConnect={onConnect}
                  onEdit={onEdit}
                  onFocus={onFocus}
                  onContextMenu={onContextMenu}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

/** First-run Wave/Warp Quick Launch Hero: instant command bar + 3 action cards. */
export const EmptyStateCtas: React.FC = () => {
  const { t } = useTranslation('gwshell');
  const setShowNewSession = useAppStore((s) => s.setShowNewSession);
  const setShowLocalTerminalModal = useAppStore((s) => s.setShowLocalTerminalModal);
  const setSessions = useAppStore((s) => s.setSessions);
  const addTemporarySession = useAppStore((s) => s.addTemporarySession);
  const addTab = useAppStore((s) => s.addTab);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [quickInput, setQuickInput] = useState('');

  const handleQuickLaunch = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = quickInput.trim().replace(/^ssh\s+/i, '');
    const parsed = parseQuickConnect(cleaned);
    if (!parsed) return;
    const sessionId = crypto.randomUUID();
    const label = parsed.username ? `${parsed.username}@${parsed.host}` : parsed.host;
    addTemporarySession({
      id: sessionId,
      name: label,
      session_type: 'ssh',
      host: parsed.host,
      port: parsed.port,
      username: parsed.username ?? 'root',
      auth_method: 'agent',
      _temporary: true,
    });
    addTab({
      id: crypto.randomUUID(),
      sessionId,
      title: label,
      type: 'ssh',
      connected: false,
    });
    setQuickInput('');
  };

  const handleImportSshConfig = async () => {
    setImportMsg(null);
    try {
      const count = await invoke<number>('import_ssh_config', { path: null });
      setSessions(await invoke<SessionConfig[]>('get_sessions'));
      setImportMsg(t('settings_storage_imported', { count }));
    } catch (e) {
      setImportMsg(t('settings_storage_failed', { msg: String(e) }));
    }
  };

  const handleImportBackupFile = async () => {
    setImportMsg(null);
    try {
      const path = await dialogOpen({
        title: t('asset_io_import_file'),
        multiple: false,
        filters: [
          { name: 'GWShell Assets (JSON / CSV)', extensions: ['json', 'csv'] },
          { name: 'JSON', extensions: ['json'] },
          { name: 'CSV', extensions: ['csv'] },
        ],
      });
      if (typeof path !== 'string' || !path) return;
      const count = await invoke<number>('import_sessions_data', { path });
      setSessions(await invoke<SessionConfig[]>('get_sessions'));
      setImportMsg(t('settings_storage_imported', { count }));
    } catch (e) {
      setImportMsg(t('settings_storage_failed', { msg: String(e) }));
    }
  };

  return (
    <div className="asset-dash-empty">
      <div className="asset-empty-content">
        <div className="empty-hero-icon" aria-hidden="true">
          <Server size={24} />
        </div>
        <h3 className="empty-hero-title">{t('table_empty', 'No sessions yet')}</h3>
        <p className="empty-hero-subtitle">{t('empty_cta_subtitle')}</p>

        {/* Wave / Warp inline command-first quick connect bar */}
        <form className="empty-quick-bar" onSubmit={handleQuickLaunch}>
          <span className="empty-quick-prompt" aria-hidden="true">
            $
          </span>
          <input
            type="text"
            className="empty-quick-input"
            value={quickInput}
            onChange={(e) => setQuickInput(e.target.value)}
            placeholder="ssh root@192.168.1.10:22"
            spellCheck={false}
          />
          <button type="submit" className="empty-quick-btn" disabled={!quickInput.trim()}>
            <Zap size={13} />
            <span>{t('dash_connect')}</span>
            <ArrowRight size={13} />
          </button>
        </form>

        <div className="empty-cta-row">
          <button type="button" className="empty-cta-card" onClick={() => setShowNewSession(true)}>
            <span className="empty-cta-icon">
              <ProtocolIcon type="ssh" size={20} />
            </span>
            <span>{t('newasset_ssh')}</span>
            <span className="empty-cta-desc">{t('empty_cta_ssh_desc')}</span>
          </button>
          <button
            type="button"
            className="empty-cta-card"
            onClick={() => setShowLocalTerminalModal(true)}
          >
            <span className="empty-cta-icon empty-cta-icon--local">
              <ProtocolIcon type="localshell" size={20} />
            </span>
            <span>{t('newasset_localshell')}</span>
            <span className="empty-cta-desc">{t('empty_cta_local_desc')}</span>
          </button>
          <button
            type="button"
            className="empty-cta-card"
            onClick={() => {
              void handleImportSshConfig();
            }}
          >
            <span className="empty-cta-icon empty-cta-icon--import">
              <FileInput size={16} />
            </span>
            <span>{t('empty_cta_import')}</span>
            <span className="empty-cta-desc">{t('empty_cta_import_desc')}</span>
          </button>
        </div>
        <button
          type="button"
          className="empty-restore-link"
          onClick={() => {
            void handleImportBackupFile();
          }}
        >
          <Upload size={12} />
          <span>{t('asset_io_empty_restore')}</span>
        </button>
        {importMsg && <p className="empty-cta-msg">{importMsg}</p>}
      </div>
    </div>
  );
};

export default AssetDashboard;
