import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import type {
  MetricsSnapshot,
  MetricsErrorPayload,
} from '../../types/serverMetrics';
import { HostCard } from './HostCard';
import { CpuCard } from './CpuCard';
import { MemCard } from './MemCard';
import { NetCard } from './NetCard';
import { ProcessList } from './ProcessList';
import { NicList } from './NicList';
import './ServerPanel.css';

const HISTORY_LEN = 60;

type Status = 'loading' | 'ok' | 'error' | 'no-ssh';

function pushHistory(arr: number[], v: number): number[] {
  const next = arr.length >= HISTORY_LEN ? arr.slice(1) : arr.slice();
  next.push(v);
  return next;
}

export const ServerPanel: React.FC = () => {
  const { t } = useTranslation();
  // Keep the latest `t` without letting the metrics subscription depend on it.
  // i18next hands back a new `t` reference on every language switch; if the
  // effect below depended on `t`, toggling en/zh would tear down the backend
  // metrics task, restart it (a fresh SSH probe), and discard sparkline history.
  const tRef = useRef(t);
  tRef.current = t;
  const { serverPanelOpen, toggleServerPanel, tabs, activeTabId, sessions } = useAppStore();

  const activeTab = tabs.find((tt) => tt.id === activeTabId);
  const activeSession = sessions.find((s) => s.id === activeTab?.sessionId);
  const isSsh = activeTab?.type === 'ssh';
  const sessionId = isSsh ? activeTab!.sessionId : null;
  const hostIp = activeSession ? `${activeSession.host ?? ''}${activeSession.port ? `:${activeSession.port}` : ''}` : '';

  const [snapshot, setSnapshot] = useState<MetricsSnapshot | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const cpuHistoryRef = useRef<number[]>([]);
  const memHistoryRef = useRef<number[]>([]);
  const rxHistoryRef = useRef<number[]>([]);
  const txHistoryRef = useRef<number[]>([]);
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (!serverPanelOpen) return;
    if (!sessionId) {
      setStatus('no-ssh');
      setSnapshot(null);
      return;
    }

    setStatus('loading');
    setSnapshot(null);
    setErrorBanner(null);
    cpuHistoryRef.current = [];
    memHistoryRef.current = [];
    rxHistoryRef.current = [];
    txHistoryRef.current = [];

    let dataUnlisten: UnlistenFn | null = null;
    let errUnlisten: UnlistenFn | null = null;
    let cancelled = false;

    (async () => {
      try {
        dataUnlisten = await listen<MetricsSnapshot>(
          `server-metrics-${sessionId}`,
          (evt) => {
            const snap = evt.payload;
            setSnapshot(snap);
            setStatus('ok');
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
          }
        );

        errUnlisten = await listen<MetricsErrorPayload>(
          `server-metrics-error-${sessionId}`,
          (evt) => {
            const p = evt.payload;
            setStatus('error');
            if (p.reason === 'unsupported') setErrorBanner(tRef.current('serverPanel_status_unsupported'));
            else if (p.reason === 'timeout') setErrorBanner(tRef.current('serverPanel_status_timeout'));
            else setErrorBanner(tRef.current('serverPanel_status_disconnected'));
          }
        );

        if (cancelled) {
          dataUnlisten();
          errUnlisten();
          dataUnlisten = null;
          errUnlisten = null;
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
      invoke('stop_server_metrics', { sessionId }).catch(() => {});
    };
  }, [serverPanelOpen, sessionId]);

  if (!serverPanelOpen) return null;

  const greyed = status === 'error';

  return (
    <div className="sp-drawer" role="dialog" aria-label={t('serverPanel_title')}>
      <div className="sp-header">
        <div className="sp-header__title">{t('serverPanel_title')}</div>
        <button className="sp-header__close" onClick={toggleServerPanel} title={t('serverPanel_close')}>
          <X size={16} />
        </button>
      </div>

      {status === 'no-ssh' && (
        <div className="sp-banner sp-banner--info">{t('serverPanel_status_no_ssh')}</div>
      )}
      {status === 'loading' && (
        <div className="sp-banner sp-banner--info">{t('serverPanel_status_loading')}</div>
      )}
      {errorBanner && (
        <div className="sp-banner sp-banner--error">{errorBanner}</div>
      )}

      <div className={`sp-body ${greyed ? 'sp-body--greyed' : ''}`}>
        {status !== 'no-ssh' && (
          <>
            <HostCard host={snapshot?.host ?? null} hostIp={hostIp} />
            <CpuCard cpu={snapshot?.cpu ?? null} />
            <MemCard mem={snapshot?.mem ?? null} />
            <NetCard
              net={snapshot?.net ?? null}
              cpuHistory={cpuHistoryRef.current}
              memHistory={memHistoryRef.current}
              rxHistory={rxHistoryRef.current}
              txHistory={txHistoryRef.current}
            />
            <ProcessList sessionId={sessionId ?? ''} procs={snapshot?.procs ?? null} />
            <NicList nics={snapshot?.nics ?? null} />
          </>
        )}
      </div>
    </div>
  );
};
