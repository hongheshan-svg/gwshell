import React from 'react';
import { Minus, Square, X, Activity } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';

// Cache the window reference at module level so the first click
// doesn't pay the initialization cost of creating a new Window object.
const appWindow = getCurrentWindow();

export const TitleBar: React.FC = () => {
  const { t } = useTranslation();
  const { tabs, activeTabId, serverPanelOpen, toggleServerPanel } = useAppStore();
  const activeTab = tabs.find((tt) => tt.id === activeTabId);
  const sshActive = activeTab?.type === 'ssh';

  const handleMinimize = () => {
    appWindow.minimize();
  };

  const handleMaximize = () => {
    appWindow.toggleMaximize();
  };

  const handleClose = () => {
    appWindow.close();
  };

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-title" data-tauri-drag-region>
        GWShell
      </div>
      <div className="titlebar-center" data-tauri-drag-region />
      <div className="titlebar-controls">
        <button
          className={`titlebar-btn${serverPanelOpen ? ' titlebar-btn--active' : ''}`}
          onClick={() => { if (sshActive) toggleServerPanel(); }}
          disabled={!sshActive}
          title={sshActive ? t('serverPanel_toggle_title') : t('serverPanel_ssh_only')}
          data-gw-action="toggle_server_panel"
        >
          <Activity size={14} />
        </button>
        <button className="titlebar-btn" onClick={handleMinimize} data-gw-action="minimize" title={t('titlebar_minimize')}>
          <Minus size={14} />
        </button>
        <button className="titlebar-btn" onClick={handleMaximize} data-gw-action="toggle_maximize" title={t('titlebar_maximize')}>
          <Square size={10} />
        </button>
        <button className="titlebar-btn titlebar-close" onClick={handleClose} data-gw-action="hide" title={t('titlebar_close')}>
          <X size={14} />
        </button>
      </div>
    </div>
  );
};
