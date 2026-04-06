import React, { useEffect, useCallback } from 'react';
import { useAppStore, type SplitCount } from '../../stores/appStore';
import { TerminalView, terminalInstances } from './TerminalView';
import { AssetTable } from '../AssetTable/AssetTable';

/** CSS grid template for each split count */
const GRID_TEMPLATES: Record<SplitCount, { cols: string; rows: string }> = {
  1: { cols: '1fr', rows: '1fr' },
  2: { cols: '1fr 1fr', rows: '1fr' },
  4: { cols: '1fr 1fr', rows: '1fr 1fr' },
  6: { cols: '1fr 1fr 1fr', rows: '1fr 1fr' },
  8: { cols: '1fr 1fr 1fr 1fr', rows: '1fr 1fr' },
};

export const TerminalContainer: React.FC = () => {
  const {
    tabs, activeTabId, mainView,
    splitCount, splitPanes, assignPane, focusedPane, setFocusedPane, setActiveTab,
  } = useAppStore();

  // Show asset table when the active tab is the asset-list tab
  if (activeTabId === 'asset-list' || mainView === 'asset-list') {
    return (
      <div className="terminal-container">
        <AssetTable />
      </div>
    );
  }

  const terminalTabs = tabs.filter((t) => t.type !== 'asset-list');

  if (terminalTabs.length === 0) {
    return (
      <div className="terminal-container">
        <AssetTable />
      </div>
    );
  }

  // Single pane mode (splitCount === 1): render the classic way
  if (splitCount === 1) {
    return (
      <div className="terminal-container">
        {terminalTabs.map((tab) => (
          <TerminalView key={tab.id} tab={tab} isActive={tab.id === activeTabId} />
        ))}
      </div>
    );
  }

  // Multi-pane split mode
  const grid = GRID_TEMPLATES[splitCount];

  return (
    <div
      className="terminal-container terminal-split-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: grid.cols,
        gridTemplateRows: grid.rows,
        gap: '1px',
      }}
    >
      {splitPanes.slice(0, splitCount).map((paneTabId, idx) => {
        const paneTab = paneTabId ? terminalTabs.find(t => t.id === paneTabId) : null;
        return (
          <SplitPane
            key={idx}
            slotIndex={idx}
            tab={paneTab ?? null}
            allTabs={terminalTabs}
            isFocused={focusedPane === idx}
            onFocus={() => { setFocusedPane(idx); if (paneTab) setActiveTab(paneTab.id); }}
            onAssign={(tabId) => assignPane(idx, tabId)}
          />
        );
      })}
      {/* Keep all terminal instances alive (hidden) so connections persist */}
      <div style={{ display: 'none' }}>
        {terminalTabs.filter(t => !splitPanes.includes(t.id)).map(tab => (
          <TerminalView key={tab.id} tab={tab} isActive={false} />
        ))}
      </div>
    </div>
  );
};

/* ---- Individual split pane ---- */
interface SplitPaneProps {
  slotIndex: number;
  tab: import('../../types').TabInfo | null;
  allTabs: import('../../types').TabInfo[];
  isFocused: boolean;
  onFocus: () => void;
  onAssign: (tabId: string) => void;
}

const SplitPane: React.FC<SplitPaneProps> = ({ slotIndex, tab, allTabs, isFocused, onFocus, onAssign }) => {
  const t = useAppStore(s => s.t);

  // When a pane becomes focused, re-fit the terminal
  useEffect(() => {
    if (isFocused && tab) {
      const inst = terminalInstances.get(tab.id);
      if (inst) {
        requestAnimationFrame(() => {
          try { inst.fitAddon.fit(); inst.terminal.focus(); } catch {}
        });
      }
    }
  }, [isFocused, tab?.id]);

  // Also re-fit when the pane's tab changes
  const refitOnResize = useCallback(() => {
    if (tab) {
      const inst = terminalInstances.get(tab.id);
      if (inst) { try { inst.fitAddon.fit(); } catch {} }
    }
  }, [tab?.id]);

  useEffect(() => {
    const observer = new ResizeObserver(refitOnResize);
    const el = document.getElementById(`split-pane-${slotIndex}`);
    if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [slotIndex, refitOnResize]);

  if (!tab) {
    return (
      <div
        id={`split-pane-${slotIndex}`}
        className="split-pane split-pane-empty"
        onClick={onFocus}
      >
        <select
          className="split-pane-select"
          value=""
          onChange={e => { if (e.target.value) onAssign(e.target.value); }}
        >
          <option value="">{t('split_select_tab')}</option>
          {allTabs.map(t => (
            <option key={t.id} value={t.id}>{t.title}</option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div
      id={`split-pane-${slotIndex}`}
      className={`split-pane ${isFocused ? 'split-pane-focused' : ''}`}
      onClick={onFocus}
    >
      <div className="split-pane-header">
        <span className="split-pane-title">
          <span className={`tab-dot ${tab.type}`} />
          {tab.title}
        </span>
        <select
          className="split-pane-switch"
          value={tab.id}
          onChange={e => onAssign(e.target.value)}
          onClick={e => e.stopPropagation()}
        >
          {allTabs.map(t => (
            <option key={t.id} value={t.id}>{t.title}</option>
          ))}
        </select>
      </div>
      <TerminalView tab={tab} isActive={isFocused} forceVisible />
    </div>
  );
};
