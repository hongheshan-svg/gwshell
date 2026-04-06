import React, { useState, useRef, useEffect } from 'react';
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

// Demo sessions to show the UI like HexHub screenshots
const demoSessions: SessionConfig[] = [
  { id: 'demo-1', name: 'toolsource', session_type: 'ssh', group: '开发服务器', host: '192.168.1.10', port: 22, username: 'root', auth_method: 'password', latency: 12, created_at: '2025-12-01', remark: '开发环境' },
  { id: 'demo-2', name: 'wsl-source', session_type: 'ssh', group: '开发服务器', host: '172.20.0.1', port: 22, username: 'dev', auth_method: 'password', latency: 3, created_at: '2025-12-05', remark: 'WSL开发' },
  { id: 'demo-3', name: 'DMIT', session_type: 'ssh', group: '云服务器', host: '103.152.x.x', port: 22, username: 'root', auth_method: 'publickey', latency: 45, created_at: '2025-11-20', expired_at: '2026-11-20', remark: 'DMIT VPS' },
  { id: 'demo-4', name: 'openclaw', session_type: 'ssh', group: '云服务器', host: '45.76.x.x', port: 22, username: 'admin', auth_method: 'password', latency: 88, created_at: '2026-01-10', expired_at: '2027-01-10' },
  { id: 'demo-5', name: '公司服务器', session_type: 'ssh', group: '生产环境', host: '10.0.1.100', port: 22, username: 'deploy', auth_method: 'publickey', latency: 5, created_at: '2025-10-15' },
];

export const SessionPanel: React.FC = () => {
  const { sessions, setSessions, sidebarCollapsed, setShowNewSession, setShowDockerModal, setShowLocalTerminalModal, setShowSerialModal, tabs, addTab, setActiveTab } = useAppStore();
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    '开发服务器': true,
    '云服务器': true,
    '生产环境': true,
    '默认分组': true,
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showNewAssetMenu, setShowNewAssetMenu] = useState(false);
  const plusBtnRef = useRef<HTMLButtonElement>(null);

  // Load demo sessions on first mount if empty
  useEffect(() => {
    if (sessions.length === 0) {
      setSessions(demoSessions);
    }
  }, []);

  if (sidebarCollapsed) return null;

  // Group sessions
  const allSessions = sessions;
  const groups: Record<string, SessionConfig[]> = {};
  allSessions.forEach((s) => {
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
          </div>
        </div>
        {/* Toolbar row 2: + button area */}
        <div className="sidebar-toolbar">
          <button
            ref={plusBtnRef}
            className="sidebar-action-btn sidebar-add-btn"
            onClick={() => setShowNewAssetMenu(!showNewAssetMenu)}
            title="新建资产"
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
        ) : allSessions.length === 0 ? (
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
