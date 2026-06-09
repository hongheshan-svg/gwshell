import React, { useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { exit } from '@tauri-apps/plugin-process';
import { useTranslation } from 'react-i18next';
import {
  Globe,
  Settings,
  Search,
  LogOut,
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useEscapeClose } from '../../lib/useEscapeClose';

const appWindow = getCurrentWindow();

export const AppMenu: React.FC = () => {
  const { showAppMenu, setShowAppMenu, setShowSettings, setShowCommandPalette, locale, setLocale } = useAppStore();
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowAppMenu(false);
      }
    };
    if (showAppMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showAppMenu, setShowAppMenu]);

  useEscapeClose(() => setShowAppMenu(false));

  if (!showAppMenu) return null;

  const handleQuit = () => {
    setShowAppMenu(false);
    exit(0).catch(() => {});
    invoke('quit_app').catch(() => {});
    setTimeout(() => {
      appWindow.destroy().catch(() => {
        appWindow.close().catch(() => {});
      });
    }, 800);
  };

  return (
    <div className="app-menu-overlay">
      <div className="app-menu" ref={menuRef}>
        <div className="app-menu-item" onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}>
          <Globe size={14} />
          <span>{t('menu_language')}</span>
          <span className="app-menu-shortcut">{locale === 'zh' ? 'EN' : '中文'}</span>
        </div>
        <div className="app-menu-item" onClick={() => { setShowAppMenu(false); setShowSettings(true); }}>
          <Settings size={14} />
          <span>{t('menu_settings')}</span>
        </div>
        <div className="app-menu-item" onClick={() => { setShowAppMenu(false); setShowCommandPalette(true); }}>
          <Search size={14} />
          <span>{t('menu_quick_search')}</span>
          <span className="app-menu-shortcut">Ctrl+Shift+F</span>
        </div>
        <div className="app-menu-divider" />
        <div className="app-menu-item danger" onClick={handleQuit}>
          <LogOut size={14} />
          <span>{t('menu_quit')}</span>
          <span className="app-menu-shortcut">Alt+F4</span>
        </div>
      </div>
    </div>
  );
};
