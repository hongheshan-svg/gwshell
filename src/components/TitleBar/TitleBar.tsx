import React from 'react';
import {
  Minus,
  Square,
  X,
  Activity,
  Search,
  Bot,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { IS_MACOS, isTauriRuntime } from '../../lib/platform';
import { KEY_ACTIONS } from '../../keymap/actions';
import { formatBindingDisplay } from '../../keymap/match';
import { TabBar } from '../TabBar/TabBar';

const getAppWindow = () => (isTauriRuntime() ? getCurrentWindow() : null);

export const TitleBar: React.FC = () => {
  const { t } = useTranslation();
  const serverPanelOpen = useAppStore((s) => s.serverPanelOpen);
  const toggleServerPanel = useAppStore((s) => s.toggleServerPanel);
  const agentPanelOpen = useAppStore((s) => s.agentPanelOpen);
  const toggleAgentPanel = useAppStore((s) => s.toggleAgentPanel);
  const setShowCommandPalette = useAppStore((s) => s.setShowCommandPalette);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const keymapOverrides = useSettingsStore((s) => s.settings.keymapOverrides);

  const paletteBadge = (() => {
    const def = KEY_ACTIONS.find((a) => a.id === 'palette.open')?.defaultBinding ?? 'Ctrl+K';
    const ov = keymapOverrides['palette.open'];
    const binding = ov === undefined ? def : ov;
    if (!binding) return '';
    return formatBindingDisplay(binding, IS_MACOS);
  })();

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
      invoke('quit_app').catch(() => {
        getAppWindow()
          ?.close()
          .catch(() => {});
      });
    }
  };

  return (
    <div className={`titlebar${IS_MACOS ? ' titlebar--macos' : ''}`}>
      <div className="titlebar-left">
        <button
          type="button"
          className="titlebar-icon-btn"
          onClick={toggleSidebar}
          title={t('nav_toggle_sidebar')}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
        <div className="titlebar-title" data-tauri-drag-region>
          <span className="titlebar-brand-mark" aria-hidden="true">
            &gt;_
          </span>
          <span className="titlebar-brand-name">GWShell</span>
        </div>
      </div>

      {/* Unified single-bar tabs + flexible drag strip */}
      <div className="titlebar-tabs" data-tauri-drag-region>
        <TabBar />
      </div>

      <div className="titlebar-controls">
        <button
          type="button"
          className="titlebar-cmdk-pill"
          onClick={() => setShowCommandPalette(true)}
          title={t('palette_entry', '搜索或输入命令')}
        >
          <Search size={12} />
          <span className="titlebar-cmdk-label">{t('palette_entry', '搜索或输入命令')}</span>
          {paletteBadge && <kbd>{paletteBadge}</kbd>}
        </button>
        <div className="titlebar-tools">
          <button
            type="button"
            className={`titlebar-pill-btn${agentPanelOpen ? ' titlebar-btn--active' : ''}`}
            onClick={toggleAgentPanel}
            title={t('agent_panel_title')}
            data-gw-action="toggle_agent_panel"
          >
            <Bot size={14} />
            <span>AI</span>
          </button>
          <button
            type="button"
            className={`titlebar-icon-btn${serverPanelOpen ? ' titlebar-btn--active' : ''}`}
            onClick={toggleServerPanel}
            title={t('serverPanel_toggle_title')}
            data-gw-action="toggle_server_panel"
          >
            <Activity size={14} />
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
