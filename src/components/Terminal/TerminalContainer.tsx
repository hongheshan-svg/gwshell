import React from 'react';
import { useAppStore } from '../../stores/appStore';
import { TerminalView } from './TerminalView';
import { AssetTable } from '../AssetTable/AssetTable';

export const TerminalContainer: React.FC = () => {
  const { tabs, activeTabId, mainView } = useAppStore();

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

  return (
    <div className="terminal-container">
      {terminalTabs.map((tab) => (
        <TerminalView key={tab.id} tab={tab} isActive={tab.id === activeTabId} />
      ))}
    </div>
  );
};
