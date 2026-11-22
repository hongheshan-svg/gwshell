import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronRight,
  ChevronDown,
  Plus,
  Search,
  Server,
  Settings,
  Copy,
  Play,
  Edit,
  Trash2,
  X,
  ScrollText,
  Pencil,
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useConfirm } from '../../hooks/useConfirm';
import { openNewAssetModal } from '../../lib/newAssetAction';
import { NewAssetMenu } from './NewAssetMenu';
import { EmptyIllustration, GroupFolderIcon, ProtocolIcon } from '../Icons/BrandIcons';
import type { SessionConfig } from '../../types';

export const SessionPanel: React.FC = () => {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const sessions = useAppStore((s) => s.sessions);
  const openEditSession = useAppStore((s) => s.openEditSession);
  const removeSession = useAppStore((s) => s.removeSession);
  const setActiveNavItem = useAppStore((s) => s.setActiveNavItem);
  const setGroupDefaultsTarget = useAppStore((s) => s.setGroupDefaultsTarget);

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewAssetMenu, setShowNewAssetMenu] = useState(false);
  const plusBtnRef = useRef<HTMLButtonElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    session: SessionConfig;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

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

  const filteredSessions = searchQuery.trim()
    ? allSessions.filter((s) => {
        const q = searchQuery.trim().toLowerCase();
        return (
          s.name.toLowerCase().includes(q) ||
          (s.host?.toLowerCase().includes(q) ?? false) ||
          (s.username?.toLowerCase().includes(q) ?? false)
        );
      })
    : null;

  return (
    <div className="sidebar-panel">
      {/* Top mode switcher: Hosts / Snippets */}
      <div className="sidebar-top">
        <div className="sidebar-seg" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={true}
            className="sidebar-seg__btn active"
            onClick={() => setActiveNavItem('sessions')}
          >
            <Server size={12} />
            <span>{t('sidebar_tab_hosts')}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={false}
            className="sidebar-seg__btn"
            onClick={() => setActiveNavItem('snippets')}
          >
            <ScrollText size={12} />
            <span>{t('sidebar_tab_snippets')}</span>
          </button>
        </div>

        {/* Always-accessible search + compact add trigger */}
        <div className="sidebar-search-row">
          <div className="sidebar-search">
            <Search size={12} />
            <input
              type="text"
              placeholder={t('panel_search_placeholder')}
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
            ref={plusBtnRef}
            className="sidebar-action-btn sidebar-add-btn"
            onClick={() => setShowNewAssetMenu(!showNewAssetMenu)}
            title={t('panel_new_asset')}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className="sidebar-content">
        {filteredSessions ? (
          filteredSessions.length === 0 ? (
            <div className="sidebar-empty sidebar-empty--search">
              <Search size={20} />
              <p>{t('table_no_matches')}</p>
            </div>
          ) : (
            filteredSessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                onConnect={handleConnect}
                onEdit={openEditSession}
                onContextMenu={handleContextMenu}
              />
            ))
          )
        ) : allSessions.length === 0 ? (
          <div className="sidebar-empty">
            <EmptyIllustration variant="hosts" size={50} />
            <p>{t('panel_no_assets')}</p>
          </div>
        ) : (
          Object.entries(groups).map(([groupName, groupSessions]) => {
            const expanded = expandedGroups[groupName] !== false;
            return (
              <div key={groupName} className="session-group">
                <div
                  className="session-group-header"
                  role="button"
                  tabIndex={0}
                  aria-expanded={expanded}
                  onClick={() => toggleGroup(groupName)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleGroup(groupName);
                    }
                  }}
                >
                  <span className="session-group-chevron">
                    {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </span>
                  <GroupFolderIcon expanded={expanded} size={15} />
                  <span className="session-group-name">{groupName}</span>
                  <button
                    type="button"
                    className="session-group-defaults-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setGroupDefaultsTarget(groupName);
                    }}
                    title={t('group_defaults_title')}
                  >
                    <Settings size={11} />
                  </button>
                  <span className="session-group-count">{groupSessions.length}</span>
                </div>
                {expanded && (
                  <div className="session-group-list">
                    {groupSessions.map((session) => (
                      <SessionItem
                        key={session.id}
                        session={session}
                        onConnect={handleConnect}
                        onEdit={openEditSession}
                        onContextMenu={handleContextMenu}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {showNewAssetMenu && (
        <NewAssetMenu
          anchorRef={plusBtnRef}
          onClose={() => setShowNewAssetMenu(false)}
          onSelect={openNewAssetModal}
        />
      )}

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

function getSessionSubtitle(session: SessionConfig): string | null {
  if (session.username && session.host) {
    return `${session.username}@${session.host}`;
  }
  if (session.host) return session.host;
  if (session.session_type === 'serial' && session.serial_port) return session.serial_port;
  if (session.session_type === 'localshell' && session.shell_name) return session.shell_name;
  return null;
}

const SessionItem: React.FC<{
  session: SessionConfig;
  onConnect: (session: SessionConfig) => void;
  onEdit: (session: SessionConfig) => void;
  onContextMenu: (e: React.MouseEvent, session: SessionConfig) => void;
}> = React.memo(({ session, onConnect, onEdit, onContextMenu }) => {
  const { t } = useTranslation();
  const sessionTab = useAppStore((s) => s.tabs.find((t) => t.sessionId === session.id));
  const activeTabId = useAppStore((s) => s.activeTabId);
  const isActive = sessionTab?.id === activeTabId;
  const isConnected = sessionTab?.connected === true;
  const subtitle = getSessionSubtitle(session);

  const protoClass =
    session.session_type === 'docker'
      ? 'proto--docker'
      : session.session_type === 'serial'
        ? 'proto--serial'
        : session.session_type === 'localshell'
          ? 'proto--local'
          : 'proto--ssh';

  return (
    <div
      className={`session-item${isActive ? ' active' : ''}${isConnected ? ' is-connected' : ''}`}
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
      <span className={`session-item-icon ${protoClass}`}>
        <ProtocolIcon type={session.session_type} size={15} />
      </span>
      <span className="session-item-text">
        <span className="session-item-name">{session.name}</span>
        {subtitle && <span className="session-item-sub">{subtitle}</span>}
      </span>
      <button
        type="button"
        className="session-item-edit"
        title={t('table_edit')}
        aria-label={t('table_edit')}
        onClick={(e) => {
          e.stopPropagation();
          onEdit(session);
        }}
      >
        <Pencil size={11} />
      </button>
      {session.color_label && (
        <span
          className="session-color-pip"
          style={{ background: session.color_label }}
          aria-hidden="true"
        />
      )}
      {isConnected && <span className="session-status-dot connected" />}
    </div>
  );
});
