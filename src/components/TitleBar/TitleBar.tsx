import React from 'react';
import { Minus, Square, X } from 'lucide-react';

export const TitleBar: React.FC = () => {
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
    getCurrentWindow().close();
  };

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-title" data-tauri-drag-region>
        GWShell
      </div>
      <div className="titlebar-controls">
        <button className="titlebar-btn" onClick={handleMinimize} title="最小化">
          <Minus size={14} />
        </button>
        <button className="titlebar-btn" onClick={handleMaximize} title="最大化">
          <Square size={10} />
        </button>
        <button className="titlebar-btn titlebar-close" onClick={handleClose} title="关闭">
          <X size={14} />
        </button>
      </div>
    </div>
  );
};
