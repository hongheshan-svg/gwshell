import React, { useState, useRef, useEffect } from 'react';
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
  FolderPlus,
  Copy,
  Link,
  Play,
  Edit,
  Trash2,
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { NewAssetMenu } from './NewAssetMenu';
import type { SessionConfig } from '../../types';

export const SessionPanel: React.FC = () => {
  const { sessions, sidebarCollapsed, setShowNewSession, setShowDockerModal, setShowLocalTerminalModal, setShowSerialModal, setEditingSession, addSession, removeSession, tabs, addTab, setActiveTab, setGroupDefaultsTarget } = useAppStore();
  const { t } = useTranslation();
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showNewAssetMenu, setShowNewAssetMenu] = useState(false);
  const plusBtnRef = useRef<HTMLButtonElement>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; session: SessionConfig } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [contextMenu]);

  if (sidebarCollapsed) return null;

  // Filter out temporary sessions created by split-screen
  const allSessions = sessions.filter((s) => !s._temporary);
  const groups: Record<string, SessionConfig[]> = {};
  allSessions.forEach((s) => {
    const g = s.group || t('panel_default_group');
    if (!groups[g]) groups[g] = [];
    groups[g].push(s);
  });

  const toggleGroup = (name: string) => {
    setExpandedGroups((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const supportedQuickCreateTypes = new Set(['ssh', 'ssh-tunnel']);

  const handleConnect = (session: SessionConfig) => {
    const existingTab = tabs.find((t) => t.sessionId === session.id);
    if (existingTab) {
      setActiveTab(existingTab.id);
      return;
    }
    const tabId = crypto.randomUUID();
    addTab({
      id: tabId,
      sessionId: session.id,
      title: session.name,
      type: session.session_type,
      connected: false,
    });
  };

  const handleCopySession = (session: SessionConfig) => {
    const copied: SessionConfig = {
      ...session,
      id: crypto.randomUUID(),
      name: `${session.name} - 副本`,
      created_at: new Date().toISOString().slice(0, 10),
      _temporary: undefined,
    };
    addSession(copied);
  };

  const handleContextMenu = (e: React.MouseEvent, session: SessionConfig) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, session });
  };

  const handleNewAssetSelect = (type: string) => {
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

  const filteredSessions = searchQuery
    ? allSessions.filter(
        (s) =>
          s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (s.host && s.host.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : null;

  return (
    <div className={`sidebar-panel ${sidebarCollapsed ? 'collapsed' : ''}`}>
      {/* Header row 1: title + search */}
      <div className="sidebar-header">
        <div className="sidebar-header-row">
          <h3>{t('panel_asset_list')}</h3>
          <button className="sidebar-action-btn" onClick={() => setShowSearch(!showSearch)} title={t('panel_search')}>
            <Search size={13} />
          </button>
          <div className="sidebar-actions">
            <button className="sidebar-action-btn" title={t('panel_settings')}>
              <Settings size={13} />
            </button>
            <button className="sidebar-action-btn" title={t('panel_new_folder')}>
              <FolderPlus size={13} />
            </button>
            <button className="sidebar-action-btn" title={t('panel_copy')}>
              <Copy size={13} />
            </button>
            <button className="sidebar-action-btn" title={t('panel_link')}>
              <Link size={13} />
            </button>
          </div>
        </div>
        {/* Toolbar row 2: + button area */}
        <div className="sidebar-toolbar">
          <button
            ref={plusBtnRef}
            className="sidebar-action-btn sidebar-add-btn"
            onClick={() => setShowNewAssetMenu(!showNewAssetMenu)}
            title={t('panel_new_asset')}
          >
            <Plus size={15} />
          </button>
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
          </div>
        </div>
      )}

      <div className="sidebar-content">
        {filteredSessions ? (
          filteredSessions.map((session) => (
            <SessionItem key={session.id} session={session} onConnect={handleConnect} onContextMenu={handleContextMenu} />
          ))
        ) : allSessions.length === 0 ? (
          <div className="sidebar-empty">
            <Monitor size={32} />
            <p>{t('panel_no_assets')}</p>
            <button
              className="btn btn-primary"
              style={{ fontSize: 11, height: 28 }}
              onClick={() => setShowNewAssetMenu(true)}
            >
              <Plus size={12} /> {t('panel_new_asset')}
            </button>
          </div>
        ) : (
          Object.entries(groups).map(([groupName, groupSessions]) => (
            <div key={groupName} className="session-group">
              <div className="session-group-header" onClick={() => toggleGroup(groupName)}>
                {expandedGroups[groupName] !== false ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
                <span className="session-group-icon">
                  {expandedGroups[groupName] !== false ? <FolderOpen size={14} /> : <Folder size={14} />}
                </span>
                <span>{groupName}</span>
                <button
                  className="session-group-defaults-btn"
                  onClick={(e) => { e.stopPropagation(); setGroupDefaultsTarget(groupName); }}
                  title={t('group_defaults_title')}
                >
                  <Settings size={12} />
                </button>
                <span className="session-group-count">
                  {groupSessions.length}
                </span>
              </div>
              {expandedGroups[groupName] !== false &&
                groupSessions.map((session) => (
                  <SessionItem key={session.id} session={session} onConnect={handleConnect} onContextMenu={handleContextMenu} />
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
          onSelect={handleNewAssetSelect}
        />
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="asset-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button onClick={() => { handleConnect(contextMenu.session); setContextMenu(null); }}>
            <Play size={12} /> {t('table_connect')}
          </button>
          <button onClick={() => { setEditingSession(contextMenu.session); setShowNewSession(true); setContextMenu(null); }}>
            <Edit size={12} /> {t('table_edit')}
          </button>
          <button onClick={() => { handleCopySession(contextMenu.session); setContextMenu(null); }}>
            <Copy size={12} /> {t('table_copy')}
          </button>
          <div className="context-menu-divider" />
          <button className="danger" onClick={() => { removeSession(contextMenu.session.id); setContextMenu(null); }}>
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
}> = ({ session, onConnect, onContextMenu }) => {
  const { activeTabId, tabs } = useAppStore();
  const sessionTab = tabs.find((t) => t.sessionId === session.id);
  const isActive = sessionTab?.id === activeTabId;
  const isConnected = sessionTab?.connected === true;

  return (
    <div
      className={`session-item ${isActive ? 'active' : ''}`}
      onDoubleClick={() => onConnect(session)}
      onContextMenu={(e) => onContextMenu(e, session)}
    >
      <span className="session-item-icon"><Server size={14} /></span>
      <span className="session-item-name">{session.name}</span>
      <span className={`session-status-dot ${isConnected ? 'connected' : 'disconnected'}`} />
    </div>
  );
};
