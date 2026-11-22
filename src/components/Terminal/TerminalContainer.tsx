import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../stores/appStore';
import { TerminalView } from './TerminalView';
import { TerminalAiDock } from './TerminalAiDock';
import { AssetTable } from '../AssetTable/AssetTable';

export const TerminalContainer: React.FC = () => {
  const { tabs, activeTabId, mainView, splitCount, splitPanes, setActiveTab } = useAppStore(
    useShallow((s) => ({
      tabs: s.tabs,
      activeTabId: s.activeTabId,
      mainView: s.mainView,
      splitCount: s.splitCount,
      splitPanes: s.splitPanes,
      setActiveTab: s.setActiveTab,
    })),
  );

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

  const splitActive = splitCount > 1;
  const slotIds = splitActive ? new Set(splitPanes.filter((id): id is string => id != null)) : null;
  const offGrid = slotIds ? terminalTabs.filter((t) => !slotIds.has(t.id)) : [];

  return (
    <div
      className={
        splitActive
          ? `terminal-container terminal-split-grid split-${splitCount}`
          : 'terminal-container'
      }
    >
      {splitActive ? (
        <>
          {splitPanes.map((id, slot) => {
            if (id == null) {
              return <div key={`empty-${slot}`} className="terminal-pane-empty" />;
            }
            const tab = terminalTabs.find((t) => t.id === id);
            if (!tab) {
              return <div key={`gone-${slot}`} className="terminal-pane-empty" />;
            }
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                className={`terminal-pane-cell${isActive ? ' is-active-pane' : ''}`}
                onMouseDown={() => {
                  if (!isActive) setActiveTab(tab.id);
                }}
              >
                <TerminalView tab={tab} isActive={isActive} visible />
              </div>
            );
          })}
          {offGrid.length > 0 && (
            <div style={{ display: 'none' }}>
              {offGrid.map((tab) => (
                <TerminalView key={tab.id} tab={tab} isActive={false} visible={false} />
              ))}
            </div>
          )}
        </>
      ) : (
        terminalTabs.map((tab) => (
          <TerminalView key={tab.id} tab={tab} isActive={tab.id === activeTabId} />
        ))
      )}
      <TerminalAiDock />
    </div>
  );
};
