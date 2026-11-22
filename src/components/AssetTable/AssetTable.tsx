import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Search,
  RefreshCw,
  Plus,
  Trash2,
  Edit,
  Play,
  Copy,
  LayoutGrid,
  List,
  X,
} from 'lucide-react';
import type { SessionConfig } from '../../types';
import { useAssetData } from '../../hooks/useAssetData';
import { useConfirm } from '../../hooks/useConfirm';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAppStore } from '../../stores/appStore';
import { NewAssetMenu } from '../Sidebar/NewAssetMenu';
import { AssetDashboard, EmptyStateCtas } from '../AssetDashboard/AssetDashboard';

const SUPPORTED_QUICK_CREATE_TYPES = new Set(['ssh', 'ssh-tunnel']);

export const AssetTable: React.FC = () => {
  const {
    realSessions,
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
  } = useAssetData();
  const setShowQuickConnect = useAppStore((s) => s.setShowQuickConnect);
  const setShowDockerModal = useAppStore((s) => s.setShowDockerModal);
  const setShowLocalTerminalModal = useAppStore((s) => s.setShowLocalTerminalModal);
  const setShowSerialModal = useAppStore((s) => s.setShowSerialModal);
  const { t } = useTranslation();
  const confirm = useConfirm();
  const homeView = useSettingsStore((s) => s.settings.homeView);
  const saveSettings = useSettingsStore((s) => s.save);
  const allSettings = useSettingsStore((s) => s.settings);
  const [showNewAssetMenu, setShowNewAssetMenu] = useState(false);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    session: SessionConfig;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const handleNewAssetSelect = (type: string) => {
    if (type === 'quickconnect') {
      setShowQuickConnect(true);
      return;
    }
    if (SUPPORTED_QUICK_CREATE_TYPES.has(type)) {
      setShowNewSession(true);
    } else if (type === 'serial') {
      setShowSerialModal(true);
    } else if (type === 'docker') {
      setShowDockerModal(true);
    } else if (type === 'localshell') {
      setShowLocalTerminalModal(true);
    }
  };

  const allSelected =
    filteredSessions.length > 0 && filteredSessions.every((s) => selectedSessionIds.includes(s.id));

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
      // eslint-disable-next-line no-restricted-syntax
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [contextMenu]);

  // Latency thresholds tuned for SSH over WAN: <100ms is healthy, 100–300ms
  // noticeable, >300ms painful. (The old 50/150 cutoffs flagged perfectly
  // fine links as degraded.)
  const formatLatency = (latency?: number | null) => {
    if (latency == null) return <span className="latency-na">-</span>;
    const cls = latency <= 100 ? 'latency-good' : latency <= 300 ? 'latency-ok' : 'latency-bad';
    return <span className={cls}>{latency}ms</span>;
  };

  // Type-aware connection info for the Host column (serial/local/docker
  // sessions have no host, but they do have something meaningful to show).
  const hostInfo = (s: SessionConfig): string => {
    if (s.host) return s.host;
    switch (s.session_type) {
      case 'serial':
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        return s.serial_port || '-';
      case 'localshell':
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        return s.shell_name || t('newasset_localshell');
      case 'docker':
        return s.docker_connect_method?.toLowerCase() === 'ssh' ? 'docker (SSH)' : 'docker';
      default:
        return '-';
    }
  };

  // Hide columns that carry no data for ANY visible row (到期时间/备注 are
  // usually all "-": fixed empty columns just waste width).
  const showExpired = useMemo(() => filteredSessions.some((s) => s.expired_at), [filteredSessions]);
  const showRemark = useMemo(() => filteredSessions.some((s) => s.remark), [filteredSessions]);
  const colCount = 7 + (showExpired ? 1 : 0) + (showRemark ? 1 : 0);

  // Group rows like the card view does, so the list view keeps the same
  // organizational context. Insertion order is preserved.
  const groupedSessions = useMemo(() => {
    const map = new Map<string, SessionConfig[]>();
    filteredSessions.forEach((s) => {
      const key = s.group?.trim() ?? '';
      const arr = map.get(key);
      if (arr) arr.push(s);
      else map.set(key, [s]);
    });
    return Array.from(map.entries());
  }, [filteredSessions]);

  return (
    <div className="asset-table-wrapper">
      {/* Toolbar */}
      <div className="asset-toolbar">
        <div className="asset-toolbar-left">
          <div className="home-view-seg" role="group" aria-label="View mode">
            <button
              type="button"
              className={`home-view-seg__btn${homeView === 'card' ? ' active' : ''}`}
              onClick={() => {
                void saveSettings({ ...allSettings, homeView: 'card' });
              }}
              aria-pressed={homeView === 'card'}
            >
              <LayoutGrid size={13} />
              <span>{t('home_view_card')}</span>
            </button>
            <button
              type="button"
              className={`home-view-seg__btn${homeView === 'table' ? ' active' : ''}`}
              onClick={() => {
                void saveSettings({ ...allSettings, homeView: 'table' });
              }}
              aria-pressed={homeView === 'table'}
            >
              <List size={13} />
              <span>{t('home_view_list')}</span>
            </button>
          </div>
          {realSessions.length > 0 && (
            <span className="asset-count-pill">
              {searchQuery
                ? `${filteredSessions.length} / ${realSessions.length}`
                : realSessions.length}
            </span>
          )}
        </div>
        <div className="asset-toolbar-center">
          {selectedSessionIds.length > 0 && (
            <span className="asset-toolbar-info">
              {t('table_selected', { count: selectedSessionIds.length })}
            </span>
          )}
        </div>
        <div className="asset-toolbar-right">
          <div className="asset-search-box">
            <Search size={13} />
            <input
              type="text"
              placeholder={t('table_search_placeholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
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
          <button
            type="button"
            className="asset-toolbar-btn"
            onClick={() => doPingRef.current()}
            title={t('table_refresh')}
          >
            <RefreshCw size={14} />
          </button>
          {selectedSessionIds.length > 0 && (
            <button
              type="button"
              className="asset-toolbar-btn danger"
              onClick={() => void handleDeleteSelected()}
              title={t('table_delete_selected')}
            >
              <Trash2 size={14} />
            </button>
          )}
          <button
            type="button"
            ref={addBtnRef}
            className="asset-new-btn"
            onClick={() => setShowNewAssetMenu((v) => !v)}
            title={t('panel_new_asset')}
          >
            <Plus size={14} />
            <span>{t('table_new')}</span>
          </button>
        </div>
      </div>

      {showNewAssetMenu && (
        <NewAssetMenu
          anchorRef={addBtnRef}
          onClose={() => setShowNewAssetMenu(false)}
          onSelect={handleNewAssetSelect}
        />
      )}

      {/* Body: card grid or table depending on homeView */}
      {homeView === 'card' ? (
        <AssetDashboard
          sessions={filteredSessions}
          hasAnySessions={realSessions.length > 0}
          onClearSearch={() => setSearchQuery('')}
          onConnect={handleConnect}
          onEdit={(s) => {
            setEditingSession(s);
            setShowNewSession(true);
          }}
          onContextMenu={handleContextMenu}
        />
      ) : (
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
                {showExpired && <th className="col-expired">{t('table_col_expired')}</th>}
                {showRemark && <th className="col-remark">{t('table_col_remark')}</th>}
                <th className="col-actions">{t('table_col_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredSessions.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="asset-empty">
                    {realSessions.length > 0 ? (
                      <div className="asset-no-matches">
                        <Search size={24} />
                        <p>{t('table_no_matches')}</p>
                        <button
                          type="button"
                          className="settings-btn-outline"
                          onClick={() => setSearchQuery('')}
                        >
                          {t('table_clear_search')}
                        </button>
                      </div>
                    ) : (
                      <EmptyStateCtas />
                    )}
                  </td>
                </tr>
              ) : (
                groupedSessions.map(([groupName, groupSessions]) => (
                  <React.Fragment key={groupName || '__ungrouped__'}>
                    {(groupedSessions.length > 1 || groupName) && (
                      <tr className="asset-group-row">
                        <td colSpan={colCount}>
                          {groupName || t('dash_ungrouped')}
                          <span className="asset-group-count">{groupSessions.length}</span>
                        </td>
                      </tr>
                    )}
                    {groupSessions.map((session) => (
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
                          <span
                            className="asset-name-color"
                            // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
                            style={{ background: session.color_label || 'var(--border-color)' }}
                          />
                          <span>{session.name}</span>
                        </td>
                        <td className="col-latency">{formatLatency(session.latency)}</td>
                        <td className="col-host">{hostInfo(session)}</td>
                        {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing */}
                        <td className="col-user">{session.username || '-'}</td>
                        {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing */}
                        <td className="col-created">{session.created_at || '-'}</td>
                        {showExpired && (
                          <td className="col-expired">
                            {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing */}
                            {session.expired_at || '-'}
                          </td>
                        )}
                        {showRemark && (
                          <td className="col-remark">
                            {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing */}
                            {session.remark || '-'}
                          </td>
                        )}
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
                            onClick={() => {
                              setEditingSession(session);
                              setShowNewSession(true);
                            }}
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
                            onClick={() =>
                              void (async () => {
                                if (
                                  await confirm({
                                    title: t('common_delete_confirm_title'),
                                    message: t('common_delete_confirm_body', {
                                      name: session.name,
                                    }),
                                    danger: true,
                                  })
                                ) {
                                  removeSession(session.id);
                                }
                              })()
                            }
                            title={t('table_delete')}
                          >
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="asset-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            onClick={() => {
              handleConnect(contextMenu.session);
              setContextMenu(null);
            }}
          >
            <Play size={12} /> {t('table_connect')}
          </button>
          <button
            onClick={() => {
              setEditingSession(contextMenu.session);
              setShowNewSession(true);
              setContextMenu(null);
            }}
          >
            <Edit size={12} /> {t('table_edit')}
          </button>
          <button
            onClick={() => {
              handleCopySession(contextMenu.session);
              setContextMenu(null);
            }}
          >
            <Copy size={12} /> {t('table_copy')}
          </button>
          <div className="context-menu-divider" />
          <button
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
