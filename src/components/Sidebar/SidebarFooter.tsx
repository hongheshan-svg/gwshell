import React from 'react';
import { useTranslation } from 'react-i18next';
import { Sun, Moon, MoreHorizontal, Settings } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useSettingsStore } from '../../stores/settingsStore';

/**
 * Minimal footer of the sidebar: settings shortcut, theme toggle, and overflow menu.
 * Snippets live in the top segmented switcher; sidebar collapse lives in TitleBar.
 */
export const SidebarFooter: React.FC = () => {
  const { t } = useTranslation();
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const showAppMenu = useAppStore((s) => s.showAppMenu);
  const setShowAppMenu = useAppStore((s) => s.setShowAppMenu);

  const handleToggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    toggleTheme();
    void useSettingsStore
      .getState()
      .patch({ theme: next })
      .catch(() => {});
  };

  return (
    <div className="sidebar-footer">
      <button
        type="button"
        className="nav-icon-btn sidebar-settings-btn"
        onClick={() => setShowSettings(true)}
        title={t('menu_settings')}
      >
        <Settings size={14} />
        <span>{t('menu_settings')}</span>
      </button>
      <div className="nav-spacer" />
      <button
        type="button"
        className="nav-icon-btn"
        onClick={handleToggleTheme}
        title={t('nav_toggle_theme')}
        aria-label={t('nav_toggle_theme')}
      >
        {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
      </button>
      <button
        type="button"
        className={`nav-icon-btn ${showAppMenu ? 'active' : ''}`}
        onClick={() => setShowAppMenu(!showAppMenu)}
        title={t('nav_menu')}
        aria-label={t('nav_menu')}
      >
        <MoreHorizontal size={14} />
      </button>
    </div>
  );
};
