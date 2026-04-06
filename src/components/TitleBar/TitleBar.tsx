import React from 'react';
import { Minus, Square, X } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

export const TitleBar: React.FC = () => {
  const t = useAppStore((s) => s.t);

  const handleMinimize = async () => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    getCurrentWindow().minimize();
  };

  const handleMaximize = async () => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    const isMax = await win.isMaximized();
    if (isMax) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  };

  const handleClose = async () => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    getCurrentWindow().hide();
  };

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-title" data-tauri-drag-region>
        GWShell
      </div>
      <div className="titlebar-controls">
        <button className="titlebar-btn" onClick={handleMinimize} title={t('titlebar_minimize')}>
          <Minus size={14} />
        </button>
        <button className="titlebar-btn" onClick={handleMaximize} title={t('titlebar_maximize')}>
          <Square size={10} />
        </button>
        <button className="titlebar-btn titlebar-close" onClick={handleClose} title={t('titlebar_close')}>
          <X size={14} />
        </button>
      </div>
    </div>
  );
};
