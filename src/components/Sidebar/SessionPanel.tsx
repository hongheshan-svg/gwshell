import React, { useState, useRef } from 'react';
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
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { NewAssetMenu } from './NewAssetMenu';
import type { SessionConfig } from '../../types';

export const SessionPanel: React.FC = () => {
  const { sessions, sidebarCollapsed, setShowNewSession, tabs, addTab, setActiveTab } = useAppStore();
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({ default: true });
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showNewAssetMenu, setShowNewAssetMenu] = useState(false);
  const plusBtnRef = useRef<HTMLButtonElement>(null);

  if (sidebarCollapsed) return null;

  // Group sessions
  const groups: Record<string, SessionConfig[]> = {};
  sessions.forEach((s) => {
    const g = s.group || '默认分组';
    if (!groups[g]) groups[g] = [];
    groups[g].push(s);
  });

  const toggleGroup = (name: string) => {
    setExpandedGroups((prev) => ({ ...prev, [name]: !prev[name] }));
  };

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

  const handleNewAssetSelect = (type: string) => {
    if (type === 'ssh' || type === 'localshell') {
      setShowNewSession(true);
    }
    // Other types can be handled later
  };

  const filteredSessions = searchQuery
    ? sessions.filter(
        (s) =>
          s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (s.host && s.host.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : null;

  return (
    <div className={`sidebar-panel ${sidebarCollapsed ? 'collapsed' : ''}`}>
      {/* Header: title + search icon + action icons */}
      <div className="sidebar-header">
        <h3>资产列表</h3>
        <button className="sidebar-action-btn" onClick={() => setShowSearch(!showSearch)} title="搜索">
          <Search size={13} />
        </button>
        <div className="sidebar-actions">
          <button className="sidebar-action-btn" title="设置">
            <Settings size={13} />
          </button>
          <button className="sidebar-action-btn" title="新建文件夹">
            <FolderPlus size={13} />
          </button>
          <button className="sidebar-action-btn" title="复制">
            <Copy size={13} />
          </button>
          <button className="sidebar-action-btn" title="链接">
            <Link size={13} />
          </button>
          <button
            ref={plusBtnRef}
            className="sidebar-action-btn sidebar-add-btn"
            onClick={() => setShowNewAssetMenu(!showNewAssetMenu)}
            title="新建资产"
          >
            <Plus size={14} />
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
              placeholder="搜索资产..."
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
            <SessionItem key={session.id} session={session} onConnect={handleConnect} />
          ))
        ) : sessions.length === 0 ? (
          <div className="sidebar-empty">
            <Monitor size={32} />
            <p>暂无资产</p>
            <button
              className="btn btn-primary"
              style={{ fontSize: 11, height: 28 }}
              onClick={() => setShowNewAssetMenu(true)}
            >
              <Plus size={12} /> 新建资产
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
                <span className="session-group-count">
                  {groupSessions.length}
                </span>
              </div>
              {expandedGroups[groupName] !== false &&
                groupSessions.map((session) => (
                  <SessionItem key={session.id} session={session} onConnect={handleConnect} />
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
    </div>
  );
};

const SessionItem: React.FC<{
  session: SessionConfig;
  onConnect: (session: SessionConfig) => void;
}> = ({ session, onConnect }) => {
  const { activeTabId, tabs } = useAppStore();
  const isActive = tabs.some((t) => t.sessionId === session.id && t.id === activeTabId);

  return (
    <div
      className={`session-item ${isActive ? 'active' : ''}`}
      onDoubleClick={() => onConnect(session)}
    >
      <span className="session-item-icon"><Server size={14} /></span>
      <span className="session-item-name">{session.name}</span>
    </div>
  );
};
