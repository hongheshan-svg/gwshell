import React from 'react';
import { Minus, Square, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useAppStore } from '../../stores/appStore';

// Cache the window reference at module level so the first click
// doesn't pay the initialization cost of creating a new Window object.
const appWindow = getCurrentWindow();

export const TitleBar: React.FC = () => {
  const t = useAppStore((s) => s.t);

  const handleMinimize = () => {
    appWindow.minimize();
  };

  const handleMaximize = () => {
    appWindow.toggleMaximize();
  };

  const handleClose = () => {
    appWindow.hide();
  };

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-title" data-tauri-drag-region>
        GWShell
      </div>
      <div className="titlebar-center" data-tauri-drag-region />
      <div className="titlebar-controls">
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
