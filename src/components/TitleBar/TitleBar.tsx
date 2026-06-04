import React from 'react';
import { Minus, Square, X, Activity } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { exit } from '@tauri-apps/plugin-process';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';

const appWindow = getCurrentWindow();

// macOS is detected from the user agent (Tauri's WebView reports the
// host OS reliably). We avoid an async @tauri-apps/api/os import to keep
// the title bar a synchronous render — UA detection has been stable for
// macOS for many years.
const IS_MACOS = typeof navigator !== 'undefined'
  && /Mac OS X|Macintosh/.test(navigator.userAgent);

export const TitleBar: React.FC = () => {
  const { t } = useTranslation();
  const { tabs, activeTabId, serverPanelOpen, toggleServerPanel } = useAppStore();
  const activeTab = tabs.find((tt) => tt.id === activeTabId);
  const sshActive = activeTab?.type === 'ssh';
  const monitorTitle = sshActive || serverPanelOpen
    ? t('serverPanel_toggle_title')
    : t('serverPanel_ssh_only');

  const handleMinimize = () => {
    appWindow.minimize();
  };

  const handleMaximize = () => {
    appWindow.toggleMaximize();
  };

  const handleClose = () => {
    exit(0).catch(() => {});
    appWindow.close().catch(() => {});
  };

  return (
    <div className={`titlebar${IS_MACOS ? ' titlebar--macos' : ''}`}>
      <div className="titlebar-title" data-tauri-drag-region>
        GWShell
      </div>
      <div className="titlebar-center" data-tauri-drag-region />
      <div className="titlebar-controls">
        <button
          className={`titlebar-btn${serverPanelOpen ? ' titlebar-btn--active' : ''}`}
          onClick={toggleServerPanel}
          title={monitorTitle}
          data-gw-action="toggle_server_panel"
        >
          <Activity size={14} />
        </button>
        {!IS_MACOS && (
          <>
            <button className="titlebar-btn" onClick={handleMinimize} data-gw-action="minimize" title={t('titlebar_minimize')}>
              <Minus size={14} />
            </button>
            <button className="titlebar-btn" onClick={handleMaximize} data-gw-action="toggle_maximize" title={t('titlebar_maximize')}>
              <Square size={10} />
            </button>
            <button className="titlebar-btn titlebar-close" onClick={handleClose} data-gw-action="exit" title={t('titlebar_close')}>
              <X size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );
};
