import React, { useState, useEffect } from 'react';
import { Wifi, Clock, Monitor, Cloud, LayoutGrid, Zap } from 'lucide-react';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore, type SplitCount } from '../../stores/appStore';

const SPLIT_OPTIONS: { count: SplitCount; label: string }[] = [
  { count: 1, label: '1' },
  { count: 2, label: '1×2' },
  { count: 4, label: '2×2' },
  { count: 6, label: '2×3' },
  { count: 8, label: '2×4' },
];

export const StatusBar: React.FC = () => {
  const { tabs, activeTabId, sessions, t, locale, splitCount, setSplitCount } = useAppStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const [showSplitMenu, setShowSplitMenu] = useState(false);
  const [version, setVersion] = useState('0.1.0');
  const [showAiMenu, setShowAiMenu] = useState(false);
  const [activeProvider, setActiveProvider] = useState<string>('');
  const [providers, setProviders] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  useEffect(() => {
    let idleCallbackId: number | null = null;

    const loadAi = async () => {
      try {
        const [list, ids] = await Promise.all([
          invoke<{ id: string; name: string }[]>('list_ai_providers'),
          invoke<[string | null, string | null, string | null, string | null, string | null]>('get_ai_active_ids'),
        ]);
        setProviders(list);
        const activeId = ids[0] || ids[1] || ids[2] || ids[3] || ids[4];
        const active = list.find(p => p.id === activeId);
        setActiveProvider(active?.name || '');
      } catch { /* empty */ }
    };

    const initTimer = window.setTimeout(() => {
      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        idleCallbackId = window.requestIdleCallback(() => {
          void loadAi();
        }, { timeout: 4000 });
      } else {
        idleCallbackId = setTimeout(() => {
          void loadAi();
        }, 0);
      }
    }, 15000);

    const interval = setInterval(loadAi, 10000);
    return () => {
      clearTimeout(initTimer);
      clearInterval(interval);
      if (idleCallbackId != null) {
        if (typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
          window.cancelIdleCallback(idleCallbackId);
        } else {
          clearTimeout(idleCallbackId);
        }
      }
    };
  }, []);

  const handleSwitchProvider = async (providerId: string) => {
    try {
      await invoke('switch_ai_provider', { providerId, tool: 'all' });
      const p = providers.find(pp => pp.id === providerId);
      setActiveProvider(p?.name || '');
      setShowAiMenu(false);
    } catch { /* empty */ }
  };

  return (
    <div className="status-bar">
      <div className="status-item">
        <Monitor size={11} />
        <span>GWShell v{version}</span>
      </div>

      {activeTab && activeTab.type !== 'asset-list' && (
        <>
          <div className="status-item">
            <span className={`status-dot ${activeTab.connected ? 'connected' : 'disconnected'}`} />
            <span>{activeTab.connected ? t('status_connected') : t('status_connecting')}</span>
          </div>
          <div className="status-item">
            <Wifi size={11} />
            <span>{activeTab.type.toUpperCase()}</span>
          </div>
        </>
      )}

      <div className="status-spacer" />

      {/* Split screen picker */}
      <div className="status-item split-picker-wrap" style={{ position: 'relative' }}>
        <button
          className="split-picker-btn"
          onClick={() => setShowSplitMenu(!showSplitMenu)}
          title={t('split_title')}
        >
          <LayoutGrid size={12} />
          <span>{splitCount === 1 ? t('split_single') : `${splitCount}`}</span>
        </button>
        {showSplitMenu && (
          <div className="split-picker-menu">
            {SPLIT_OPTIONS.map(opt => (
              <button
                key={opt.count}
                className={`split-picker-option ${splitCount === opt.count ? 'active' : ''}`}
                onClick={() => { setSplitCount(opt.count); setShowSplitMenu(false); }}
              >
                <SplitIcon count={opt.count} />
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* AI Provider quick switch */}
      <div className="status-item split-picker-wrap" style={{ position: 'relative' }}>
        <button
          className="split-picker-btn"
          onClick={() => setShowAiMenu(!showAiMenu)}
          title={t('ai_quick_switch')}
        >
          <Zap size={12} />
          <span>{activeProvider || 'AI'}</span>
        </button>
        {showAiMenu && (
          <div className="split-picker-menu" style={{ minWidth: 160 }}>
            {providers.map(p => (
              <button
                key={p.id}
                className={`split-picker-option ${p.name === activeProvider ? 'active' : ''}`}
                onClick={() => handleSwitchProvider(p.id)}
              >
                <span>{p.name}</span>
              </button>
            ))}
            {providers.length === 0 && (
              <div style={{ padding: '6px 10px', color: 'var(--text-muted)', fontSize: 11 }}>
                {t('ai_no_providers')}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="status-item">
        <Cloud size={11} />
        <span>25°C</span>
      </div>
      <div className="status-item">
        <span>{t('status_assets')}: {sessions.length}</span>
      </div>
      <div className="status-item">
        <Clock size={11} />
        <span>{new Date().toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>
  );
};

/** Mini icon showing the split layout grid */
const SplitIcon: React.FC<{ count: SplitCount }> = ({ count }) => {
  const w = 18, h = 12;
  const rects: React.ReactNode[] = [];
  const gap = 1;

  if (count === 1) {
    rects.push(<rect key={0} x={0} y={0} width={w} height={h} rx={1} fill="currentColor" opacity={0.6} />);
  } else if (count === 2) {
    const cw = (w - gap) / 2;
    rects.push(<rect key={0} x={0} y={0} width={cw} height={h} rx={1} fill="currentColor" opacity={0.6} />);
    rects.push(<rect key={1} x={cw + gap} y={0} width={cw} height={h} rx={1} fill="currentColor" opacity={0.6} />);
  } else {
    const cols = count <= 4 ? 2 : count <= 6 ? 3 : 4;
    const rows = 2;
    const cw = (w - gap * (cols - 1)) / cols;
    const ch = (h - gap) / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (r * cols + c < count) {
          rects.push(<rect key={`${r}-${c}`} x={c * (cw + gap)} y={r * (ch + gap)} width={cw} height={ch} rx={1} fill="currentColor" opacity={0.6} />);
        }
      }
    }
  }

  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>{rects}</svg>;
};
