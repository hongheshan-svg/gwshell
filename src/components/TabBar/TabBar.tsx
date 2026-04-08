import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Plus, Menu, ChevronDown, FolderOpen } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { NewAssetMenu } from '../Sidebar/NewAssetMenu';

export const TabBar: React.FC = () => {
  const { tabs, activeTabId, setActiveTab, removeTab, setShowNewSession, setShowSerialModal, setShowDockerModal, setShowLocalTerminalModal, sftpPanelOpen, toggleSftpPanel } = useAppStore();
  const { t } = useTranslation();
  const [showNewAssetMenu, setShowNewAssetMenu] = useState(false);
  const addBtnRef = useRef<HTMLButtonElement>(null);

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

  const handleNewAssetSelect = (type: string) => {
    if (type === 'ssh' || type === 'ssh-tunnel' || type === 'rdp' || type === 'telnet') {
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
      {/* SFTP toggle - only show when active tab is SSH */}
      {(() => {
        const activeTab = tabs.find((t) => t.id === activeTabId);
        return activeTab?.type === 'ssh' ? (
          <button
            className={`tab-add-btn ${sftpPanelOpen ? 'tab-btn-active' : ''}`}
            onClick={toggleSftpPanel}
            title={t('sftp_title')}
            style={{ marginLeft: 'auto' }}
          >
            <FolderOpen size={14} />
          </button>
        ) : null;
      })()}
    </div>
  );
};
