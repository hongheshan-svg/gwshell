import React from 'react';
import { useTranslation } from 'react-i18next';
import { Code, Sun, Moon, PanelLeftClose, MoreVertical } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

/**
 * Footer of the single sidebar. Holds the utility controls that used to live in
 * the (now-removed) icon rail: snippets toggle, theme, collapse, and the app menu.
 * SFTP intentionally stays in the TabBar (it is contextual to an SSH tab).
 */
export const SidebarFooter: React.FC = () => {
  const { t } = useTranslation();
  const { theme, toggleTheme, toggleSidebar, activeNavItem, setActiveNavItem, showAppMenu, setShowAppMenu } = useAppStore();
  const snippetsActive = activeNavItem === 'snippets';

  return (
    <div className="sidebar-footer">
      <button
        className={`nav-icon-btn ${snippetsActive ? 'active' : ''}`}
        onClick={() => setActiveNavItem(snippetsActive ? 'sessions' : 'snippets')}
        title={t('nav_snippets')}
      >
        <Code size={18} />
      </button>
      <button className="nav-icon-btn" onClick={toggleTheme} title={t('nav_toggle_theme')}>
        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </button>
      <div style={{ flex: 1 }} />
      <button className="nav-icon-btn" onClick={toggleSidebar} title={t('nav_toggle_sidebar')}>
        <PanelLeftClose size={18} />
      </button>
      <button
        className={`nav-icon-btn ${showAppMenu ? 'active' : ''}`}
        onClick={() => setShowAppMenu(!showAppMenu)}
        title={t('nav_menu')}
      >
        <MoreVertical size={18} />
      </button>
    </div>
  );
};
