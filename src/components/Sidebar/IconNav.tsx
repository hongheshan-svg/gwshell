import React from 'react';
import {
  Zap,
  FolderTree,
  List,
  FileText,
  Key,
  Box,
  Globe,
  TerminalSquare,
  Moon,
  Sun,
  PanelLeftClose,
  PanelLeftOpen,
  MoreVertical,
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import type { TranslationKeys } from '../../i18n';

const navItems: { id: string; icon: typeof Zap; labelKey: TranslationKeys }[] = [
  { id: 'quickconnect', icon: Zap, labelKey: 'nav_quickconnect' },
  { id: 'sessions', icon: FolderTree, labelKey: 'nav_sessions' },
  { id: 'assetlist', icon: List, labelKey: 'nav_assetlist' },
  { id: 'files', icon: FileText, labelKey: 'nav_files' },
  { id: 'keys', icon: Key, labelKey: 'nav_keys' },
  { id: 'docker', icon: Box, labelKey: 'nav_docker' },
  { id: 'services', icon: Globe, labelKey: 'nav_services' },
  { id: 'terminal', icon: TerminalSquare, labelKey: 'nav_terminal' },
];

export const Sidebar: React.FC = () => {
  const {
    theme,
    toggleTheme,
    sidebarCollapsed,
    toggleSidebar,
    activeNavItem,
    setActiveNavItem,
    showAppMenu,
    setShowAppMenu,
    t,
  } = useAppStore();

  return (
    <div className="icon-navbar">
      <button className="nav-icon-btn nav-logo" title="GWShell">
        <Zap size={20} />
      </button>

      {navItems.map((item) => (
        <button
          key={item.id}
          className={`nav-icon-btn ${activeNavItem === item.id ? 'active' : ''}`}
          onClick={() => setActiveNavItem(item.id)}
          title={t(item.labelKey)}
        >
          <item.icon size={18} />
        </button>
      ))}

      <div className="nav-spacer" />

      <button className="nav-icon-btn" onClick={toggleSidebar} title={t('nav_toggle_sidebar')}>
        {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
      </button>

      <button className="nav-icon-btn" onClick={toggleTheme} title={t('nav_toggle_theme')}>
        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
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
