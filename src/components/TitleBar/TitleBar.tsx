import React from 'react';
import { Minus, Square, X, Activity, Search, Bot } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { IS_MACOS, isTauriRuntime } from '../../lib/platform';
import { KEY_ACTIONS } from '../../keymap/actions';
import { formatStep, parseBinding } from '../../keymap/match';

const getAppWindow = () => (isTauriRuntime() ? getCurrentWindow() : null);

export const TitleBar: React.FC = () => {
  const { t } = useTranslation();
  const serverPanelOpen = useAppStore((s) => s.serverPanelOpen);
  const toggleServerPanel = useAppStore((s) => s.toggleServerPanel);
  const agentPanelOpen = useAppStore((s) => s.agentPanelOpen);
  const toggleAgentPanel = useAppStore((s) => s.toggleAgentPanel);
  const setShowCommandPalette = useAppStore((s) => s.setShowCommandPalette);
  const keymapOverrides = useSettingsStore((s) => s.settings.keymapOverrides);

  const paletteBadge = (() => {
    const def = KEY_ACTIONS.find((a) => a.id === 'palette.open')?.defaultBinding ?? 'Ctrl+K';
    const ov = keymapOverrides['palette.open'];
    const binding = ov === undefined ? def : ov;
    if (!binding) return '';
    const chord = parseBinding(binding);
    return chord ? chord.map(formatStep).join(' ') : binding;
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
          {paletteBadge && <kbd>{paletteBadge}</kbd>}
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
