import { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/appStore';
import type { SessionConfig } from '../types';

// A session reached through a jump host or proxy is NOT directly TCP-reachable
// from this machine, so a direct ping_host probe would always fail and render a
// misleading "timeout" even when the real SSH connection works. Skip probing
// these — the card shows a neutral "via relay" marker instead.
export function needsRelay(s: SessionConfig): boolean {
  return !!s.jump_host || (!!s.proxy_type && s.proxy_type !== 'none');
}

export function useAssetData() {
  const { t } = useTranslation();
  // Fine-grained selectors: subscribe to each field individually so a latency
  // update (which replaces `sessions`) doesn't re-render just because an
  // unrelated action reference was re-read. Action setters are stable.
  const sessions = useAppStore((s) => s.sessions);
  const selectedSessionIds = useAppStore((s) => s.selectedSessionIds);
  const setSelectedSessionIds = useAppStore((s) => s.setSelectedSessionIds);
  const toggleSelectSession = useAppStore((s) => s.toggleSelectSession);
  const setShowNewSession = useAppStore((s) => s.setShowNewSession);
  const setEditingSession = useAppStore((s) => s.setEditingSession);
  const removeSession = useAppStore((s) => s.removeSession);
  const addSession = useAppStore((s) => s.addSession);
  const addTab = useAppStore((s) => s.addTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const tabs = useAppStore((s) => s.tabs);
  const batchUpdateLatency = useAppStore((s) => s.batchUpdateLatency);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);

  const [searchQuery, setSearchQuery] = useState('');

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
    if (selectedSessionIds.length === 0) return;
    // Confirm before irreversible bulk deletion (matches the per-item guard).
    if (!window.confirm(t('common_delete_confirm_multi', { count: selectedSessionIds.length }))) {
      return;
    }
    selectedSessionIds.forEach((id) => removeSession(id));
    setSelectedSessionIds([]);
  };

  const handleCopySession = (session: SessionConfig) => {
    const copied: SessionConfig = {
      ...session,
      id: crypto.randomUUID(),
      name: `${session.name} - ${t('common_copy_suffix')}`,
      created_at: new Date().toISOString().slice(0, 10),
      _temporary: undefined,
    };
    addSession(copied);
  };

  // Ping latency: fully async, batch-update to avoid blocking renders.
  // `mountedRef` guards against setState-after-unmount: if the component
  // unmounts mid-loop (e.g. switching to the dashboard view), in-flight
  // invoke() calls still resolve but their results are discarded instead of
  // writing to the store of an unmounted component.
  const sessionsRef = useRef(realSessions);
  sessionsRef.current = realSessions;
  const mountedRef = useRef(true);

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
    mountedRef.current = true;
    const markInteraction = () => {
      lastInteractionRef.current = Date.now();
    };

    window.addEventListener('pointerdown', markInteraction, { passive: true });
    window.addEventListener('keydown', markInteraction);
    window.addEventListener('resize', markInteraction);

    return () => {
      mountedRef.current = false;
      window.removeEventListener('pointerdown', markInteraction);
      window.removeEventListener('keydown', markInteraction);
      window.removeEventListener('resize', markInteraction);
    };
  }, []);

  const doPingRef = useRef(() => {});
  doPingRef.current = async () => {
    if (pingLoopRunningRef.current || !mountedRef.current) return;
    const targets = sessionsRef.current.filter((s) => s.host && !needsRelay(s));
    if (targets.length === 0) return;

    pingLoopRunningRef.current = true;
    const updates = new Map<string, number | null>();

    try {
      for (const session of targets) {
        if (!mountedRef.current) break;
        while (Date.now() - lastInteractionRef.current < 1500) {
          await sleep(250);
        }

        // Only bail when the window is actually hidden (minimized/occluded).
        // A merely-unfocused but visible window must still refresh latency —
        // checking !hasFocus() here meant an unfocused app never updated and
        // every card stayed stuck on "timeout".
        if (document.hidden) {
          break;
        }

        try {
          const latency = await invoke<number>('ping_host', {
            host: session.host!,
            port: session.port || 22,
            timeoutSecs: session.connection_timeout,
          });
          updates.set(session.id, latency);
        } catch {
          updates.set(session.id, null);
        }

        // Leave breathing room for UI interactions between hosts.
        await sleep(150);
      }

      if (updates.size > 0 && mountedRef.current) {
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

  return {
    sessions,
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
    addSession,
    handleConnect,
    handleDeleteSelected,
    handleCopySession,
    doPingRef,
    sidebarCollapsed,
    toggleSidebar,
  };
}
