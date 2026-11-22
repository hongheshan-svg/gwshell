import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Plus, FolderOpen, Columns2, Square, Grid2x2, LayoutGrid } from 'lucide-react';
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
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../stores/appStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useConfirm } from '../../hooks/useConfirm';
import { openNewAssetModal } from '../../lib/newAssetAction';
import { destroyTerminal } from '../../lib/terminalLifecycle';
import { NewAssetMenu } from '../Sidebar/NewAssetMenu';
import { ProtocolIcon, type ProtocolIconType } from '../Icons/BrandIcons';
import type { TabInfo } from '../../types';

function tabProtoType(type: TabInfo['type']): ProtocolIconType {
  if (type === 'docker' || type === 'serial' || type === 'localshell') return type;
  return 'ssh';
}

const SortableTab: React.FC<{
  tab: TabInfo;
  active: boolean;
  onSelect: () => void;
  onMiddleClick: (e: React.MouseEvent) => void;
  onClose: () => void;
}> = ({ tab, active, onSelect, onMiddleClick, onClose }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
  });
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
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      onClick={onSelect}
      onMouseDown={onMiddleClick}
    >
      <span className="tab-proto-wrap">
        <ProtocolIcon type={tabProtoType(tab.type)} size={14} />
        <span className={`tab-live-dot ${tab.connected ? 'connected' : 'disconnected'}`} />
      </span>
      <span className="tab-title">{tab.title}</span>
      <button
        type="button"
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
  const {
    tabs,
    activeTabId,
    setActiveTab,
    removeTab,
    reorderTabs,
    sftpPanelOpen,
    toggleSftpPanel,
    splitCount,
    setSplitCount,
  } = useAppStore(
    useShallow((s) => ({
      tabs: s.tabs,
      activeTabId: s.activeTabId,
      setActiveTab: s.setActiveTab,
      removeTab: s.removeTab,
      reorderTabs: s.reorderTabs,
      sftpPanelOpen: s.sftpPanelOpen,
      toggleSftpPanel: s.toggleSftpPanel,
      splitCount: s.splitCount,
      setSplitCount: s.setSplitCount,
    })),
  );
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [showNewAssetMenu, setShowNewAssetMenu] = useState(false);
  const [splitMenuOpen, setSplitMenuOpen] = useState(false);
  const addBtnRef = useRef<HTMLButtonElement>(null);

  const isConnectedInteractiveTab = (tabId: string) => {
    const tab = tabs.find((tb) => tb.id === tabId);
    if (!tab || tab.type === 'asset-list') return false;
    return !!tab.connected;
  };

  const doCloseTab = (tabId: string) => {
    destroyTerminal(tabId);
    removeTab(tabId);
  };

  const handleCloseTab = (tabId: string) => {
    const { tabCloseConfirm } = useSettingsStore.getState().settings;
    if (tabCloseConfirm && isConnectedInteractiveTab(tabId)) {
      void confirm({
        title: t('tab_close_confirm_btn'),
        message: t('tab_close_confirm_msg'),
        confirmLabel: t('tab_close_confirm_btn'),
        cancelLabel: t('common_cancel'),
        danger: true,
      }).then((ok) => {
        if (ok) doCloseTab(tabId);
      });
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

  const terminalTabs = tabs.filter((tab) => tab.type !== 'asset-list');
  const activeTab = tabs.find((tab) => tab.id === activeTabId);

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const handleDragEnd = (e: DragEndEvent) => {
    const overId = e.over?.id;
    if (overId && overId !== e.active.id) {
      reorderTabs(String(e.active.id), String(overId));
    }
  };

  return (
    <div className="tab-bar tab-bar--unified" role="tablist">
      <div className="tab-bar-strip">
        {tabs
          .filter((tab) => tab.type === 'asset-list')
          .map((tab) => (
            <div
              key={tab.id}
              className={`tab-item asset-list-tab ${tab.id === activeTabId ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <LayoutGrid size={13} />
              <span>{t('tab_list')}</span>
            </div>
          ))}
        <DndContext
          sensors={dndSensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={terminalTabs.map((tab) => tab.id)}
            strategy={horizontalListSortingStrategy}
          >
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
        <button
          type="button"
          ref={addBtnRef}
          className="tab-add-btn"
          onClick={() => setShowNewAssetMenu(true)}
          title={t('tab_new')}
        >
          <Plus size={14} />
        </button>
        {showNewAssetMenu && (
          <NewAssetMenu
            anchorRef={addBtnRef}
            onClose={() => setShowNewAssetMenu(false)}
            onSelect={openNewAssetModal}
          />
        )}
      </div>

      {/* Drag spacer keeps the unified titlebar natively draggable */}
      <div className="tab-bar-drag-spacer" data-tauri-drag-region />

      {(terminalTabs.length >= 2 || activeTab?.type === 'ssh') && (
        <div className="tab-bar-right">
          {terminalTabs.length >= 2 && (
            <div className="split-selector">
              <button
                type="button"
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
                    {/* eslint-disable-next-line no-restricted-syntax */}
                    {([1, 2, 4, 6, 8] as const).map((n) => (
                      <button
                        type="button"
                        key={n}
                        className={`split-menu-item${splitCount === n ? ' active' : ''}`}
                        onClick={() => {
                          setSplitCount(n);
                          setSplitMenuOpen(false);
                        }}
                      >
                        {n === 1 ? (
                          <Square size={14} />
                        ) : n === 2 ? (
                          <Columns2 size={14} />
                        ) : n === 4 ? (
                          <Grid2x2 size={14} />
                        ) : (
                          <LayoutGrid size={14} />
                        )}
                        <span>{n === 1 ? t('split_single') : `${n}`}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {activeTab?.type === 'ssh' && (
            <button
              type="button"
              className={`tab-action-pill ${sftpPanelOpen ? 'titlebar-btn--active' : ''}`}
              onClick={toggleSftpPanel}
              title={t('sftp_title')}
            >
              <FolderOpen size={13} />
              <span>SFTP</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
