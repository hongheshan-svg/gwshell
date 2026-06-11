import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Plus, Menu, FolderOpen, Columns2, PanelLeftOpen, Square, Grid2x2, LayoutGrid } from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAppStore } from '../../stores/appStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { NewAssetMenu } from '../Sidebar/NewAssetMenu';
import type { TabInfo } from '../../types';

// One draggable terminal tab. Sorting is pointer-driven with a small
// activation distance so plain clicks (select) and middle clicks (close)
// keep working without starting a drag.
const SortableTab: React.FC<{
  tab: TabInfo;
  active: boolean;
  onSelect: () => void;
  onMiddleClick: (e: React.MouseEvent) => void;
  onClose: () => void;
}> = ({ tab, active, onSelect, onMiddleClick, onClose }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : undefined,
        zIndex: isDragging ? 10 : undefined,
      }}
      className={`tab-item ${active ? 'active' : ''}`}
      onClick={onSelect}
      onMouseDown={onMiddleClick}
    >
      <span className={`tab-dot ${tab.connected ? 'connected' : 'disconnected'}`} />
      <span className="tab-title">{tab.title}</span>
      <button
        className="tab-close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <X size={10} />
      </button>
    </div>
  );
};

export const TabBar: React.FC = () => {
  const { tabs, activeTabId, setActiveTab, removeTab, reorderTabs, setShowNewSession, setShowSerialModal, setShowDockerModal, setShowLocalTerminalModal, setShowQuickConnect, sftpPanelOpen, toggleSftpPanel, splitCount, setSplitCount, sidebarCollapsed, toggleSidebar } = useAppStore();
  const { t } = useTranslation();
  const [showNewAssetMenu, setShowNewAssetMenu] = useState(false);
  const [splitMenuOpen, setSplitMenuOpen] = useState(false);
  // Tab awaiting in-app close confirmation (replaces window.confirm, whose
  // native dialog clashes with the app's visual language).
  const [confirmTabId, setConfirmTabId] = useState<string | null>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const supportedQuickCreateTypes = new Set(['ssh', 'ssh-tunnel']);

  const isConnectedInteractiveTab = (tabId: string) => {
    const tab = tabs.find((tb) => tb.id === tabId);
    if (!tab) return false;
    if (tab.type === 'asset-list') return false;
    return !!tab.connected;
  };

  const doCloseTab = (tabId: string) => {
    import('../Terminal/TerminalView').then(({ destroyTerminal }) => {
      destroyTerminal(tabId);
    });
    removeTab(tabId);
  };

  const handleCloseTab = (tabId: string) => {
    const { tabCloseConfirm } = useSettingsStore.getState().settings;
    if (tabCloseConfirm && isConnectedInteractiveTab(tabId)) {
      setConfirmTabId(tabId);
      return;
    }
    doCloseTab(tabId);
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

  // Drag starts only after the pointer moves a few pixels, so clicks still
  // select and middle clicks still close.
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const handleDragEnd = (e: DragEndEvent) => {
    const overId = e.over?.id;
    if (overId && overId !== e.active.id) {
      reorderTabs(String(e.active.id), String(overId));
    }
  };

  return (
    <div className="tab-bar">
      {sidebarCollapsed && (
        <button className="tab-add-btn" onClick={toggleSidebar} title={t('nav_toggle_sidebar')}>
          <PanelLeftOpen size={14} />
        </button>
      )}
      {/* The asset-list home tab is pinned first and not draggable. */}
      {tabs.filter((tab) => tab.type === 'asset-list').map((tab) => (
        <div
          key={tab.id}
          className={`tab-item asset-list-tab ${tab.id === activeTabId ? 'active' : ''}`}
          onClick={() => setActiveTab(tab.id)}
        >
          <Menu size={13} />
          <span>{t('tab_list')}</span>
        </div>
      ))}
      <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={terminalTabs.map((tab) => tab.id)} strategy={horizontalListSortingStrategy}>
          {terminalTabs.map((tab) => (
            <SortableTab
              key={tab.id}
              tab={tab}
              active={tab.id === activeTabId}
              onSelect={() => setActiveTab(tab.id)}
              onMiddleClick={(e) => handleMiddleClick(e, tab.id)}
              onClose={() => handleCloseTab(tab.id)}
            />
          ))}
        </SortableContext>
      </DndContext>
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
      {/* In-app close confirmation (replaces native window.confirm) */}
      {confirmTabId && (
        <div
          className="modal-overlay"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmTabId(null); }}
        >
          <div className="confirm-dialog" role="alertdialog" aria-modal="true">
            <p className="confirm-dialog-text">{t('tab_close_confirm_msg')}</p>
            <div className="confirm-dialog-actions">
              <button className="settings-btn-outline" onClick={() => setConfirmTabId(null)} autoFocus>
                {t('common_cancel')}
              </button>
              <button
                className="settings-btn-danger"
                onClick={() => {
                  const id = confirmTabId;
                  setConfirmTabId(null);
                  doCloseTab(id);
                }}
              >
                {t('tab_close_confirm_btn')}
              </button>
            </div>
          </div>
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
