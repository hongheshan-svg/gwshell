import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../stores/appStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSnippetStore } from '../stores/snippetStore';
import { createKeymapHandler } from '../keymap/dispatch';
import * as commandHistory from '../lib/commandHistory';
import { loadOpenTabs, saveOpenTabs, tabsSignature } from '../lib/tabSession';
import type { SessionConfig } from '../types';

/**
 * Orchestrates app startup and workspace-level side effects:
 * settings/snippets load, boot splash crossfade, vault lock check,
 * session hydration fallback, tab-session persistence/restore, and global keymap.
 */
export function useAppBoot() {
  const {
    theme,
    tabs,
    activeTabId,
    sessions,
    vaultLocked,
    setSessions,
    setVaultLocked,
    addTab,
    setActiveTab,
  } = useAppStore(
    useShallow((s) => ({
      theme: s.theme,
      tabs: s.tabs,
      activeTabId: s.activeTabId,
      sessions: s.sessions,
      vaultLocked: s.vaultLocked,
      setSessions: s.setSessions,
      setVaultLocked: s.setVaultLocked,
      addTab: s.addTab,
      setActiveTab: s.setActiveTab,
    })),
  );

  const loadSettings = useSettingsStore((s) => s.load);
  const settingsLoaded = useSettingsStore((s) => s.loaded);
  const sessionTabMemory = useSettingsStore((s) => s.settings.sessionTabMemory);
  const sshHistoryCmd = useSettingsStore((s) => s.settings.sshHistoryCmd);
  const sshHistoryCmdLoadCount = useSettingsStore((s) => s.settings.sshHistoryCmdLoadCount);
  const keymapOverrides = useSettingsStore((s) => s.settings.keymapOverrides);
  const loadSnippets = useSnippetStore((s) => s.load);

  const [vaultChecked, setVaultChecked] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    void loadSnippets();
  }, [loadSnippets]);

  useEffect(() => {
    if (!settingsLoaded) return;
    if (sshHistoryCmd) {
      void commandHistory.init(parseInt(sshHistoryCmdLoadCount) || 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded]);

  // Boot splash crossfade
  useEffect(() => {
    const MIN_SPLASH_MS = 2000;
    invoke('app_ready').catch(() => {});

    const t0 =
      // eslint-disable-next-line no-restricted-syntax
      (window as unknown as { __GWSHELL_BOOT_T0__?: number }).__GWSHELL_BOOT_T0__ ??
      performance.now();
    const remaining = Math.max(0, MIN_SPLASH_MS - (performance.now() - t0));

    const timer = setTimeout(() => {
      document.getElementById('root')?.classList.add('ready');
      const splash = document.getElementById('boot-splash');
      if (splash) {
        splash.classList.add('fade-out');
        splash.addEventListener('transitionend', () => splash.remove(), { once: true });
        setTimeout(() => {
          try {
            splash.remove();
          } catch {}
        }, 600);
      }
    }, remaining);

    return () => clearTimeout(timer);
  }, []);

  // Vault lock gate
  useEffect(() => {
    invoke<boolean>('vault_is_enabled')
      .then((enabled) => {
        if (enabled) setVaultLocked(true);
      })
      .catch(() => {})
      .finally(() => setVaultChecked(true));
  }, [setVaultLocked]);

  // Session hydration fallback (if Tauri init_script injection was unavailable)
  const didFetchSessionsRef = useRef(false);
  useEffect(() => {
    if (didFetchSessionsRef.current) return;
    if (sessions.length === 0) {
      didFetchSessionsRef.current = true;
      invoke<SessionConfig[]>('get_sessions')
        .then((s) => {
          if (s.length > 0) setSessions(s);
        })
        .catch(() => {});
    }
  }, [sessions.length, setSessions]);

  // Persist open-tab signature (debounced)
  const tabSig = useMemo(
    () => tabsSignature(tabs, sessions, activeTabId),
    [tabs, sessions, activeTabId],
  );
  useEffect(() => {
    if (!settingsLoaded || !sessionTabMemory) return;
    const timer = setTimeout(() => {
      saveOpenTabs(tabs, sessions, activeTabId);
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabSig, settingsLoaded, sessionTabMemory]);

  // Restore saved tabs once settings load, vault is unlocked, and sessions hydrate
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !settingsLoaded || !vaultChecked || vaultLocked) return;
    if (!sessionTabMemory) {
      restoredRef.current = true;
      return;
    }
    if (sessions.length === 0) return;
    restoredRef.current = true;

    const stored = loadOpenTabs();
    if (!stored) return;
    const byId = new Map(sessions.map((s) => [s.id, s]));
    const newIds: string[] = [];
    for (const pt of stored.tabs) {
      const s = byId.get(pt.sessionId);
      if (!s || s._temporary) continue;
      const id = crypto.randomUUID();
      addTab({ id, sessionId: pt.sessionId, title: pt.title, type: pt.type, connected: false });
      newIds.push(id);
    }
    if (newIds.length > 0) {
      const idx = Math.min(Math.max(0, stored.activeTabIndex), newIds.length - 1);
      setActiveTab(newIds[idx]);
    }
  }, [settingsLoaded, vaultChecked, vaultLocked, sessionTabMemory, sessions, addTab, setActiveTab]);

  // Global keymap listener
  useEffect(() => {
    const handler = createKeymapHandler(() => useSettingsStore.getState().settings.keymapOverrides);
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [keymapOverrides]);
}
