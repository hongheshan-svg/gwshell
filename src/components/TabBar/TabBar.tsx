import React from 'react';
import { X, Plus, Menu, ChevronDown } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

export const TabBar: React.FC = () => {
  const { tabs, activeTabId, setActiveTab, removeTab, setShowNewSession } = useAppStore();

  const handleMiddleClick = (e: React.MouseEvent, tabId: string) => {
    if (e.button === 1) {
      e.preventDefault();
      removeTab(tabId);
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
              <span>{tab.title}</span>
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
                  removeTab(tab.id);
                }}
              >
                <X size={10} />
              </button>
            </>
          )}
        </div>
      ))}
      <button className="tab-add-btn" onClick={() => setShowNewSession(true)} title="新建标签">
        <Plus size={14} />
      </button>
    </div>
  );
};
