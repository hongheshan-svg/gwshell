import React, { useRef, useEffect } from 'react';
import {
  ExternalLink,
  Clock,
  Globe,
  HelpCircle,
  Star,
  Settings,
  Search,
  RotateCcw,
  LogOut,
  ChevronRight,
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

export const AppMenu: React.FC = () => {
  const { showAppMenu, setShowAppMenu, setShowSettings } = useAppStore();
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

  if (!showAppMenu) return null;

  return (
    <div className="app-menu-overlay">
      <div className="app-menu" ref={menuRef}>
        <div className="app-menu-item">
          <ExternalLink size={14} />
          <span>新窗口</span>
          <ChevronRight size={12} className="app-menu-arrow" />
        </div>
        <div className="app-menu-item">
          <Clock size={14} />
          <span>最近项目</span>
          <span className="app-menu-shortcut">Ctrl+E</span>
          <ChevronRight size={12} className="app-menu-arrow" />
        </div>
        <div className="app-menu-item">
          <Globe size={14} />
          <span>语言</span>
          <ChevronRight size={12} className="app-menu-arrow" />
        </div>
        <div className="app-menu-item">
          <HelpCircle size={14} />
          <span>帮助</span>
          <ChevronRight size={12} className="app-menu-arrow" />
        </div>
        <div className="app-menu-divider" />
        <div className="app-menu-item">
          <Star size={14} />
          <span>升级专业版</span>
        </div>
        <div className="app-menu-item" onClick={() => { setShowAppMenu(false); setShowSettings(true); }}>
          <Settings size={14} />
          <span>设置</span>
        </div>
        <div className="app-menu-item">
          <Search size={14} />
          <span>快速搜索</span>
          <span className="app-menu-shortcut">Ctrl+Shift+F</span>
        </div>
        <div className="app-menu-divider" />
        <div className="app-menu-item">
          <RotateCcw size={14} />
          <span>重载页面</span>
        </div>
        <div className="app-menu-item danger">
          <LogOut size={14} />
          <span>退出</span>
          <span className="app-menu-shortcut">Alt+F4</span>
        </div>
      </div>
    </div>
  );
};
