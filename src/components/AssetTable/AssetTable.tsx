import React, { useState, useRef, useEffect } from 'react';
import {
  Search,
  Menu,
  Server,
  RefreshCw,
  Plus,
  Trash2,
  Edit,
  Play,
  Copy,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
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
    addSession,
    addTab,
    setActiveTab,
    tabs,
    t,
    batchUpdateLatency,
  } = useAppStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; session: SessionConfig } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Filter out temporary sessions created by split-screen
  const realSessions = sessions.filter((s) => !s._temporary);

  const filteredSessions = searchQuery
    ? realSessions.filter(
        (s) =>
          s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (s.host && s.host.toLowerCase().includes(searchQuery.toLowerCase())) ||
          (s.username && s.username.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : realSessions;

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

  // Ping latency: fully async, batch-update to avoid blocking renders
  const sessionsRef = useRef(realSessions);
  sessionsRef.current = realSessions;

  const idleCallbackRef = useRef<number | null>(null);
  const idleUsesTimeoutRef = useRef(false);
  const lastInteractionRef = useRef(Date.now());
  const pingLoopRunningRef = useRef(false);

  const sleep = (ms: number) => new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

  const scheduleIdle = (callback: () => void) => {
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleUsesTimeoutRef.current = false;
      idleCallbackRef.current = window.requestIdleCallback(callback, { timeout: 2000 });
      return;
    }
    idleUsesTimeoutRef.current = true;
    idleCallbackRef.current = setTimeout(callback, 0);
  };

  const cancelIdle = () => {
    if (idleCallbackRef.current == null) return;
    if (!idleUsesTimeoutRef.current && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
      window.cancelIdleCallback(idleCallbackRef.current);
    } else {
      clearTimeout(idleCallbackRef.current);
    }
    idleCallbackRef.current = null;
  };

  useEffect(() => {
    const markInteraction = () => {
      lastInteractionRef.current = Date.now();
    };

    window.addEventListener('pointerdown', markInteraction, { passive: true });
    window.addEventListener('keydown', markInteraction);
    window.addEventListener('resize', markInteraction);

    return () => {
      window.removeEventListener('pointerdown', markInteraction);
      window.removeEventListener('keydown', markInteraction);
      window.removeEventListener('resize', markInteraction);
    };
  }, []);

  const doPingRef = useRef(() => {});
  doPingRef.current = async () => {
    if (pingLoopRunningRef.current) return;
    const targets = sessionsRef.current.filter((s) => s.host);
    if (targets.length === 0) return;

    pingLoopRunningRef.current = true;
    const updates = new Map<string, number | null>();

    try {
      for (const session of targets) {
        while (Date.now() - lastInteractionRef.current < 1500) {
          await sleep(250);
        }

        if (document.hidden || !document.hasFocus()) {
          break;
        }

        try {
          const latency = await invoke<number>('ping_host', {
            host: session.host!,
            port: session.port || 22,
          });
          updates.set(session.id, latency);
        } catch {
          updates.set(session.id, null);
        }

        // Leave breathing room for UI interactions between hosts.
        await sleep(150);
      }

      if (updates.size > 0) {
        batchUpdateLatency(updates);
      }
    } finally {
      pingLoopRunningRef.current = false;
    }
  };

  useEffect(() => {
    // First ping waits until the UI is already visible and the main thread is idle.
    const initTimer = window.setTimeout(() => {
      scheduleIdle(() => {
        void doPingRef.current();
      });
    }, 8000);
    const timer = setInterval(() => doPingRef.current(), 60_000);
    return () => {
      clearTimeout(initTimer);
      clearInterval(timer);
      cancelIdle();
    };
  }, []);

  return (
    <div className="asset-table-wrapper">
      {/* Toolbar */}
      <div className="asset-toolbar">
        <div className="asset-toolbar-left">
          <span className="asset-toolbar-icon"><Menu size={14} /></span>
          <span className="asset-toolbar-title">{t('table_title')}</span>
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
