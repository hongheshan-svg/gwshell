import React, { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  AlertTriangle,
  ListTree,
  Network,
  Pause,
  Play,
  RotateCw,
  Server,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useAiChatStore } from '../../stores/aiChatStore';
import type { AgentSessionInfo } from '../../types/agent';
import type { MetricsSnapshot, MetricsErrorPayload } from '../../types/serverMetrics';
import { HostCard } from './HostCard';
import { MetricRingGrid } from './MetricRingGrid';
import { CpuCard } from './CpuCard';
import { MemCard } from './MemCard';
import { DiskCard } from './DiskCard';
import { NetCard } from './NetCard';
import { ProcessList } from './ProcessList';
import { NicList } from './NicList';
import { Sparkline, type SparkSeries } from './Sparkline';
import { fmtBytes } from './format';
import './ServerPanel.css';

const HISTORY_LEN = 60;
const MIN_WIDTH = 380;
const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 424;

type Status = 'loading' | 'ok' | 'error' | 'no-ssh';
type PanelTab = 'overview' | 'processes' | 'network';

function pushHistory(arr: number[], v: number): number[] {
  const next = arr.length >= HISTORY_LEN ? arr.slice(1) : arr.slice();
  next.push(v);
  return next;
}

export const ServerPanel: React.FC = () => {
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;

  const serverPanelOpen = useAppStore((s) => s.serverPanelOpen);
  const toggleServerPanel = useAppStore((s) => s.toggleServerPanel);
  const activeTab = useAppStore((s) => s.tabs.find((tb) => tb.id === s.activeTabId));
  const activeSession = useAppStore((s) =>
    s.sessions.find((sess) => sess.id === s.tabs.find((tb) => tb.id === s.activeTabId)?.sessionId),
  );
  const isSsh = activeTab?.type === 'ssh';
  const sessionId = isSsh ? activeTab.sessionId : null;
  const hostIp = activeSession
    ? `${activeSession.host ?? ''}${activeSession.port ? `:${activeSession.port}` : ''}`
    : '';

  const [snapshot, setSnapshot] = useState<MetricsSnapshot | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>('overview');
  const [paused, setPaused] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [drawerWidth, setDrawerWidth] = useState(DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);

  const cpuHistoryRef = useRef<number[]>([]);
  const memHistoryRef = useRef<number[]>([]);
  const rxHistoryRef = useRef<number[]>([]);
  const txHistoryRef = useRef<number[]>([]);
  const lastSessionRef = useRef<string | null>(null);
  const [, forceRender] = useState(0);

  // Reset history only when switching to a different SSH session.
  useEffect(() => {
    if (lastSessionRef.current !== sessionId) {
      lastSessionRef.current = sessionId;
      setSnapshot(null);
      setErrorBanner(null);
      setPaused(false);
      cpuHistoryRef.current = [];
      memHistoryRef.current = [];
      rxHistoryRef.current = [];
      txHistoryRef.current = [];
    }
  }, [sessionId]);

  useEffect(() => {
    if (!serverPanelOpen) return;
    if (!sessionId) {
      setStatus('no-ssh');
      setSnapshot(null);
      return;
    }
    if (paused) {
      return;
    }

    setStatus((prev) => (prev === 'ok' ? 'ok' : 'loading'));
    setErrorBanner(null);

    let dataUnlisten: UnlistenFn | null = null;
    let errUnlisten: UnlistenFn | null = null;
    let alertAgentUnlisten: UnlistenFn | null = null;
    let cancelled = false;

    void (async () => {
      try {
        dataUnlisten = await listen<MetricsSnapshot>(`server-metrics-${sessionId}`, (evt) => {
          const snap = evt.payload;
          setSnapshot(snap);
          setStatus('ok');
          setErrorBanner(null);
          if (snap.cpu) {
            cpuHistoryRef.current = pushHistory(cpuHistoryRef.current, snap.cpu.total_percent);
          }
          if (snap.mem && snap.mem.mem_total_bytes > 0) {
            const pct = (snap.mem.mem_used_bytes / snap.mem.mem_total_bytes) * 100;
            memHistoryRef.current = pushHistory(memHistoryRef.current, pct);
          }
          if (snap.net) {
            rxHistoryRef.current = pushHistory(rxHistoryRef.current, snap.net.rx_bytes_per_sec);
            txHistoryRef.current = pushHistory(txHistoryRef.current, snap.net.tx_bytes_per_sec);
          }
          forceRender((n) => n + 1);
        });

        errUnlisten = await listen<MetricsErrorPayload>(
          `server-metrics-error-${sessionId}`,
          (evt) => {
            const p = evt.payload;
            setStatus('error');
            if (p.reason === 'unsupported')
              setErrorBanner(tRef.current('serverPanel_status_unsupported'));
            else if (p.reason === 'timeout')
              setErrorBanner(tRef.current('serverPanel_status_timeout'));
            else setErrorBanner(tRef.current('serverPanel_status_disconnected'));
          },
        );

        alertAgentUnlisten = await listen<AgentSessionInfo>(
          `agent-alert-auto-started-${sessionId}`,
          (evt) => {
            const appState = useAppStore.getState();
            const tabKey =
              appState.tabs.find((tb) => tb.sessionId === sessionId)?.id ?? appState.activeTabId;
            const chatStore = useAiChatStore.getState();
            chatStore.setMode('agent');
            if (tabKey && evt.payload.objective) {
              chatStore.setDraft(tabKey, evt.payload.objective);
            }
            if (!appState.agentPanelOpen) {
              appState.toggleAgentPanel();
            }
          },
        );

        if (cancelled) {
          dataUnlisten();
          errUnlisten();
          alertAgentUnlisten();
          dataUnlisten = null;
          errUnlisten = null;
          alertAgentUnlisten = null;
          return;
        }

        await invoke('start_server_metrics', { sessionId });
      } catch (e) {
        if (cancelled) return;
        setStatus('error');
        setErrorBanner(String(e));
      }
    })();

    return () => {
      cancelled = true;
      if (dataUnlisten) dataUnlisten();
      if (errUnlisten) errUnlisten();
      if (alertAgentUnlisten) alertAgentUnlisten();
      invoke('stop_server_metrics', { sessionId }).catch(() => {});
    };
  }, [serverPanelOpen, sessionId, paused, retryNonce]);

  const cpuMemSeries: SparkSeries[] = useMemo(
    () => [
      { label: t('serverPanel_net_legend_cpu'), color: '#3b82f6', data: cpuHistoryRef.current },
      { label: t('serverPanel_net_legend_mem'), color: '#10b981', data: memHistoryRef.current },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ref arrays mutate on each snapshot
    [t, snapshot?.collected_at],
  );

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = drawerWidth;
    setResizing(true);

    const onMove = (ev: MouseEvent) => {
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW + (startX - ev.clientX)));
      setDrawerWidth(next);
    };
    const onUp = () => {
      setResizing(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleAskAiDiagnose = () => {
    if (!snapshot) return;
    const appState = useAppStore.getState();
    const tabKey =
      (sessionId ? appState.tabs.find((tb) => tb.sessionId === sessionId)?.id : null) ??
      appState.activeTabId ??
      'global';
    const cpuSummary = snapshot.cpu ? `${snapshot.cpu.total_percent.toFixed(1)}%` : 'N/A';
    const memSummary =
      snapshot.mem && snapshot.mem.mem_total_bytes > 0
        ? `${fmtBytes(snapshot.mem.mem_used_bytes)}/${fmtBytes(snapshot.mem.mem_total_bytes)} (${((snapshot.mem.mem_used_bytes / snapshot.mem.mem_total_bytes) * 100).toFixed(1)}%)`
        : 'N/A';
    const diskSummary =
      snapshot.disk && snapshot.disk.total_bytes > 0
        ? `${fmtBytes(snapshot.disk.used_bytes)}/${fmtBytes(snapshot.disk.total_bytes)} (${((snapshot.disk.used_bytes / snapshot.disk.total_bytes) * 100).toFixed(1)}%)`
        : 'N/A';
    const topProcs = (snapshot.procs ?? [])
      .slice(0, 5)
      .map((p) => `${p.comm}(${p.cpu_percent.toFixed(1)}%)`)
      .join(', ');
    const hostLabel =
      hostIp.trim().length > 0
        ? hostIp
        : snapshot.host?.hostname && snapshot.host.hostname.length > 0
          ? snapshot.host.hostname
          : 'remote';
    const osLabel =
      snapshot.host?.os_pretty && snapshot.host.os_pretty.length > 0
        ? snapshot.host.os_pretty
        : snapshot.host?.kernel && snapshot.host.kernel.length > 0
          ? snapshot.host.kernel
          : 'unknown';
    const prompt = t('serverPanel_ai_diagnose_prompt', {
      host: hostLabel,
      os: osLabel,
      cpu: cpuSummary,
      mem: memSummary,
      disk: diskSummary,
      procs: topProcs.length > 0 ? topProcs : 'none',
    });

    const chatStore = useAiChatStore.getState();
    chatStore.setMode('agent');
    chatStore.setDraft(tabKey, prompt);
    if (!appState.agentPanelOpen) {
      appState.toggleAgentPanel();
    }
  };

  if (!serverPanelOpen) return null;

  const greyed = status === 'error';
  const procCount = snapshot?.procs?.length ?? 0;
  const nicCount = snapshot?.nics?.length ?? 0;
  const latestCpu = snapshot?.cpu ? `${snapshot.cpu.total_percent.toFixed(1)}%` : '—';
  const latestMem =
    snapshot?.mem && snapshot.mem.mem_total_bytes > 0
      ? `${((snapshot.mem.mem_used_bytes / snapshot.mem.mem_total_bytes) * 100).toFixed(1)}%`
      : '—';

  return (
    <div
      className={`sp-drawer${resizing ? ' is-resizing' : ''}`}
      style={{ width: `${drawerWidth}px` }}
      role="dialog"
      aria-label={t('serverPanel_title')}
    >
      <div
        className="sp-resize-handle"
        onMouseDown={handleResizeStart}
        role="separator"
        aria-orientation="vertical"
      />

      {/* Header */}
      <div className="sp-header">
        <div className="sp-header__left">
          <div className="sp-header__emblem">
            <Activity size={14} />
          </div>
          <span className="sp-header__title">{t('serverPanel_title')}</span>
          {status === 'ok' && !paused && (
            <span className="sp-live-pill is-live">
              <span className="sp-live-dot" />
              {t('serverPanel_status_live')}
            </span>
          )}
          {paused && status !== 'no-ssh' && (
            <span className="sp-live-pill is-paused">{t('serverPanel_status_paused')}</span>
          )}
        </div>

        <div className="sp-header__actions">
          {snapshot && (
            <button
              type="button"
              className="sp-icon-btn sp-icon-btn--ai"
              onClick={handleAskAiDiagnose}
              title={t('serverPanel_ask_ai')}
            >
              <Sparkles size={13} />
            </button>
          )}
          {sessionId && status !== 'error' && (
            <button
              type="button"
              className="sp-icon-btn"
              onClick={() => setPaused((p) => !p)}
              title={paused ? t('serverPanel_resume') : t('serverPanel_pause')}
            >
              {paused ? <Play size={13} /> : <Pause size={13} />}
            </button>
          )}
          <button
            type="button"
            className="sp-icon-btn"
            onClick={toggleServerPanel}
            title={t('serverPanel_close')}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Empty: Not on an SSH Tab */}
      {status === 'no-ssh' ? (
        <div className="sp-center-state">
          <div className="sp-center-icon">
            <Server size={22} />
          </div>
          <div className="sp-center-title">{t('serverPanel_status_no_ssh')}</div>
          <div className="sp-center-desc">{t('serverPanel_ssh_only')}</div>
        </div>
      ) : (
        <>
          {/* Host Hero Banner (always pinned above tabs once connected) */}
          <div className="sp-pinned-top">
            <HostCard host={snapshot?.host ?? null} hostIp={hostIp} />

            {/* Segmented Tab Bar */}
            <div className="sp-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={panelTab === 'overview'}
                className={`sp-tab-btn${panelTab === 'overview' ? ' is-active' : ''}`}
                onClick={() => setPanelTab('overview')}
              >
                <TrendingUp size={12} />
                <span>{t('serverPanel_tab_overview')}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={panelTab === 'processes'}
                className={`sp-tab-btn${panelTab === 'processes' ? ' is-active' : ''}`}
                onClick={() => setPanelTab('processes')}
              >
                <ListTree size={12} />
                <span>{t('serverPanel_tab_processes')}</span>
                {procCount > 0 && <span className="sp-tab-count">{procCount}</span>}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={panelTab === 'network'}
                className={`sp-tab-btn${panelTab === 'network' ? ' is-active' : ''}`}
                onClick={() => setPanelTab('network')}
              >
                <Network size={12} />
                <span>{t('serverPanel_tab_network')}</span>
                {nicCount > 0 && <span className="sp-tab-count">{nicCount}</span>}
              </button>
            </div>
          </div>

          {/* Inline Error Banner with Retry */}
          {errorBanner && (
            <div className="sp-banner sp-banner--error">
              <AlertTriangle size={14} />
              <span className="sp-banner__text">{errorBanner}</span>
              <button
                type="button"
                className="sp-retry-btn"
                onClick={() => {
                  setPaused(false);
                  setRetryNonce((n) => n + 1);
                }}
              >
                <RotateCw size={11} />
                <span>{t('serverPanel_retry')}</span>
              </button>
            </div>
          )}

          {/* Loading pulse bar on initial probe */}
          {status === 'loading' && !snapshot && (
            <div className="sp-banner sp-banner--info">
              <span className="sp-live-dot" />
              <span>{t('serverPanel_status_loading')}</span>
            </div>
          )}

          {/* Scrollable Tab Body */}
          <div className={`sp-body${greyed ? ' sp-body--greyed' : ''}`}>
            {panelTab === 'overview' && (
              <>
                <MetricRingGrid
                  host={snapshot?.host ?? null}
                  cpu={snapshot?.cpu ?? null}
                  mem={snapshot?.mem ?? null}
                  disk={snapshot?.disk ?? null}
                  net={snapshot?.net ?? null}
                />

                {/* Dedicated CPU & Memory % Trend Chart (fixed 0-100% scale) */}
                <div className="sp-card">
                  <div className="sp-card__header">
                    <div className="sp-card__title">
                      <span className="sp-card__icon sp-card__icon--cpu">
                        <TrendingUp size={12} />
                      </span>
                      <span>{t('serverPanel_chart_cpu_mem')}</span>
                    </div>
                    <div className="sp-inline-legend">
                      <span className="sp-legend-pill">
                        <i className="sp-dot" style={{ backgroundColor: '#3b82f6' }} />
                        <span>{t('serverPanel_net_legend_cpu')}</span>
                        <strong>{latestCpu}</strong>
                      </span>
                      <span className="sp-legend-pill">
                        <i className="sp-dot" style={{ backgroundColor: '#10b981' }} />
                        <span>{t('serverPanel_net_legend_mem')}</span>
                        <strong>{latestMem}</strong>
                      </span>
                    </div>
                  </div>
                  <div className="sp-chart-wrap">
                    <Sparkline
                      series={cpuMemSeries}
                      width={360}
                      height={84}
                      fixedMax={100}
                      className="sp-sparkline"
                    />
                  </div>
                </div>

                <CpuCard cpu={snapshot?.cpu ?? null} />
                <MemCard mem={snapshot?.mem ?? null} />
                <DiskCard disk={snapshot?.disk ?? null} />
              </>
            )}

            {panelTab === 'processes' && (
              <ProcessList sessionId={sessionId ?? ''} procs={snapshot?.procs ?? null} />
            )}

            {panelTab === 'network' && (
              <>
                <NetCard
                  net={snapshot?.net ?? null}
                  rxHistory={rxHistoryRef.current}
                  txHistory={txHistoryRef.current}
                />
                <NicList nics={snapshot?.nics ?? null} />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
};
