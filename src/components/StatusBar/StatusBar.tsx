import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Wifi, Clock, Monitor, Radio } from 'lucide-react';
import { getVersion } from '@tauri-apps/api/app';
import { useAppStore } from '../../stores/appStore';

export const StatusBar: React.FC = () => {
  // Fine-grained selectors: avoid re-rendering on every ping latency update
  // (batchUpdateLatency replaces the `sessions` array reference each round,
  // ~once/minute). Only subscribe to the slices actually rendered here.
  const activeTab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const connectedCount = useAppStore((s) => s.tabs.filter((t) => t.connected && t.type !== 'asset-list').length);
  const assetCount = useAppStore((s) => s.sessions.length);
  const activeSession = useAppStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    if (!tab) return undefined;
    return s.sessions.find((sess) => sess.id === tab.sessionId);
  });
  const locale = useAppStore((s) => s.locale);
  const broadcastInput = useAppStore((s) => s.broadcastInput);
  const toggleBroadcastInput = useAppStore((s) => s.toggleBroadcastInput);
  const { t } = useTranslation();
  const [version, setVersion] = useState('0.1.0');
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  // Align the clock tick to the next minute boundary so HH:MM never lags by
  // up to 30s (a fixed 30s interval could show 10:59 until 11:00:29).
  useEffect(() => {
    let timeoutId: number;
    const scheduleNext = () => {
      const next = new Date();
      next.setSeconds(0, 0);
      next.setMinutes(next.getMinutes() + 1);
      timeoutId = window.setTimeout(() => {
        setNow(new Date());
        scheduleNext();
      }, next.getTime() - Date.now());
    };
    scheduleNext();
    return () => window.clearTimeout(timeoutId);
  }, []);

  const sessionTarget = useMemo(() => {
    const sess = activeSession;
    if (!sess) return null;
    const target =
      sess.username && sess.host
        ? `${sess.username}@${sess.host}${sess.port ? `:${sess.port}` : ''}`
        : sess.host || sess.serial_port || sess.shell_name || null;
    return target;
  }, [activeSession]);

  return (
    <div className="status-bar">
      <div className="status-item">
        <Monitor size={11} />
        <span>GWShell v{version}</span>
      </div>

      {activeTab && activeTab.type !== 'asset-list' && (
        <>
          <div className="status-item">
            <span className={`status-dot ${activeTab.connected ? 'connected' : 'disconnected'}`} />
            <span>{activeTab.connected ? t('status_connected') : t('status_disconnected')}</span>
          </div>
          <div className="status-item">
            <Wifi size={11} />
            <span>{activeTab.type.toUpperCase()}</span>
          </div>
          {sessionTarget && (
            <div className="status-item status-session-target" title={sessionTarget}>
              <span>{sessionTarget}</span>
            </div>
          )}
        </>
      )}

      {connectedCount > 0 && (
        <button
          className={`status-item status-broadcast${broadcastInput ? ' active' : ''}`}
          onClick={toggleBroadcastInput}
          title={t('status_broadcast')}
          type="button"
        >
          <Radio size={11} />
          <span>{t('status_broadcast')}{broadcastInput ? ` (${connectedCount})` : ''}</span>
        </button>
      )}

      <div className="status-spacer" />

      <div className="status-item">
        <span>{t('status_assets')}: {assetCount}</span>
      </div>
      <div className="status-item">
        <Clock size={11} />
        <span>{now.toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>
  );
};
