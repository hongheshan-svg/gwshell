import React from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollText, Sun, Moon, PanelLeftClose, MoreHorizontal, Settings } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useSettingsStore } from '../../stores/settingsStore';

/**
 * Footer of the single sidebar. Holds primary workspace utilities:
 * snippets toggle, theme switch, direct settings shortcut, sidebar collapse,
 * and overflow app menu.
 */
export const SidebarFooter: React.FC = () => {
  const { t } = useTranslation();
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const activeNavItem = useAppStore((s) => s.activeNavItem);
  const setActiveNavItem = useAppStore((s) => s.setActiveNavItem);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const showAppMenu = useAppStore((s) => s.showAppMenu);
  const setShowAppMenu = useAppStore((s) => s.setShowAppMenu);
  const snippetsActive = activeNavItem === 'snippets';

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
        className={`nav-icon-btn ${snippetsActive ? 'active' : ''}`}
        onClick={() => setActiveNavItem(snippetsActive ? 'sessions' : 'snippets')}
        title={t('nav_snippets')}
      >
        <ScrollText size={15} />
      </button>
      <button
        type="button"
        className="nav-icon-btn"
        onClick={handleToggleTheme}
        title={t('nav_toggle_theme')}
      >
        {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
      </button>
      <button
        type="button"
        className="nav-icon-btn"
        onClick={() => setShowSettings(true)}
        title={t('menu_settings')}
      >
        <Settings size={15} />
      </button>
      <div style={{ flex: 1 }} />
      <button
        type="button"
        className="nav-icon-btn"
        onClick={toggleSidebar}
        title={t('nav_toggle_sidebar')}
      >
        <PanelLeftClose size={15} />
      </button>
      <button
        type="button"
        className={`nav-icon-btn ${showAppMenu ? 'active' : ''}`}
        onClick={() => setShowAppMenu(!showAppMenu)}
        title={t('nav_menu')}
      >
        <MoreHorizontal size={15} />
      </button>
    </div>
  );
};
