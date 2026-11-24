import React from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../stores/appStore';
import { TerminalView } from './TerminalView';
import { TerminalAiDock } from './TerminalAiDock';
import { EmptyIllustration } from '../Icons/BrandIcons';

export const TerminalContainer: React.FC = () => {
  const { t } = useTranslation();
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

  const terminalTabs = tabs.filter((t) => t.type !== 'asset-list');

  if (terminalTabs.length === 0) {
    return null;
  }

  // App.tsx keeps TerminalContainer mounted (hidden via display: none) while the
  // Asset List is shown so live SSH/PTY/Serial tabs never unmount and tear down
  // their data/exit/input listeners. Mark all panes inactive while hidden so they
  // don't steal focus from Asset List controls.
  const viewingAssetList = activeTabId === 'asset-list' || mainView === 'asset-list';
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
              return (
                <div key={`empty-${slot}`} className="terminal-pane-empty">
                  <EmptyIllustration variant="split" size={52} />
                  <span>{t('split_empty_slot_hint')}</span>
                </div>
              );
            }
            const tab = terminalTabs.find((t) => t.id === id);
            if (!tab) {
              return (
                <div key={`gone-${slot}`} className="terminal-pane-empty">
                  <EmptyIllustration variant="split" size={52} />
                  <span>{t('split_empty_slot_hint')}</span>
                </div>
              );
            }
            const isActive = !viewingAssetList && tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                className={`terminal-pane-cell${isActive ? ' is-active-pane' : ''}`}
                onMouseDown={() => {
                  if (!isActive) setActiveTab(tab.id);
                }}
              >
                <TerminalView tab={tab} isActive={isActive} visible={!viewingAssetList} />
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
          <TerminalView
            key={tab.id}
            tab={tab}
            isActive={!viewingAssetList && tab.id === activeTabId}
          />
        ))
      )}
      <TerminalAiDock />
    </div>
  );
};
