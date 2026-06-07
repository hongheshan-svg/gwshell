import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Plus, Menu, ChevronDown, FolderOpen, Columns2, PanelLeftOpen } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { NewAssetMenu } from '../Sidebar/NewAssetMenu';

export const TabBar: React.FC = () => {
  const { tabs, activeTabId, setActiveTab, removeTab, setShowNewSession, setShowSerialModal, setShowDockerModal, setShowLocalTerminalModal, setShowQuickConnect, sftpPanelOpen, toggleSftpPanel, splitTabId, setSplitTabId, sidebarCollapsed, toggleSidebar } = useAppStore();
  const { t } = useTranslation();
  const [showNewAssetMenu, setShowNewAssetMenu] = useState(false);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const supportedQuickCreateTypes = new Set(['ssh', 'ssh-tunnel']);

  const handleCloseTab = (tabId: string) => {
    import('../Terminal/TerminalView').then(({ destroyTerminal }) => {
      destroyTerminal(tabId);
    });
    removeTab(tabId);
  };

  const handleMiddleClick = (e: React.MouseEvent, tabId: string) => {
    if (e.button === 1) {
      e.preventDefault();
      handleCloseTab(tabId);
    }
  };

  const terminalTabs = tabs.filter((tab) => tab.type !== 'asset-list');

  const handleToggleSplit = () => {
    if (splitTabId) {
      setSplitTabId(null);
      return;
    }
    // Pick a sensible second pane: the most-recent OTHER terminal tab.
    const partner = [...terminalTabs].reverse().find((tab) => tab.id !== activeTabId);
    if (partner) setSplitTabId(partner.id);
  };

  const handleNewAssetSelect = (type: string) => {
    if (type === 'quickconnect') { setShowQuickConnect(true); return; }
    if (supportedQuickCreateTypes.has(type)) {
      setShowNewSession(true);
    } else if (type === 'serial') {
      setShowSerialModal(true);
    } else if (type === 'docker') {
      setShowDockerModal(true);
    } else if (type === 'localshell') {
      setShowLocalTerminalModal(true);
    }
  };

  return (
    <div className="tab-bar">
      {sidebarCollapsed && (
        <button className="tab-add-btn" onClick={toggleSidebar} title={t('nav_toggle_sidebar')}>
          <PanelLeftOpen size={14} />
        </button>
      )}
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab-item ${tab.type === 'asset-list' ? 'asset-list-tab' : ''} ${tab.id === activeTabId ? 'active' : ''}`}
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
              <span className={`tab-dot ${tab.connected ? 'connected' : 'disconnected'}`} />
              <span className="tab-title">{tab.title}</span>
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
      <button ref={addBtnRef} className="tab-add-btn" onClick={() => setShowNewAssetMenu(true)} title={t('tab_new')}>
        <Plus size={14} />
      </button>
      {showNewAssetMenu && (
        <NewAssetMenu
          anchorRef={addBtnRef}
          onClose={() => setShowNewAssetMenu(false)}
          onSelect={handleNewAssetSelect}
        />
      )}
      {/* Split toggle - only show when there are >=2 terminal tabs to lay side by side */}
      {terminalTabs.length >= 2 && (
        <button
          className={`tab-add-btn ${(splitTabId != null && splitTabId !== activeTabId) ? 'tab-btn-active' : ''}`}
          onClick={handleToggleSplit}
          title={t('split_toggle')}
          style={{ marginLeft: 'auto' }}
        >
          <Columns2 size={14} />
        </button>
      )}
      {/* SFTP toggle - only show when active tab is SSH */}
      {(() => {
        const activeTab = tabs.find((t) => t.id === activeTabId);
        return activeTab?.type === 'ssh' ? (
          <button
            className={`tab-add-btn ${sftpPanelOpen ? 'tab-btn-active' : ''}`}
            onClick={toggleSftpPanel}
            title={t('sftp_title')}
            // The split button (shown when >=2 terminal tabs) already carries
            // marginLeft:auto to push the right-aligned group over; avoid a
            // second auto-margin that would split them apart.
            style={terminalTabs.length >= 2 ? undefined : { marginLeft: 'auto' }}
          >
            <FolderOpen size={14} />
          </button>
        ) : null;
      })()}
    </div>
  );
};
