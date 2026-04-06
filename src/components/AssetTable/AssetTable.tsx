import React, { useState } from 'react';
import {
  Search,
  Menu,
  Server,
  RefreshCw,
  Plus,
  Trash2,
  Edit,
  Play,
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import type { SessionConfig } from '../../types';

export const AssetTable: React.FC = () => {
  const {
    sessions,
    selectedSessionIds,
    setSelectedSessionIds,
    toggleSelectSession,
    setShowNewSession,
    setEditingSession,
    removeSession,
    addTab,
    setActiveTab,
    tabs,
  } = useAppStore();
  const [searchQuery, setSearchQuery] = useState('');

  const filteredSessions = searchQuery
    ? sessions.filter(
        (s) =>
          s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (s.host && s.host.toLowerCase().includes(searchQuery.toLowerCase())) ||
          (s.username && s.username.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : sessions;

  const allSelected = filteredSessions.length > 0 && filteredSessions.every((s) => selectedSessionIds.includes(s.id));

  const handleSelectAll = () => {
    if (allSelected) {
      setSelectedSessionIds([]);
    } else {
      setSelectedSessionIds(filteredSessions.map((s) => s.id));
    }
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

  const handleDeleteSelected = () => {
    selectedSessionIds.forEach((id) => removeSession(id));
    setSelectedSessionIds([]);
  };

  const formatLatency = (latency?: number | null) => {
    if (latency == null) return <span className="latency-na">-</span>;
    const cls = latency <= 50 ? 'latency-good' : latency <= 150 ? 'latency-ok' : 'latency-bad';
    return <span className={cls}>{latency}ms</span>;
  };

  return (
    <div className="asset-table-wrapper">
      {/* Toolbar */}
      <div className="asset-toolbar">
        <div className="asset-toolbar-left">
          <span className="asset-toolbar-icon"><Menu size={14} /></span>
          <span className="asset-toolbar-title">资产列表</span>
        </div>
        <div className="asset-toolbar-center">
          <span className="asset-toolbar-info">已选择 {selectedSessionIds.length} 个连接</span>
        </div>
        <div className="asset-toolbar-right">
          <div className="asset-search-box">
            <Search size={12} />
            <input
              type="text"
              placeholder="名称,IP,User (Ctrl+F)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button className="asset-toolbar-btn" onClick={() => setShowNewSession(true)} title="新建">
            <Plus size={14} />
          </button>
          <button className="asset-toolbar-btn" title="刷新">
            <RefreshCw size={14} />
          </button>
          {selectedSessionIds.length > 0 && (
            <button className="asset-toolbar-btn danger" onClick={handleDeleteSelected} title="删除选中">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="asset-table-container">
        <table className="asset-table">
          <thead>
            <tr>
              <th className="col-check">
                <input type="checkbox" checked={allSelected} onChange={handleSelectAll} />
              </th>
              <th className="col-name">名称</th>
              <th className="col-latency">延迟</th>
              <th className="col-host">Host</th>
              <th className="col-user">User</th>
              <th className="col-created">创建时间</th>
              <th className="col-expired">到期时间</th>
              <th className="col-remark">备注</th>
              <th className="col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredSessions.length === 0 ? (
              <tr>
                <td colSpan={9} className="asset-empty">
                  <div className="asset-empty-content">
                    <Server size={32} />
                    <p>暂无资产，点击上方 + 按钮添加</p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredSessions.map((session) => (
                <tr
                  key={session.id}
                  className={selectedSessionIds.includes(session.id) ? 'selected' : ''}
                  onDoubleClick={() => handleConnect(session)}
                >
                  <td className="col-check">
                    <input
                      type="checkbox"
                      checked={selectedSessionIds.includes(session.id)}
                      onChange={() => toggleSelectSession(session.id)}
                    />
                  </td>
                  <td className="col-name">
                    <span className="asset-name-icon"><Server size={13} /></span>
                    <span>{session.name}</span>
                  </td>
                  <td className="col-latency">{formatLatency(session.latency)}</td>
                  <td className="col-host">{session.host || '-'}</td>
                  <td className="col-user">{session.username || '-'}</td>
                  <td className="col-created">{session.created_at || '-'}</td>
                  <td className="col-expired">{session.expired_at || '-'}</td>
                  <td className="col-remark">{session.remark || '-'}</td>
                  <td className="col-actions">
                    <button
                      className="asset-action-btn"
                      onClick={() => handleConnect(session)}
                      title="连接"
                    >
                      <Play size={12} />
                    </button>
                    <button
                      className="asset-action-btn"
                      onClick={() => setEditingSession(session)}
                      title="编辑"
                    >
                      <Edit size={12} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
