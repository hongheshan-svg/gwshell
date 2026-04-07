import { Suspense, lazy, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { TitleBar } from './components/TitleBar/TitleBar';
import { Sidebar } from './components/Sidebar/IconNav';
import { SessionPanel } from './components/Sidebar/SessionPanel';
import { TabBar } from './components/TabBar/TabBar';
import { AssetTable } from './components/AssetTable/AssetTable';
import { StatusBar } from './components/StatusBar/StatusBar';

// Heavy / interaction-only chunks: deferred until the user actually needs them.
// On startup we only render the shell + asset list — every other resource (xterm,
// SFTP editor, plugin-dialog, plugin-opener, deep-link, modals) loads on demand.
const TerminalContainer = lazy(() => import('./components/Terminal/TerminalContainer').then(m => ({ default: m.TerminalContainer })));
const SftpPanel = lazy(() => import('./components/SftpPanel/SftpPanel').then(m => ({ default: m.SftpPanel })));
import { useAppStore } from './stores/appStore';
import type { SessionConfig } from './types';
import './styles/global.css';

const NewSessionModal = lazy(() => import('./components/Modals/NewSessionModal').then((m) => ({ default: m.NewSessionModal })));
const DockerModal = lazy(() => import('./components/Modals/DockerModal').then((m) => ({ default: m.DockerModal })));
const LocalTerminalModal = lazy(() => import('./components/Modals/LocalTerminalModal').then((m) => ({ default: m.LocalTerminalModal })));
const SerialPortModal = lazy(() => import('./components/Modals/SerialPortModal').then((m) => ({ default: m.SerialPortModal })));
const SettingsModal = lazy(() => import('./components/Settings/SettingsModal').then((m) => ({ default: m.SettingsModal })));
const AppMenu = lazy(() => import('./components/AppMenu/AppMenu').then((m) => ({ default: m.AppMenu })));
const UpdateChecker = lazy(() => import('./components/UpdateChecker/UpdateChecker').then((m) => ({ default: m.UpdateChecker })));

function App() {
  const { theme, setSessions, sidebarCollapsed, toggleSidebar, tabs, activeTabId, sftpPanelOpen, sessions,
    showNewSession, showDockerModal, showLocalTerminalModal, showSerialModal, showSettings, showAppMenu,
    mainView, splitCount } = useAppStore();

  // Show asset table directly (synchronous) when no terminal is active.
  // TerminalContainer is lazy-loaded with xterm.js (344KB); showing AssetTable
  // through it would cause the asset list to flash in only after the heavy chunk loads.
  const showAssetTable = splitCount <= 1 && (activeTabId === 'asset-list' || mainView === 'asset-list'
    || tabs.filter(t => t.type !== 'asset-list').length === 0);
  const needTerminals = !showAssetTable;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

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

  // Deep link handler: gwshell://import/provider?data=... | gwshell://connect/ssh?host=...&user=...
  // Both the plugin module AND its registration are deferred ~5s after startup
  // — deep links are never needed in the first seconds, and dynamic-importing
  // the plugin keeps it out of the main bundle.
  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;
    const timer = setTimeout(() => {
      if (cancelled) return;
      import('@tauri-apps/plugin-deep-link').then(({ onOpenUrl }) => {
        if (cancelled) return;
        onOpenUrl((urls: string[]) => {
          for (const raw of urls) {
            try {
              const url = new URL(raw);
              const path = url.hostname + url.pathname;
              if (path === 'import/provider') {
                const data = url.searchParams.get('data');
                if (data) {
                  const provider = JSON.parse(decodeURIComponent(data));
                  invoke('save_ai_provider', { provider }).catch(console.error);
                }
              } else if (path === 'import/mcp') {
                const data = url.searchParams.get('data');
                if (data) {
                  const server = JSON.parse(decodeURIComponent(data));
                  invoke('save_mcp_server', { server }).catch(console.error);
                }
              }
            } catch { /* ignore malformed URLs */ }
          }
        }).then(fn => { if (!cancelled) unlistenFn = fn; });
      }).catch(() => {});
    }, 5000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      unlistenFn?.();
    };
  }, []);

  return (
    <div className="app-root">
      <TitleBar />
      <div className="app-layout">
        <Sidebar />
        <SessionPanel />
        <button
          className="sidebar-collapse-toggle"
          onClick={toggleSidebar}
          title={sidebarCollapsed ? '展开面板' : '折叠面板'}
        >
          {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
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
                  <SftpPanel sessionId={activeTab.sessionId} username={sess?.username} />
                </Suspense>
              );
            })()}
          </div>
          <StatusBar />
        </div>
      </div>
      <Suspense fallback={null}>
        {showNewSession && <NewSessionModal />}
        {showDockerModal && <DockerModal />}
        {showLocalTerminalModal && <LocalTerminalModal />}
        {showSerialModal && <SerialPortModal />}
        {showSettings && <SettingsModal />}
        {showAppMenu && <AppMenu />}
        <UpdateChecker />
      </Suspense>
    </div>
  );
}

export default App;
