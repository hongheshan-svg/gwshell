import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Search,
  Server,
  RefreshCw,
  Plus,
  Trash2,
  Edit,
  Play,
  Copy,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import type { SessionConfig } from '../../types';
import { useAssetData } from '../../hooks/useAssetData';
import { useSettingsStore } from '../../stores/settingsStore';

export const AssetTable: React.FC = () => {
  const {
    filteredSessions,
    searchQuery,
    setSearchQuery,
    selectedSessionIds,
    setSelectedSessionIds,
    toggleSelectSession,
    setShowNewSession,
    setEditingSession,
    removeSession,
    handleConnect,
    handleDeleteSelected,
    handleCopySession,
    doPingRef,
    sidebarCollapsed,
    toggleSidebar,
  } = useAssetData();
  const { t } = useTranslation();
  const homeView = useSettingsStore((s) => s.settings.homeView);
  const saveSettings = useSettingsStore((s) => s.save);
  const allSettings = useSettingsStore((s) => s.settings);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; session: SessionConfig } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const allSelected = filteredSessions.length > 0 && filteredSessions.every((s) => selectedSessionIds.includes(s.id));

  const handleSelectAll = () => {
    if (allSelected) {
      setSelectedSessionIds([]);
    } else {
      setSelectedSessionIds(filteredSessions.map((s) => s.id));
    }
  };

  const handleContextMenu = (e: React.MouseEvent, session: SessionConfig) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, session });
  };

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
          <button
            type="button"
            className="asset-session-toggle"
            onClick={toggleSidebar}
            title={t('nav_toggle_sidebar')}
            aria-label={t('nav_toggle_sidebar')}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          </button>
          <span className="asset-toolbar-title">{t('table_title')}</span>
          <div className="home-view-seg" role="group" aria-label="View mode">
            <button
              type="button"
              className={`home-view-seg__btn${homeView === 'card' ? ' active' : ''}`}
              onClick={() => saveSettings({ ...allSettings, homeView: 'card' })}
              aria-pressed={homeView === 'card'}
            >
              {t('home_view_card')}
            </button>
            <button
              type="button"
              className={`home-view-seg__btn${homeView === 'table' ? ' active' : ''}`}
              onClick={() => saveSettings({ ...allSettings, homeView: 'table' })}
              aria-pressed={homeView === 'table'}
            >
              {t('home_view_list')}
            </button>
          </div>
        </div>
        <div className="asset-toolbar-center">
          <span className="asset-toolbar-info">{t('table_selected', { count: selectedSessionIds.length })}</span>
        </div>
        <div className="asset-toolbar-right">
          <div className="asset-search-box">
            <Search size={12} />
            <input
              type="text"
              placeholder={t('table_search_placeholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button className="asset-toolbar-btn" onClick={() => setShowNewSession(true)} title={t('table_new')}>
            <Plus size={14} />
          </button>
          <button className="asset-toolbar-btn" onClick={() => doPingRef.current()} title={t('table_refresh')}>
            <RefreshCw size={14} />
          </button>
          {selectedSessionIds.length > 0 && (
            <button className="asset-toolbar-btn danger" onClick={handleDeleteSelected} title={t('table_delete_selected')}>
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
              <th className="col-name">{t('table_col_name')}</th>
              <th className="col-latency">{t('table_col_latency')}</th>
              <th className="col-host">{t('table_col_host')}</th>
              <th className="col-user">{t('table_col_user')}</th>
              <th className="col-created">{t('table_col_created')}</th>
              <th className="col-expired">{t('table_col_expired')}</th>
              <th className="col-remark">{t('table_col_remark')}</th>
              <th className="col-actions">{t('table_col_actions')}</th>
            </tr>
          </thead>
          <tbody>
            {filteredSessions.length === 0 ? (
              <tr>
                <td colSpan={9} className="asset-empty">
                  <div className="asset-empty-content">
                    <Server size={32} />
                    <p>{t('table_empty')}</p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredSessions.map((session) => (
                <tr
                  key={session.id}
                  className={selectedSessionIds.includes(session.id) ? 'selected' : ''}
                  onDoubleClick={() => handleConnect(session)}
                  onContextMenu={(e) => handleContextMenu(e, session)}
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
                      title={t('table_connect')}
                    >
                      <Play size={12} />
                    </button>
                    <button
                      className="asset-action-btn"
                      onClick={() => { setEditingSession(session); setShowNewSession(true); }}
                      title={t('table_edit')}
                    >
                      <Edit size={12} />
                    </button>
                    <button
                      className="asset-action-btn"
                      onClick={() => handleCopySession(session)}
                      title={t('table_copy')}
                    >
                      <Copy size={12} />
                    </button>
                    <button
                      className="asset-action-btn danger"
                      onClick={() => removeSession(session.id)}
                      title={t('table_delete')}
                    >
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

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
