import React from 'react';
import { Wifi, Clock, Monitor, Cloud } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

export const StatusBar: React.FC = () => {
  const { tabs, activeTabId, sessions, t, locale } = useAppStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <div className="status-bar">
      <div className="status-item">
        <Monitor size={11} />
        <span>GWShell v0.1.0</span>
      </div>

      {activeTab && activeTab.type !== 'asset-list' && (
        <>
          <div className="status-item">
            <span className={`status-dot ${activeTab.connected ? 'connected' : 'disconnected'}`} />
            <span>{activeTab.connected ? t('status_connected') : t('status_connecting')}</span>
          </div>
          <div className="status-item">
            <Wifi size={11} />
            <span>{activeTab.type.toUpperCase()}</span>
          </div>
        </>
      )}

      <div className="status-spacer" />

      <div className="status-item">
        <Cloud size={11} />
        <span>25°C</span>
      </div>
      <div className="status-item">
        <span>{t('status_assets')}: {sessions.length}</span>
      </div>
      <div className="status-item">
        <Clock size={11} />
        <span>{new Date().toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>
  );
};
