import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
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
import { destroyTerminal, focusTerminalTab } from '../../lib/terminalLifecycle';
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
  onContextMenu: (e: React.MouseEvent) => void;
  onClose: () => void;
}> = ({ tab, active, onSelect, onMiddleClick, onContextMenu, onClose }) => {
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
      onContextMenu={onContextMenu}
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
  const [tabContextMenu, setTabContextMenu] = useState<{
    x: number;
    y: number;
    tabId: string;
    isAssetList: boolean;
  } | null>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const tabMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tabContextMenu) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (
        tabMenuRef.current &&
        (!(e.target instanceof Node) || !tabMenuRef.current.contains(e.target))
      ) {
        setTabContextMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTabContextMenu(null);
    };
    const handleBlur = () => setTabContextMenu(null);
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', handleBlur);
    };
  }, [tabContextMenu]);

  const isConnectedInteractiveTab = (tabId: string) => {
    const tab = tabs.find((tb) => tb.id === tabId);
    if (!tab || tab.type === 'asset-list') return false;
    return !!tab.connected;
  };

  const doCloseTab = (tabId: string) => {
    destroyTerminal(tabId);
    removeTab(tabId);
  };

  const handleCloseTabs = (tabIds: string[]) => {
    if (tabIds.length === 0) return;
    const { tabCloseConfirm } = useSettingsStore.getState().settings;
    const connectedCount = tabIds.filter((id) => isConnectedInteractiveTab(id)).length;
    if (tabCloseConfirm && connectedCount > 0) {
      const message =
        connectedCount === 1
          ? t('tab_close_confirm_msg')
          : t('tab_ctx_close_multi_confirm_msg', { count: connectedCount });
      void confirm({
        title: t('tab_close_confirm_btn'),
        message,
        confirmLabel: t('tab_close_confirm_btn'),
        cancelLabel: t('common_cancel'),
        danger: true,
      }).then((ok) => {
        if (ok) {
          tabIds.forEach(doCloseTab);
        }
      });
      return;
    }
    tabIds.forEach(doCloseTab);
  };

  const handleCloseTab = (tabId: string) => {
    handleCloseTabs([tabId]);
  };

  const openTabContextMenu = (e: React.MouseEvent, tab: TabInfo) => {
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 176;
    const menuHeight = tab.type === 'asset-list' ? 44 : 156;
    const x = Math.min(e.clientX, Math.max(8, window.innerWidth - menuWidth - 8));
    const y = Math.min(e.clientY, Math.max(8, window.innerHeight - menuHeight - 8));
    setTabContextMenu({
      x,
      y,
      tabId: tab.id,
      isAssetList: tab.type === 'asset-list',
    });
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
              onContextMenu={(e) => openTabContextMenu(e, tab)}
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
                onSelect={() => {
                  setActiveTab(tab.id);
                  focusTerminalTab(tab.id);
                }}
                onMiddleClick={(e) => handleMiddleClick(e, tab.id)}
                onContextMenu={(e) => openTabContextMenu(e, tab)}
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

      {tabContextMenu &&
        createPortal(
          (() => {
            const targetIdx = terminalTabs.findIndex((tb) => tb.id === tabContextMenu.tabId);
            const otherIds = terminalTabs
              .filter((tb) => tb.id !== tabContextMenu.tabId)
              .map((tb) => tb.id);
            const rightIds =
              targetIdx >= 0 ? terminalTabs.slice(targetIdx + 1).map((tb) => tb.id) : [];
            const allIds = terminalTabs.map((tb) => tb.id);
            return (
              <div
                ref={tabMenuRef}
                className="context-menu"
                role="menu"
                style={{ top: tabContextMenu.y, left: tabContextMenu.x }}
                onContextMenu={(e) => e.preventDefault()}
              >
                {!tabContextMenu.isAssetList && (
                  <>
                    <button
                      type="button"
                      className="context-menu-item"
                      role="menuitem"
                      onClick={() => {
                        setTabContextMenu(null);
                        handleCloseTab(tabContextMenu.tabId);
                      }}
                    >
                      {t('tab_ctx_close')}
                    </button>
                    <button
                      type="button"
                      className="context-menu-item"
                      role="menuitem"
                      disabled={otherIds.length === 0}
                      onClick={() => {
                        setTabContextMenu(null);
                        handleCloseTabs(otherIds);
                      }}
                    >
                      {t('tab_ctx_close_others')}
                    </button>
                    <button
                      type="button"
                      className="context-menu-item"
                      role="menuitem"
                      disabled={rightIds.length === 0}
                      onClick={() => {
                        setTabContextMenu(null);
                        handleCloseTabs(rightIds);
                      }}
                    >
                      {t('tab_ctx_close_right')}
                    </button>
                    <div className="context-menu-divider" />
                  </>
                )}
                <button
                  type="button"
                  className="context-menu-item"
                  role="menuitem"
                  disabled={allIds.length === 0}
                  onClick={() => {
                    setTabContextMenu(null);
                    handleCloseTabs(allIds);
                  }}
                >
                  {t('tab_ctx_close_all')}
                </button>
              </div>
            );
          })(),
          document.body,
        )}
    </div>
  );
};
