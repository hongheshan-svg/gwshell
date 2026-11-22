import React, { useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { exit } from '@tauri-apps/plugin-process';
import { useTranslation } from 'react-i18next';
import { Globe, Settings, Search, LogOut, RefreshCw } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUpdaterStore } from '../../stores/updaterStore';
import { useEscapeClose } from '../../lib/useEscapeClose';
import { IS_MACOS, isTauriRuntime } from '../../lib/platform';
import { KEY_ACTIONS } from '../../keymap/actions';
import { formatBindingDisplay } from '../../keymap/match';

const getAppWindow = () => (isTauriRuntime() ? getCurrentWindow() : null);

function formatPaletteShortcut(overrides: Record<string, string | null>): string {
  const def = KEY_ACTIONS.find((a) => a.id === 'palette.open')?.defaultBinding ?? 'Ctrl+K';
  const ov = overrides['palette.open'];
  const binding = ov === undefined ? def : ov;
  if (!binding) return '';
  return formatBindingDisplay(binding, IS_MACOS);
}

export const AppMenu: React.FC = () => {
  const showAppMenu = useAppStore((s) => s.showAppMenu);
  const setShowAppMenu = useAppStore((s) => s.setShowAppMenu);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const setShowCommandPalette = useAppStore((s) => s.setShowCommandPalette);
  const locale = useAppStore((s) => s.locale);
  const setLocale = useAppStore((s) => s.setLocale);
  const keymapOverrides = useSettingsStore((s) => s.settings.keymapOverrides);
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      // eslint-disable-next-line no-restricted-syntax
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
    if (isTauriRuntime()) {
      invoke('quit_app').catch(() => {
        exit(0).catch(() => {});
      });
      setTimeout(() => {
        const appWindow = getAppWindow();
        appWindow?.destroy().catch(() => {
          getAppWindow()
            ?.close()
            .catch(() => {});
        });
      }, 800);
    }
  };

  const handleToggleLocale = () => {
    const next = locale === 'zh' ? 'en' : 'zh';
    setLocale(next);
    void useSettingsStore
      .getState()
      .patch({ language: next })
      .catch(() => {});
  };

  const paletteShortcut = formatPaletteShortcut(keymapOverrides);

  return (
    <div className="app-menu-overlay">
      <div className="app-menu" ref={menuRef}>
        <div className="app-menu-item" onClick={handleToggleLocale}>
          <Globe size={14} />
          <span>{t('menu_language')}</span>
          <span className="app-menu-shortcut">{locale === 'zh' ? 'EN' : '中文'}</span>
        </div>
        <div
          className="app-menu-item"
          onClick={() => {
            setShowAppMenu(false);
            setShowSettings(true);
          }}
        >
          <Settings size={14} />
          <span>{t('menu_settings')}</span>
        </div>
        <div
          className="app-menu-item"
          onClick={() => {
            setShowAppMenu(false);
            setShowCommandPalette(true);
          }}
        >
          <Search size={14} />
          <span>{t('menu_quick_search')}</span>
          {paletteShortcut && <span className="app-menu-shortcut">{paletteShortcut}</span>}
        </div>
        <div
          className="app-menu-item"
          onClick={() => {
            setShowAppMenu(false);
            void useUpdaterStore.getState().checkForUpdate({ manual: true });
          }}
        >
          <RefreshCw size={14} />
          <span>{t('update_check_menu')}</span>
        </div>
        <div className="app-menu-divider" />
        <div className="app-menu-item danger" onClick={handleQuit}>
          <LogOut size={14} />
          <span>{t('menu_quit')}</span>
          <span className="app-menu-shortcut">{IS_MACOS ? '⌘Q' : 'Alt+F4'}</span>
        </div>
      </div>
    </div>
  );
};
