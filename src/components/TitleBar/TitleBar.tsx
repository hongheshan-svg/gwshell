import React from 'react';
import { Minus, Square, X, Activity, Search } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { exit } from '@tauri-apps/plugin-process';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import { IS_MACOS } from '../../lib/platform';

const appWindow = getCurrentWindow();

export const TitleBar: React.FC = () => {
  const { t } = useTranslation();
  const { serverPanelOpen, toggleServerPanel, setShowCommandPalette } = useAppStore();

  const handleMinimize = () => {
    appWindow.minimize();
  };

  const handleMaximize = () => {
    appWindow.toggleMaximize();
  };

  const handleTitlebarDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('.titlebar-controls')) return;
    appWindow.toggleMaximize().catch(() => {});
  };

  const handleClose = () => {
    exit(0).catch(() => {});
    appWindow.close().catch(() => {});
  };

  return (
    <div
      className={`titlebar${IS_MACOS ? ' titlebar--macos' : ''}`}
      onDoubleClick={handleTitlebarDoubleClick}
    >
      <div className="titlebar-title" data-tauri-drag-region>
        GWShell
      </div>
      <div className="titlebar-center" data-tauri-drag-region>
        <button type="button" className="titlebar-cmdk" onClick={() => setShowCommandPalette(true)}>
          <Search size={12} />
          <span>{t('palette_entry', '搜索或输入命令')}</span>
          <kbd>{IS_MACOS ? '⌘K' : 'Ctrl K'}</kbd>
        </button>
      </div>
      <div className="titlebar-controls">
        <button
          className={`titlebar-btn${serverPanelOpen ? ' titlebar-btn--active' : ''}`}
          onClick={toggleServerPanel}
          title={t('serverPanel_toggle_title')}
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
