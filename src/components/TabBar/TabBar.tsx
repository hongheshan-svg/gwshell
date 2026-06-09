import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Plus, Menu, ChevronDown, FolderOpen, Columns2, PanelLeftOpen, Square, Grid2x2, LayoutGrid } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { NewAssetMenu } from '../Sidebar/NewAssetMenu';

export const TabBar: React.FC = () => {
  const { tabs, activeTabId, setActiveTab, removeTab, setShowNewSession, setShowSerialModal, setShowDockerModal, setShowLocalTerminalModal, setShowQuickConnect, sftpPanelOpen, toggleSftpPanel, splitCount, setSplitCount, sidebarCollapsed, toggleSidebar } = useAppStore();
  const { t } = useTranslation();
  const [showNewAssetMenu, setShowNewAssetMenu] = useState(false);
  const [splitMenuOpen, setSplitMenuOpen] = useState(false);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const supportedQuickCreateTypes = new Set(['ssh', 'ssh-tunnel']);

  const isConnectedInteractiveTab = (tabId: string) => {
    const tab = tabs.find((tb) => tb.id === tabId);
    if (!tab) return false;
    if (tab.type === 'asset-list') return false;
    return !!tab.connected;
  };

  const confirmClose = (tabId: string): boolean => {
    const { tabCloseConfirm } = useSettingsStore.getState().settings;
    if (tabCloseConfirm && isConnectedInteractiveTab(tabId)) {
      return window.confirm(t('tab_close_confirm_msg'));
    }
    return true;
  };

  const handleCloseTab = (tabId: string) => {
    if (!confirmClose(tabId)) return;
    import('../Terminal/TerminalView').then(({ destroyTerminal }) => {
      destroyTerminal(tabId);
    });
    removeTab(tabId);
  };

  const handleMiddleClick = (e: React.MouseEvent, tabId: string) => {
    if (e.button === 1) {
      e.preventDefault();
      const { middleClickCloseTab } = useSettingsStore.getState().settings;
      if (!middleClickCloseTab) return;
      handleCloseTab(tabId);
    }
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

  const terminalTabs = tabs.filter((tab) => tab.type !== 'asset-list');

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
      {/* Split count selector - only show when there are >=2 terminal tabs */}
      {terminalTabs.length >= 2 && (
        <div className="split-selector" style={{ marginLeft: 'auto', position: 'relative' }}>
          <button
            className={`tab-add-btn ${splitCount > 1 ? 'tab-btn-active' : ''}`}
            onClick={() => setSplitMenuOpen((v) => !v)}
            title={t('split_layout')}
          >
            <Columns2 size={14} />
          </button>
          {splitMenuOpen && (
            <>
              <div className="split-menu-backdrop" onClick={() => setSplitMenuOpen(false)} />
              <div className="split-menu">
                {([1, 2, 4, 6, 8] as const).map((n) => (
                  <button
                    key={n}
                    className={`split-menu-item${splitCount === n ? ' active' : ''}`}
                    onClick={() => { setSplitCount(n); setSplitMenuOpen(false); }}
                  >
                    {n === 1 ? <Square size={14} /> : n === 2 ? <Columns2 size={14} /> : n === 4 ? <Grid2x2 size={14} /> : <LayoutGrid size={14} />}
                    <span>{n === 1 ? t('split_single') : `${n}`}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {/* SFTP toggle - only show when active tab is SSH */}
      {(() => {
        const activeTab = tabs.find((t) => t.id === activeTabId);
        return activeTab?.type === 'ssh' ? (
          <button
            className={`tab-add-btn ${sftpPanelOpen ? 'tab-btn-active' : ''}`}
            onClick={toggleSftpPanel}
            title={t('sftp_title')}
            // The split selector (shown when >=2 terminal tabs) already carries
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
