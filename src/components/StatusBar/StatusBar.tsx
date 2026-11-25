import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Wifi, Clock, Monitor, Radio, ArrowUpCircle, Download, RotateCcw } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useUpdaterStore } from '../../stores/updaterStore';

export const StatusBar: React.FC = () => {
  // Fine-grained selectors: only subscribe to the slices actually rendered here.
  const activeTab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const connectedCount = useAppStore(
    (s) => s.tabs.filter((t) => t.connected && t.type !== 'asset-list').length,
  );
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
  const version = useUpdaterStore((s) => s.currentVersion);
  const updaterStatus = useUpdaterStore((s) => s.status);
  const availableVersion = useUpdaterStore((s) => s.availableVersion);
  const updateProgress = useUpdaterStore((s) => s.progress);
  const [now, setNow] = useState(() => new Date());

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
        : // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          sess.host || sess.serial_port || sess.shell_name || null;
    return target;
  }, [activeSession]);

  const handleUpdateClick = () => {
    const store = useUpdaterStore.getState();
    if (
      updaterStatus === 'available' ||
      updaterStatus === 'downloading' ||
      updaterStatus === 'ready'
    ) {
      store.openModal();
    } else {
      void store.checkForUpdate({ manual: true });
    }
  };

  return (
    <div className="status-bar">
      <button
        type="button"
        className="status-item status-version-btn"
        onClick={handleUpdateClick}
        title={t('update_check_menu')}
      >
        <Monitor size={11} />
        <span>GWShell v{version}</span>
      </button>

      {updaterStatus === 'available' && availableVersion && (
        <button
          type="button"
          className="status-item status-update-pill"
          onClick={handleUpdateClick}
          title={t('update_new_version', { version: availableVersion })}
        >
          <ArrowUpCircle size={11} />
          <span>v{availableVersion}</span>
        </button>
      )}

      {updaterStatus === 'downloading' && (
        <button
          type="button"
          className="status-item status-update-pill"
          onClick={handleUpdateClick}
          title={t('update_downloading')}
        >
          <Download size={11} />
          <span>
            {updateProgress !== null ? `${updateProgress}%` : t('update_downloading_short')}
          </span>
        </button>
      )}

      {updaterStatus === 'ready' && (
        <button
          type="button"
          className="status-item status-update-pill status-update-pill--ready"
          onClick={handleUpdateClick}
          title={t('update_restart')}
        >
          <RotateCcw size={11} />
          <span>{t('update_restart_now')}</span>
        </button>
      )}

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
          <span>
            {t('status_broadcast')}
            {broadcastInput ? ` (${connectedCount})` : ''}
          </span>
        </button>
      )}

      <div className="status-spacer" />

      <div className="status-item">
        <span>
          {t('status_assets')}: {assetCount}
        </span>
      </div>
      <div className="status-item">
        <Clock size={11} />
        <span>
          {now.toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>
    </div>
  );
};
