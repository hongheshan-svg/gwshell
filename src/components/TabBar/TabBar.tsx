import React from 'react';
import { X, Plus, Menu, ChevronDown } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { destroyTerminal } from '../Terminal/TerminalView';

export const TabBar: React.FC = () => {
  const { tabs, activeTabId, setActiveTab, removeTab, setShowNewSession, t } = useAppStore();

  const handleCloseTab = (tabId: string) => {
    destroyTerminal(tabId);
    removeTab(tabId);
  };

  const handleMiddleClick = (e: React.MouseEvent, tabId: string) => {
    if (e.button === 1) {
      e.preventDefault();
      handleCloseTab(tabId);
    }
  };

  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab-item ${tab.id === activeTabId ? 'active' : ''}`}
          onClick={() => setActiveTab(tab.id)}
          onMouseDown={(e) => handleMiddleClick(e, tab.id)}
        >
          {tab.type === 'asset-list' ? (
            <>
              <Menu size={13} />
              <span>{t('tab_list')}</span>
              <ChevronDown size={11} />
            </>
          ) : (
            <>
              <span className={`tab-dot ${tab.type}`} />
              <span>{tab.title}</span>
              <button
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCloseTab(tab.id);
                }}
              >
                <X size={10} />
              </button>
            </>
          )}
        </div>
      ))}
      <button className="tab-add-btn" onClick={() => setShowNewSession(true)} title={t('tab_new')}>
        <Plus size={14} />
      </button>
    </div>
  );
};
