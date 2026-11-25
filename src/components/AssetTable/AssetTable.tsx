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
  Zap,
} from 'lucide-react';
import type { SessionConfig } from '../../types';
import { useAssetData } from '../../hooks/useAssetData';
import { useConfirm } from '../../hooks/useConfirm';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAppStore } from '../../stores/appStore';
import { useLatencyStore } from '../../stores/latencyStore';
import { openNewAssetModal } from '../../lib/newAssetAction';
import { NewAssetMenu } from '../Sidebar/NewAssetMenu';
import { ProtocolIcon } from '../Icons/BrandIcons';
import { AssetDashboard, EmptyStateCtas } from '../AssetDashboard/AssetDashboard';
import { AssetImportExportMenu } from './AssetImportExportMenu';

type SessionType = SessionConfig['session_type'];
type TypeFilter = 'all' | SessionType;

export const AssetTable: React.FC = () => {
  const {
    realSessions,
    filteredSessions,
    searchQuery,
    setSearchQuery,
    selectedSessionIds,
    setSelectedSessionIds,
    toggleSelectSession,
    removeSession,
    handleConnect,
    handleDeleteSelected,
    handleCopySession,
    doPingRef,
  } = useAssetData();
  const openEditSession = useAppStore((s) => s.openEditSession);
  const setShowQuickConnect = useAppStore((s) => s.setShowQuickConnect);
  const connectedCount = useAppStore(
    (s) => s.tabs.filter((tab) => tab.connected && tab.type !== 'asset-list').length,
  );
  const { t } = useTranslation();
  const latencyById = useLatencyStore((s) => s.latency);
  const confirm = useConfirm();
  const homeView = useSettingsStore((s) => s.settings.homeView);
  const saveSettings = useSettingsStore((s) => s.save);
  const allSettings = useSettingsStore((s) => s.settings);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [showNewAssetMenu, setShowNewAssetMenu] = useState(false);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    session: SessionConfig;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Only show protocol filter pills when the user has >=2 distinct session types.
  const availableTypes = useMemo(() => {
    const types = new Set<SessionType>();
    realSessions.forEach((s) => types.add(s.session_type));
    return types;
  }, [realSessions]);

  const activeTypeFilter: TypeFilter =
    typeFilter !== 'all' && !availableTypes.has(typeFilter) ? 'all' : typeFilter;

  const visibleSessions = useMemo(
    () =>
      activeTypeFilter === 'all'
        ? filteredSessions
        : filteredSessions.filter((s) => s.session_type === activeTypeFilter),
    [filteredSessions, activeTypeFilter],
  );

  const allSelected =
    visibleSessions.length > 0 && visibleSessions.every((s) => selectedSessionIds.includes(s.id));

  const handleSelectAll = () => {
    if (allSelected) {
      setSelectedSessionIds([]);
    } else {
      setSelectedSessionIds(visibleSessions.map((s) => s.id));
    }
  };

  const handleContextMenu = (e: React.MouseEvent, session: SessionConfig) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, session });
  };

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

  const formatLatency = (latency?: number | null) => {
    if (latency == null) return <span className="latency-na">—</span>;
    const cls = latency <= 100 ? 'latency-good' : latency <= 300 ? 'latency-ok' : 'latency-bad';
    return <span className={`latency-pill ${cls}`}>{latency} ms</span>;
  };

  const hostInfo = (s: SessionConfig): string => {
    if (s.host) return s.port && s.port !== 22 ? `${s.host}:${s.port}` : s.host;
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

  const renderProtoIcon = (type: SessionType) => {
    const cls =
      type === 'docker'
        ? 'proto--docker'
        : type === 'serial'
          ? 'proto--serial'
          : type === 'localshell'
            ? 'proto--local'
            : 'proto--ssh';
    return (
      <span className={`table-proto-icon ${cls}`}>
        <ProtocolIcon type={type} size={14} />
      </span>
    );
  };

  const showExpired = useMemo(() => visibleSessions.some((s) => s.expired_at), [visibleSessions]);
  const showRemark = useMemo(() => visibleSessions.some((s) => s.remark), [visibleSessions]);
  const colCount = 7 + (showExpired ? 1 : 0) + (showRemark ? 1 : 0);

  const groupedSessions = useMemo(() => {
    const map = new Map<string, SessionConfig[]>();
    visibleSessions.forEach((s) => {
      const key = s.group?.trim() ?? '';
      const arr = map.get(key);
      if (arr) arr.push(s);
      else map.set(key, [s]);
    });
    return Array.from(map.entries());
  }, [visibleSessions]);

  const filterChips: { id: TypeFilter; label: string }[] = [
    { id: 'all', label: t('home_filter_all') },
  ];
  if (availableTypes.has('ssh')) filterChips.push({ id: 'ssh', label: t('newasset_ssh') });
  if (availableTypes.has('localshell')) {
    filterChips.push({ id: 'localshell', label: t('newasset_localshell') });
  }
  if (availableTypes.has('docker')) filterChips.push({ id: 'docker', label: t('newasset_docker') });
  if (availableTypes.has('serial')) filterChips.push({ id: 'serial', label: t('newasset_serial') });

  const clearAllFilters = () => {
    setSearchQuery('');
    setTypeFilter('all');
  };

  return (
    <div className="asset-table-wrapper">
      {/* Spacious workspace home header */}
      <div className="asset-home-header">
        <div className="asset-home-heading">
          <h1>{t('home_title')}</h1>
          <div className="asset-home-stats">
            <span className="asset-stat-chip">
              {t('home_subtitle_count', { count: realSessions.length })}
            </span>
            {connectedCount > 0 && (
              <span className="asset-stat-chip asset-stat-chip--live">
                <span className="asset-stat-dot" />
                {t('home_connected_count', { count: connectedCount })}
              </span>
            )}
          </div>
        </div>
        <div className="asset-home-actions">
          <AssetImportExportMenu
            totalCount={realSessions.length}
            selectedIds={selectedSessionIds}
            onAfterImport={() => {
              setSelectedSessionIds([]);
              window.setTimeout(() => doPingRef.current(), 120);
            }}
          />
          <button
            type="button"
            className="asset-quick-btn"
            onClick={() => setShowQuickConnect(true)}
          >
            <Zap size={13} />
            <span>{t('newasset_quickconnect')}</span>
          </button>
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

      {/* Unified Filter, Search & View Strip (only shown when assets exist) */}
      {realSessions.length > 0 && (
        <div className="asset-controls-bar">
          <div className="asset-controls-left">
            {availableTypes.size > 1 && (
              <div className="asset-filter-pills" role="group">
                {filterChips.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    className={`filter-pill${activeTypeFilter === chip.id ? ' active' : ''}`}
                    onClick={() => setTypeFilter(chip.id)}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            )}
            {selectedSessionIds.length > 0 && (
              <span className="asset-toolbar-info">
                {t('table_selected', { count: selectedSessionIds.length })}
              </span>
            )}
          </div>

          <div className="asset-controls-right">
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
              <RefreshCw size={13} />
            </button>

            {selectedSessionIds.length > 0 && (
              <button
                type="button"
                className="asset-toolbar-btn danger"
                onClick={() => void handleDeleteSelected()}
                title={t('table_delete_selected')}
              >
                <Trash2 size={13} />
              </button>
            )}

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
          </div>
        </div>
      )}

      {showNewAssetMenu && (
        <NewAssetMenu
          anchorRef={addBtnRef}
          onClose={() => setShowNewAssetMenu(false)}
          onSelect={openNewAssetModal}
        />
      )}

      {/* Body: card grid or table depending on homeView */}
      {homeView === 'card' ? (
        <AssetDashboard
          sessions={visibleSessions}
          hasAnySessions={realSessions.length > 0}
          onClearSearch={clearAllFilters}
          onConnect={handleConnect}
          onEdit={(s) => openEditSession(s)}
          onContextMenu={handleContextMenu}
        />
      ) : (
        <div className="asset-table-container">
          {visibleSessions.length === 0 ? (
            realSessions.length > 0 ? (
              <div className="asset-dash-empty">
                <div className="asset-no-matches">
                  <Search size={24} />
                  <p>{t('table_no_matches')}</p>
                  <button type="button" className="settings-btn-outline" onClick={clearAllFilters}>
                    {t('table_clear_search')}
                  </button>
                </div>
              </div>
            ) : (
              <EmptyStateCtas />
            )
          ) : (
            <div className="asset-table-card">
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
                  {groupedSessions.map(([groupName, groupSessions]) => (
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
                            <div className="table-name-cell">
                              {session.color_label && (
                                <span
                                  className="asset-name-color"
                                  style={{ background: session.color_label }}
                                />
                              )}
                              {renderProtoIcon(session.session_type)}
                              <span className="table-name-text">{session.name}</span>
                            </div>
                          </td>
                          <td className="col-latency">{formatLatency(latencyById[session.id])}</td>
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
                              type="button"
                              className="asset-action-btn primary"
                              onClick={() => handleConnect(session)}
                              title={t('table_connect')}
                            >
                              <Play size={12} />
                            </button>
                            <button
                              type="button"
                              className="asset-action-btn"
                              onClick={() => openEditSession(session)}
                              title={t('table_edit')}
                            >
                              <Edit size={12} />
                            </button>
                            <button
                              type="button"
                              className="asset-action-btn"
                              onClick={() => handleCopySession(session)}
                              title={t('table_copy')}
                            >
                              <Copy size={12} />
                            </button>
                            <button
                              type="button"
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
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
            type="button"
            onClick={() => {
              handleConnect(contextMenu.session);
              setContextMenu(null);
            }}
          >
            <Play size={12} /> {t('table_connect')}
          </button>
          <button
            type="button"
            onClick={() => {
              openEditSession(contextMenu.session);
              setContextMenu(null);
            }}
          >
            <Edit size={12} /> {t('table_edit')}
          </button>
          <button
            type="button"
            onClick={() => {
              handleCopySession(contextMenu.session);
              setContextMenu(null);
            }}
          >
            <Copy size={12} /> {t('table_copy')}
          </button>
          <div className="context-menu-divider" />
          <button
            type="button"
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
