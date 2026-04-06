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

const navItems = [
  { id: 'quickconnect', icon: Zap, label: '快速连接' },
  { id: 'sessions', icon: FolderTree, label: '会话管理' },
  { id: 'assetlist', icon: List, label: '资产列表' },
  { id: 'files', icon: FileText, label: '文件传输' },
  { id: 'keys', icon: Key, label: '密钥/身份' },
  { id: 'docker', icon: Box, label: 'Docker' },
  { id: 'services', icon: Globe, label: '网络服务' },
  { id: 'terminal', icon: TerminalSquare, label: '本地终端' },
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
  } = useAppStore();

  return (
    <div className="icon-navbar">
      {/* App logo */}
      <button className="nav-icon-btn nav-logo" title="GWShell">
        <Zap size={20} />
      </button>

      {/* Nav items */}
      {navItems.map((item) => (
        <button
          key={item.id}
          className={`nav-icon-btn ${activeNavItem === item.id ? 'active' : ''}`}
          onClick={() => setActiveNavItem(item.id)}
          title={item.label}
        >
          <item.icon size={18} />
        </button>
      ))}

      <div className="nav-spacer" />

      {/* Collapse sidebar */}
      <button className="nav-icon-btn" onClick={toggleSidebar} title="切换侧边栏">
        {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
      </button>

      {/* Theme toggle */}
      <button className="nav-icon-btn" onClick={toggleTheme} title="切换主题">
        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </button>

      {/* Settings / Menu */}
      <button
        className={`nav-icon-btn ${showAppMenu ? 'active' : ''}`}
        onClick={() => setShowAppMenu(!showAppMenu)}
        title="菜单"
      >
        <MoreVertical size={18} />
      </button>
    </div>
  );
};
