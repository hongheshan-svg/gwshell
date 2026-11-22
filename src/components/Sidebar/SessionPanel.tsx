import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronRight,
  ChevronDown,
  Monitor,
  Plus,
  Search,
  Server,
  FolderOpen,
  Folder,
  Settings,
  Copy,
  Play,
  Edit,
  Trash2,
  Box,
  Usb,
  TerminalSquare,
  X,
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useConfirm } from '../../hooks/useConfirm';
import { openNewAssetModal } from '../../lib/newAssetAction';
import { NewAssetMenu } from './NewAssetMenu';
import type { SessionConfig } from '../../types';

export const SessionPanel: React.FC = () => {
  const { t } = useTranslation();
  const confirm = useConfirm();
  // Sessions drive the list; subscribe to the array directly (it only changes
  // on add/remove/edit/latency, all of which warrant a re-render here).
  const sessions = useAppStore((s) => s.sessions);
  const openEditSession = useAppStore((s) => s.openEditSession);
  const removeSession = useAppStore((s) => s.removeSession);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setGroupDefaultsTarget = useAppStore((s) => s.setGroupDefaultsTarget);

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showNewAssetMenu, setShowNewAssetMenu] = useState(false);
  const plusBtnRef = useRef<HTMLButtonElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    session: SessionConfig;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      // eslint-disable-next-line no-restricted-syntax
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [contextMenu]);

  // Filter out temporary sessions created by split-screen
  const allSessions = sessions.filter((s) => !s._temporary);
  const groups: Record<string, SessionConfig[]> = {};
  allSessions.forEach((s) => {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    const g = s.group || t('panel_default_group');
    if (!groups[g]) groups[g] = [];
    groups[g].push(s);
  });

  const toggleGroup = (name: string) => {
    setExpandedGroups((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const handleConnect = useCallback((session: SessionConfig) => {
    const existingTab = useAppStore.getState().tabs.find((t) => t.sessionId === session.id);
    if (existingTab) {
      useAppStore.getState().setActiveTab(existingTab.id);
      return;
    }
    const tabId = crypto.randomUUID();
    useAppStore.getState().addTab({
      id: tabId,
      sessionId: session.id,
      title: session.name,
      type: session.session_type,
      connected: false,
    });
  }, []);

  const handleCopySession = useCallback(
    (session: SessionConfig) => {
      const copied: SessionConfig = {
        ...session,
        id: crypto.randomUUID(),
        name: `${session.name} - ${t('common_copy_suffix')}`,
        created_at: new Date().toISOString().slice(0, 10),
        _temporary: undefined,
      };
      useAppStore.getState().addSession(copied);
    },
    [t],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent, session: SessionConfig) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, session });
  }, []);

  const filteredSessions = searchQuery
    ? allSessions.filter(
        (s) =>
          s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.host?.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : null;

  return (
    <div className="sidebar-panel">
      {/* Compact single-row header: title + search + new asset */}
      <div className="sidebar-header">
        <div className="sidebar-header-row">
          <h3
            className="sidebar-title-link"
            onClick={() => setActiveTab('asset-list')}
            title={t('nav_assetlist')}
          >
            {t('panel_asset_list')}
          </h3>
          <div className="sidebar-actions">
            <button
              type="button"
              className={`sidebar-action-btn${showSearch ? ' active' : ''}`}
              onClick={() => {
                if (showSearch) setSearchQuery('');
                setShowSearch(!showSearch);
              }}
              title={t('panel_search')}
            >
              <Search size={14} />
            </button>
            <button
              type="button"
              ref={plusBtnRef}
              className="sidebar-action-btn sidebar-add-btn"
              onClick={() => setShowNewAssetMenu(!showNewAssetMenu)}
              title={t('panel_new_asset')}
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Search (toggle) */}
      {showSearch && (
        <div className="sidebar-search-wrapper">
          <div className="sidebar-search">
            <Search size={12} />
            <input
              type="text"
              placeholder={t('panel_search_placeholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => setSearchQuery('')}
                title={t('table_clear_search')}
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="sidebar-content">
        {filteredSessions ? (
          filteredSessions.length === 0 ? (
            <div className="sidebar-empty sidebar-empty--search">
              <Search size={22} />
              <p>{t('table_no_matches')}</p>
            </div>
          ) : (
            filteredSessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                onConnect={handleConnect}
                onContextMenu={handleContextMenu}
              />
            ))
          )
        ) : allSessions.length === 0 ? (
          <div className="sidebar-empty">
            <Monitor size={28} />
            <p>{t('panel_no_assets')}</p>
            <button
              type="button"
              className="btn btn-primary"
              style={{
                fontSize: 12,
                height: 30,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
              }}
              onClick={() => setShowNewAssetMenu(true)}
            >
              <Plus size={13} /> {t('panel_new_asset')}
            </button>
          </div>
        ) : (
          Object.entries(groups).map(([groupName, groupSessions]) => (
            <div key={groupName} className="session-group">
              <div
                className="session-group-header"
                role="button"
                tabIndex={0}
                aria-expanded={expandedGroups[groupName] !== false}
                onClick={() => toggleGroup(groupName)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleGroup(groupName);
                  }
                }}
              >
                {expandedGroups[groupName] !== false ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
                <span className="session-group-icon">
                  {expandedGroups[groupName] !== false ? (
                    <FolderOpen size={14} />
                  ) : (
                    <Folder size={14} />
                  )}
                </span>
                <span>{groupName}</span>
                <button
                  className="session-group-defaults-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setGroupDefaultsTarget(groupName);
                  }}
                  title={t('group_defaults_title')}
                >
                  <Settings size={12} />
                </button>
                <span className="session-group-count">{groupSessions.length}</span>
              </div>
              {expandedGroups[groupName] !== false &&
                groupSessions.map((session) => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    onConnect={handleConnect}
                    onContextMenu={handleContextMenu}
                  />
                ))}
            </div>
          ))
        )}
      </div>

      {/* New Asset dropdown menu */}
      {showNewAssetMenu && (
        <NewAssetMenu
          anchorRef={plusBtnRef}
          onClose={() => setShowNewAssetMenu(false)}
          onSelect={openNewAssetModal}
        />
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="asset-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          role="menu"
        >
          <button
            role="menuitem"
            onClick={() => {
              handleConnect(contextMenu.session);
              setContextMenu(null);
            }}
          >
            <Play size={12} /> {t('table_connect')}
          </button>
          <button
            role="menuitem"
            onClick={() => {
              openEditSession(contextMenu.session);
              setContextMenu(null);
            }}
          >
            <Edit size={12} /> {t('table_edit')}
          </button>
          <button
            role="menuitem"
            onClick={() => {
              handleCopySession(contextMenu.session);
              setContextMenu(null);
            }}
          >
            <Copy size={12} /> {t('table_copy')}
          </button>
          <div className="context-menu-divider" />
          <button
            role="menuitem"
            className="danger"
            onClick={() =>
              void (async () => {
                if (
                  await confirm({
                    title: t('common_delete_confirm_title'),
                    message: t('common_delete_confirm_body', {
                      name: contextMenu.session.name,
                    }),
                    danger: true,
                  })
                ) {
                  removeSession(contextMenu.session.id);
                  setContextMenu(null);
                }
              })()
            }
          >
            <Trash2 size={12} /> {t('table_delete')}
          </button>
        </div>
      )}
    </div>
  );
};

const SessionItem: React.FC<{
  session: SessionConfig;
  onConnect: (session: SessionConfig) => void;
  onContextMenu: (e: React.MouseEvent, session: SessionConfig) => void;
}> = React.memo(({ session, onConnect, onContextMenu }) => {
  // Subscribe only to this session's tab + the active id, so a latency update
  // on an unrelated session doesn't re-render this item.
  const sessionTab = useAppStore((s) => s.tabs.find((t) => t.sessionId === session.id));
  const activeTabId = useAppStore((s) => s.activeTabId);
  const isActive = sessionTab?.id === activeTabId;
  const isConnected = sessionTab?.connected === true;

  return (
    <div
      className={`session-item ${isActive ? 'active' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={session.name}
      aria-pressed={isActive}
      onDoubleClick={() => onConnect(session)}
      onClick={(e) => {
        if (e.detail === 1) onConnect(session);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onConnect(session);
        }
      }}
      onContextMenu={(e) => onContextMenu(e, session)}
    >
      <span className="session-item-icon">
        {session.session_type === 'docker' ? (
          <Box size={13} />
        ) : session.session_type === 'serial' ? (
          <Usb size={13} />
        ) : session.session_type === 'localshell' ? (
          <TerminalSquare size={13} />
        ) : (
          <Server size={13} />
        )}
      </span>
      <span className="session-item-name">{session.name}</span>
      {session.color_label && (
        <span
          className="session-color-pip"
          style={{ background: session.color_label }}
          aria-hidden="true"
        />
      )}
      <span className={`session-status-dot ${isConnected ? 'connected' : 'disconnected'}`} />
    </div>
  );
});
