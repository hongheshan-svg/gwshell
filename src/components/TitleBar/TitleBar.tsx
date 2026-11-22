import React from 'react';
import { Minus, Square, X, Activity, Search, Bot } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { exit } from '@tauri-apps/plugin-process';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import { IS_MACOS, isTauriRuntime } from '../../lib/platform';

const getAppWindow = () => (isTauriRuntime() ? getCurrentWindow() : null);

export const TitleBar: React.FC = () => {
  const { t } = useTranslation();
  const {
    serverPanelOpen,
    toggleServerPanel,
    agentPanelOpen,
    toggleAgentPanel,
    setShowCommandPalette,
  } = useAppStore();

  const handleMinimize = () => {
    getAppWindow()
      ?.minimize()
      .catch(() => {});
  };

  const handleMaximize = () => {
    getAppWindow()
      ?.toggleMaximize()
      .catch(() => {});
  };

  const handleClose = () => {
    if (isTauriRuntime()) {
      exit(0).catch(() => {});
      getAppWindow()
        ?.close()
        .catch(() => {});
    }
  };

  return (
    // Double-click-to-maximize is handled natively by Tauri via the
    // `data-tauri-drag-region` elements below — do NOT add a manual
    // onDoubleClick toggleMaximize here, or it fires twice and cancels out.
    <div className={`titlebar${IS_MACOS ? ' titlebar--macos' : ''}`}>
      <div className="titlebar-title" data-tauri-drag-region>
        <span className="titlebar-brand-mark" aria-hidden="true">
          &gt;_
        </span>
        <span>GWShell</span>
      </div>
      <div className="titlebar-center" data-tauri-drag-region>
        <button type="button" className="titlebar-cmdk" onClick={() => setShowCommandPalette(true)}>
          <Search size={12} />
          <span>{t('palette_entry', '搜索或输入命令')}</span>
          <kbd>{IS_MACOS ? '⌘K' : 'Ctrl K'}</kbd>
        </button>
      </div>
      <div className="titlebar-controls">
        <div className="titlebar-tools">
          <button
            type="button"
            className={`titlebar-tool-btn${agentPanelOpen ? ' titlebar-btn--active' : ''}`}
            onClick={toggleAgentPanel}
            title={t('agent_panel_title')}
            data-gw-action="toggle_agent_panel"
          >
            <Bot size={15} />
          </button>
          <button
            type="button"
            className={`titlebar-tool-btn${serverPanelOpen ? ' titlebar-btn--active' : ''}`}
            onClick={toggleServerPanel}
            title={t('serverPanel_toggle_title')}
            data-gw-action="toggle_server_panel"
          >
            <Activity size={15} />
          </button>
        </div>
        {!IS_MACOS && (
          <div className="titlebar-window-controls">
            <button
              type="button"
              className="titlebar-btn"
              onClick={handleMinimize}
              data-gw-action="minimize"
              title={t('titlebar_minimize')}
            >
              <Minus size={14} />
            </button>
            <button
              type="button"
              className="titlebar-btn"
              onClick={handleMaximize}
              data-gw-action="toggle_maximize"
              title={t('titlebar_maximize')}
            >
              <Square size={10} />
            </button>
            <button
              type="button"
              className="titlebar-btn titlebar-close"
              onClick={handleClose}
              data-gw-action="exit"
              title={t('titlebar_close')}
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
