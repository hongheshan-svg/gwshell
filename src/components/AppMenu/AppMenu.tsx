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
  const { showAppMenu, setShowAppMenu, setShowSettings, t, locale, setLocale } = useAppStore();
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
          <span>{t('menu_new_window')}</span>
          <ChevronRight size={12} className="app-menu-arrow" />
        </div>
        <div className="app-menu-item">
          <Clock size={14} />
          <span>{t('menu_recent')}</span>
          <span className="app-menu-shortcut">Ctrl+E</span>
          <ChevronRight size={12} className="app-menu-arrow" />
        </div>
        <div className="app-menu-item" onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}>
          <Globe size={14} />
          <span>{t('menu_language')}</span>
          <span className="app-menu-shortcut">{locale === 'zh' ? 'EN' : '中文'}</span>
        </div>
        <div className="app-menu-item">
          <HelpCircle size={14} />
          <span>{t('menu_help')}</span>
          <ChevronRight size={12} className="app-menu-arrow" />
        </div>
        <div className="app-menu-divider" />
        <div className="app-menu-item">
          <Star size={14} />
          <span>{t('menu_upgrade')}</span>
        </div>
        <div className="app-menu-item" onClick={() => { setShowAppMenu(false); setShowSettings(true); }}>
          <Settings size={14} />
          <span>{t('menu_settings')}</span>
        </div>
        <div className="app-menu-item">
          <Search size={14} />
          <span>{t('menu_quick_search')}</span>
          <span className="app-menu-shortcut">Ctrl+Shift+F</span>
        </div>
        <div className="app-menu-divider" />
        <div className="app-menu-item">
          <RotateCcw size={14} />
          <span>{t('menu_reload')}</span>
        </div>
        <div className="app-menu-item danger">
          <LogOut size={14} />
          <span>{t('menu_quit')}</span>
          <span className="app-menu-shortcut">Alt+F4</span>
        </div>
      </div>
    </div>
  );
};
