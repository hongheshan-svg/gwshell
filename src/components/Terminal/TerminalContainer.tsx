import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../stores/appStore';
import { TerminalView } from './TerminalView';
import { AssetTable } from '../AssetTable/AssetTable';

export const TerminalContainer: React.FC = () => {
  const { tabs, activeTabId, mainView, splitTabId } = useAppStore(useShallow((s) => ({
    tabs: s.tabs,
    activeTabId: s.activeTabId,
    mainView: s.mainView,
    splitTabId: s.splitTabId,
  })));

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

  // Split is opt-in. It only engages when a distinct, still-open second tab is
  // selected as the split partner. Otherwise we fall through to the original
  // single-pane render below, untouched.
  const splitActive =
    splitTabId != null &&
    splitTabId !== activeTabId &&
    terminalTabs.some((t) => t.id === splitTabId);

  if (splitActive) {
    return (
      <div className="terminal-container terminal-split-grid">
        {terminalTabs.map((tab) => (
          <TerminalView
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            visible={tab.id === activeTabId || tab.id === splitTabId}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="terminal-container">
      {terminalTabs.map((tab) => (
        <TerminalView key={tab.id} tab={tab} isActive={tab.id === activeTabId} />
      ))}
    </div>
  );
};
