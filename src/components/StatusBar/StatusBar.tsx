import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Wifi, Clock, Monitor, Radio } from 'lucide-react';
import { getVersion } from '@tauri-apps/api/app';
import { useAppStore } from '../../stores/appStore';

export const StatusBar: React.FC = () => {
  const { tabs, activeTabId, sessions, locale, broadcastInput, toggleBroadcastInput } = useAppStore();
  const { t } = useTranslation();
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const [version, setVersion] = useState('0.1.0');
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

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
          {/* Active session target: user@host:port for SSH, port/shell otherwise */}
          {(() => {
            const sess = sessions.find((s) => s.id === activeTab.sessionId);
            if (!sess) return null;
            const target =
              sess.username && sess.host
                ? `${sess.username}@${sess.host}${sess.port ? `:${sess.port}` : ''}`
                : sess.host || sess.serial_port || sess.shell_name || null;
            if (!target) return null;
            return (
              <div className="status-item status-session-target" title={target}>
                <span>{target}</span>
              </div>
            );
          })()}
        </>
      )}

      {(() => {
        const connectedCount = tabs.filter((tb) => tb.connected && tb.type !== 'asset-list').length;
        if (connectedCount === 0) return null;
        return (
          <button
            className={`status-item status-broadcast${broadcastInput ? ' active' : ''}`}
            onClick={toggleBroadcastInput}
            title={t('status_broadcast')}
            type="button"
          >
            <Radio size={11} />
            <span>{t('status_broadcast')}{broadcastInput ? ` (${connectedCount})` : ''}</span>
          </button>
        );
      })()}

      <div className="status-spacer" />

      <div className="status-item">
        <span>{t('status_assets')}: {sessions.length}</span>
      </div>
      <div className="status-item">
        <Clock size={11} />
        <span>{now.toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>
  );
};
