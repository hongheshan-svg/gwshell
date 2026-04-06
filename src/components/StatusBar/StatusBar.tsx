import React, { useState } from 'react';
import { Wifi, Clock, Monitor, Cloud, LayoutGrid } from 'lucide-react';
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

  return (
    <div className="status-bar">
      <div className="status-item">
        <Monitor size={11} />
        <span>GWShell v0.1.0</span>
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
