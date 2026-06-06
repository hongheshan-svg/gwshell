import { Suspense, lazy, useEffect, useMemo, useRef } from 'react';
import { I18nextProvider } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { TitleBar } from './components/TitleBar/TitleBar';
import { Sidebar } from './components/Sidebar/IconNav';
import { SessionPanel } from './components/Sidebar/SessionPanel';
import { SnippetPanel } from './components/Sidebar/SnippetPanel';
import { useSnippetStore } from './stores/snippetStore';
import { TabBar } from './components/TabBar/TabBar';
import { AssetTable } from './components/AssetTable/AssetTable';
import { StatusBar } from './components/StatusBar/StatusBar';

// Heavy / interaction-only chunks: deferred until the user actually needs them.
// On startup we only render the shell + asset list — every other resource (xterm,
// SFTP editor, plugin-dialog, plugin-opener, deep-link, modals) loads on demand.
const TerminalContainer = lazy(() => import('./components/Terminal/TerminalContainer').then(m => ({ default: m.TerminalContainer })));
const SftpPanel = lazy(() => import('./components/SftpPanel/SftpPanel').then(m => ({ default: m.SftpPanel })));
import { useAppStore } from './stores/appStore';
import { useSettingsStore } from './stores/settingsStore';
import { useSettingsEffects } from './hooks/useSettingsEffects';
import i18n from './i18n';
import type { SessionConfig } from './types';
import * as commandHistory from './lib/commandHistory';
import { saveOpenTabs, tabsSignature, loadOpenTabs } from './lib/tabSession';
import './styles/global.css';

const NewSessionModal = lazy(() => import('./components/Modals/NewSessionModal').then((m) => ({ default: m.NewSessionModal })));
const QuickConnectModal = lazy(() => import('./components/Modals/QuickConnectModal').then((m) => ({ default: m.QuickConnectModal })));
const DockerModal = lazy(() => import('./components/Modals/DockerModal').then((m) => ({ default: m.DockerModal })));
const LocalTerminalModal = lazy(() => import('./components/Modals/LocalTerminalModal').then((m) => ({ default: m.LocalTerminalModal })));
const SerialPortModal = lazy(() => import('./components/Modals/SerialPortModal').then((m) => ({ default: m.SerialPortModal })));
const SettingsModal = lazy(() => import('./components/Settings/SettingsModal').then((m) => ({ default: m.SettingsModal })));
const AppMenu = lazy(() => import('./components/AppMenu/AppMenu').then((m) => ({ default: m.AppMenu })));
const UpdateChecker = lazy(() => import('./components/UpdateChecker/UpdateChecker').then((m) => ({ default: m.UpdateChecker })));
const SecurityNotice = lazy(() => import('./components/SecurityNotice/SecurityNotice').then((m) => ({ default: m.SecurityNotice })));
const ServerPanel = lazy(() => import('./components/ServerPanel').then((m) => ({ default: m.ServerPanel })));
const CommandPalette = lazy(() => import('./components/CommandPalette/CommandPalette').then((m) => ({ default: m.CommandPalette })));

function App() {
  useSettingsEffects();
  const { theme, setSessions, tabs, activeTabId, sftpPanelOpen, sessions,
    showNewSession, showQuickConnect, showDockerModal, showLocalTerminalModal, showSerialModal, showSettings, showAppMenu,
    showCommandPalette,
    mainView, activeNavItem } = useAppStore();
  const toggleBroadcastInput = useAppStore((s) => s.toggleBroadcastInput);
  const setShowCommandPalette = useAppStore((s) => s.setShowCommandPalette);
  const loadSettings = useSettingsStore((s) => s.load);
  const settingsLoaded = useSettingsStore((s) => s.loaded);
  const sessionTabMemory = useSettingsStore((s) => s.settings.sessionTabMemory);
  const sshHistoryCmd = useSettingsStore((s) => s.settings.sshHistoryCmd);
  const sshHistoryCmdLoadCount = useSettingsStore((s) => s.settings.sshHistoryCmdLoadCount);

  // Show asset table directly (synchronous) when no terminal is active.
  // TerminalContainer is lazy-loaded with xterm.js (344KB); showing AssetTable
  // through it would cause the asset list to flash in only after the heavy chunk loads.
  const showAssetTable = activeTabId === 'asset-list' || mainView === 'asset-list'
    || tabs.filter(t => t.type !== 'asset-list').length === 0;
  const needTerminals = !showAssetTable;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (!settingsLoaded) return;
    if (sshHistoryCmd) {
      commandHistory.init(parseInt(sshHistoryCmdLoadCount) || 100);
    }
    // sshHistoryCmd/Count intentionally omitted: setting changes go through
    // settingsStore.save() which re-calls init() directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded]);

  // Boot sequence: show only the splash card for 2s, then crossfade to the app.
  // 1. Show the window immediately (transparent — only the card is visible).
  // 2. After the minimum splash duration, fade the card out AND reveal #root
  //    at the same time so the main window "appears" as the card disappears.
  useEffect(() => {
    const MIN_SPLASH_MS = 2000;
    invoke('app_ready').catch(() => {});

    const t0 = (window as unknown as { __GWSHELL_BOOT_T0__?: number }).__GWSHELL_BOOT_T0__ ?? performance.now();
    const elapsed = performance.now() - t0;
    const remaining = Math.max(0, MIN_SPLASH_MS - elapsed);

    const timer = setTimeout(() => {
      // Reveal app and fade splash simultaneously.
      document.getElementById('root')?.classList.add('ready');
      const splash = document.getElementById('boot-splash');
      if (splash) {
        splash.classList.add('fade-out');
        splash.addEventListener('transitionend', () => splash.remove(), { once: true });
        setTimeout(() => { try { splash.remove(); } catch {} }, 600);
      }
    }, remaining);

    return () => clearTimeout(timer);
  }, []);

  // Sessions are pre-loaded via Tauri's initialization_script (window.__GWSHELL_SESSIONS__).
  // Fall back to IPC only when the injection wasn't available (edge cases / dev hot-reload).
  useEffect(() => {
    if (sessions.length === 0) {
      invoke<SessionConfig[]>('get_sessions')
        .then((s) => { if (s.length > 0) setSessions(s); })
        .catch(() => {});
    }
  }, []);

  // Persist the open-tab set (debounced) when "remember tabs" is on. Keyed on a
  // derived signature so connect/disconnect (`connected`) changes don't rewrite.
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
    // tabs/sessions/activeTabId intentionally omitted: tabSig captures the
    // restorable signature; the timer reads the latest values when it fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabSig, settingsLoaded, sessionTabMemory]);

  // Restore tabs once, after settings load AND sessions hydrate. Auto-reconnect
  // happens via each restored TerminalView's setupConnection on mount.
  const restoredRef = useRef(false);
  const { addTab, setActiveTab } = useAppStore();
  useEffect(() => {
    if (restoredRef.current || !settingsLoaded) return;
    if (!sessionTabMemory) { restoredRef.current = true; return; }
    // Wait for sessions to hydrate (sync injection or async get_sessions fallback).
    if (sessions.length === 0) return;
    restoredRef.current = true;

    const stored = loadOpenTabs();
    if (!stored) return;
    const byId = new Map(sessions.map((s) => [s.id, s]));
    const newIds: string[] = [];
    for (const pt of stored.tabs) {
      const s = byId.get(pt.sessionId);
      if (!s || s._temporary) continue; // session deleted or temporary — skip
      const id = crypto.randomUUID();
      addTab({ id, sessionId: pt.sessionId, title: pt.title, type: pt.type, connected: false });
      newIds.push(id);
    }
    if (newIds.length > 0) {
      const idx = Math.min(Math.max(0, stored.activeTabIndex), newIds.length - 1);
      setActiveTab(newIds[idx]);
    }
  }, [settingsLoaded, sessionTabMemory, sessions, addTab, setActiveTab]);

  const loadSnippets = useSnippetStore((s) => s.load);
  useEffect(() => {
    void loadSnippets();
  }, [loadSnippets]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); toggleBroadcastInput(); }
      else if (k === 'f') { e.preventDefault(); setShowCommandPalette(true); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [toggleBroadcastInput, setShowCommandPalette]);

  return (
    <I18nextProvider i18n={i18n}>
      <div className="app-root">
        <TitleBar />
        <div className="app-layout">
          <Sidebar />
          {activeNavItem === 'snippets' ? <SnippetPanel /> : <SessionPanel />}
          <div className="main-content">
            <TabBar />
            <div className="terminal-sftp-wrapper">
              {showAssetTable && (
                <div className="terminal-container">
                  <AssetTable />
                </div>
              )}
              {needTerminals && (
                <Suspense fallback={null}><TerminalContainer /></Suspense>
              )}
              {sftpPanelOpen && (() => {
                const activeTab = tabs.find(t => t.id === activeTabId);
                if (activeTab?.type !== 'ssh') return null;
                const sess = sessions.find(s => s.id === activeTab.sessionId);
                return (
                  <Suspense fallback={null}>
                    <SftpPanel sessionId={activeTab.sessionId} username={sess?.username} connected={activeTab.connected} />
                  </Suspense>
                );
              })()}
            </div>
            <StatusBar />
          </div>
        </div>
        <Suspense fallback={null}>
          {showNewSession && <NewSessionModal />}
          {showQuickConnect && <QuickConnectModal />}
          {showDockerModal && <DockerModal />}
          {showLocalTerminalModal && <LocalTerminalModal />}
          {showSerialModal && <SerialPortModal />}
          {showSettings && <SettingsModal />}
          {showAppMenu && <AppMenu />}
          {showCommandPalette && <CommandPalette />}
          <UpdateChecker />
          <SecurityNotice />
          <ServerPanel />
        </Suspense>
      </div>
    </I18nextProvider>
  );
}

export default App;
