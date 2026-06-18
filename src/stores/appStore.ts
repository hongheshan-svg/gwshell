import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { SessionConfig, TabInfo, ThemeMode, MainView } from '../types';
import i18n, { detectLocale, type Locale, type TranslationKeys } from '../i18n';
import { buildSplitPanes, clearSlot, fillFirstEmpty } from '../lib/splitLayout';

export interface DockerContainer { id: string; name: string; image: string; status: string; }

interface AppStore {
  // Locale
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKeys, params?: Record<string, string | number>) => string;

  // Theme
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;

  // Sidebar
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  activeNavItem: string;
  setActiveNavItem: (item: string) => void;

  // Sessions
  sessions: SessionConfig[];
  setSessions: (sessions: SessionConfig[]) => void;
  addSession: (session: SessionConfig) => void;
  addTemporarySession: (session: SessionConfig) => void;
  removeSession: (id: string) => void;
  updateSessionLatency: (id: string, latency: number | null) => void;
  batchUpdateLatency: (updates: Map<string, number | null>) => void;
  selectedSessionIds: string[];
  setSelectedSessionIds: (ids: string[]) => void;
  toggleSelectSession: (id: string) => void;

  // Main view
  mainView: MainView;
  setMainView: (view: MainView) => void;

  // Tabs
  tabs: TabInfo[];
  activeTabId: string | null;
  addTab: (tab: TabInfo) => void;
  removeTab: (id: string) => void;
  reorderTabs: (fromId: string, toId: string) => void;
  setActiveTab: (id: string) => void;
  updateTabConnected: (id: string, connected: boolean) => void;

  // Split (opt-in multi-pane grid). splitCount=1 = single-pane (default).
  splitCount: 1 | 2 | 4 | 6 | 8;
  splitPanes: (string | null)[];
  setSplitCount: (n: 1 | 2 | 4 | 6 | 8) => void;

  // Broadcast
  broadcastInput: boolean;
  toggleBroadcastInput: () => void;

  // Modals
  showNewSession: boolean;
  setShowNewSession: (show: boolean) => void;
  showQuickConnect: boolean;
  setShowQuickConnect: (show: boolean) => void;
  showCommandPalette: boolean;
  setShowCommandPalette: (show: boolean) => void;
  showTerminalSearch: boolean;
  setShowTerminalSearch: (show: boolean) => void;
  editingSession: SessionConfig | null;
  setEditingSession: (session: SessionConfig | null) => void;
  showDockerModal: boolean;
  setShowDockerModal: (show: boolean) => void;
  showLocalTerminalModal: boolean;
  setShowLocalTerminalModal: (show: boolean) => void;
  showSerialModal: boolean;
  setShowSerialModal: (show: boolean) => void;
  dockerPicker: { tabId: string; containers: DockerContainer[] } | null;
  setDockerPicker: (p: { tabId: string; containers: DockerContainer[] } | null) => void;

  // Menu
  showAppMenu: boolean;
  setShowAppMenu: (show: boolean) => void;

  // Settings
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;

  // SFTP Panel
  sftpPanelOpen: boolean;
  toggleSftpPanel: () => void;

  // Server Panel (right-side live metrics drawer — SSH only)
  serverPanelOpen: boolean;
  toggleServerPanel: () => void;

  // Group defaults modal
  groupDefaultsTarget: string | null;
  setGroupDefaultsTarget: (group: string | null) => void;

  // Vault (master-passphrase app lock). When true, a full-screen unlock overlay
  // covers the app until the correct passphrase is entered.
  vaultLocked: boolean;
  setVaultLocked: (locked: boolean) => void;
}

const initialLocale = detectLocale();

// Read sessions injected by Tauri's initialization_script before React loads.
// This eliminates the IPC round-trip that causes the empty-then-populated flash.
function popInjectedSessions(): SessionConfig[] {
  if (typeof window === 'undefined') return [];
  const win = window as unknown as Record<string, unknown>;
  const data = win.__GWSHELL_SESSIONS__;
  if (Array.isArray(data)) {
    delete win.__GWSHELL_SESSIONS__;
    return data as SessionConfig[];
  }
  return [];
}

const _initialSessions = popInjectedSessions();


export const useAppStore = create<AppStore>((set, get) => ({
  locale: initialLocale,
  setLocale: (locale) => {
    void i18n.changeLanguage(locale);
    set({
      locale,
      t: i18n.getFixedT(locale, 'gwshell') as (key: TranslationKeys, params?: Record<string, string | number>) => string,
    });
  },
  t: i18n.getFixedT(initialLocale, 'gwshell') as (key: TranslationKeys, params?: Record<string, string | number>) => string,

  theme: 'dark',
  setTheme: (theme) => set({ theme }),
  toggleTheme: () =>
    set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),

  sidebarCollapsed: false,
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  activeNavItem: 'sessions',
  setActiveNavItem: (item) => set({ activeNavItem: item }),

  sessions: _initialSessions,
  setSessions: (sessions) => set({ sessions }),
  addSession: (session) => {
    set((state) => {
      // Update or insert
      const exists = state.sessions.some((s) => s.id === session.id);
      const sessions = exists
        ? state.sessions.map((s) => (s.id === session.id ? session : s))
        : [...state.sessions, session];
      return { sessions };
    });
    // Persist to backend; surface failures instead of silently dropping them.
    invoke('save_session', { config: session }).catch((err) => {
      console.error('Failed to save session, the UI may be out of sync:', err);
    });
  },
  addTemporarySession: (session) =>
    set((state) => ({ sessions: [...state.sessions, session] })),
  removeSession: (id) => {
    // Capture the removed session so it can be restored if the backend delete
    // fails (otherwise the UI shows it gone but it reappears after restart).
    const removed = get().sessions.find((s) => s.id === id);
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
      selectedSessionIds: state.selectedSessionIds.filter((sid) => sid !== id),
    }));
    invoke('delete_session', { sessionId: id }).catch((err) => {
      if (removed) {
        set((state) => ({ sessions: [...state.sessions, removed] }));
      }
      console.error('Failed to delete session, rolled back:', err);
    });
  },
  updateSessionLatency: (id, latency) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, latency } : s
      ),
    }));
  },
  batchUpdateLatency: (updates) => {
    set((state) => ({
      sessions: state.sessions.map((s) => {
        const val = updates.get(s.id);
        return val !== undefined ? { ...s, latency: val } : s;
      }),
    }));
  },
  selectedSessionIds: [],
  setSelectedSessionIds: (ids) => set({ selectedSessionIds: ids }),
  toggleSelectSession: (id) =>
    set((state) => ({
      selectedSessionIds: state.selectedSessionIds.includes(id)
        ? state.selectedSessionIds.filter((sid) => sid !== id)
        : [...state.selectedSessionIds, id],
    })),

  mainView: 'asset-list',
  setMainView: (view) => set({ mainView: view }),

  tabs: [{ id: 'asset-list', sessionId: '', title: i18n.getFixedT(initialLocale, 'gwshell')('tab_list'), type: 'asset-list', connected: false }],
  activeTabId: 'asset-list',
  addTab: (tab) =>
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
      mainView: tab.type === 'asset-list' ? 'asset-list' : 'terminal',
      splitPanes: state.splitCount > 1 ? fillFirstEmpty(state.splitPanes, tab.id) : state.splitPanes,
    })),
  // Move the tab `fromId` to the position currently held by `toId` (drag &
  // drop reorder). The asset-list home tab is pinned and never moves.
  reorderTabs: (fromId, toId) =>
    set((state) => {
      if (fromId === toId || fromId === 'asset-list' || toId === 'asset-list') return state;
      const from = state.tabs.findIndex((t) => t.id === fromId);
      const to = state.tabs.findIndex((t) => t.id === toId);
      if (from < 0 || to < 0) return state;
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(from, 1);
      tabs.splice(to, 0, moved);
      return { tabs };
    }),
  removeTab: (id) =>
    set((state) => {
      if (id === 'asset-list') return state;
      const closedTab = state.tabs.find((t) => t.id === id);
      const newTabs = state.tabs.filter((t) => t.id !== id);
      const terminalTabs = newTabs.filter((t) => t.type !== 'asset-list');

      // Clear the closed tab from split panes.
      const newSplitPanes = clearSlot(state.splitPanes, id);

      // Clean up temporary sessions created by split-screen cloning
      let newSessions = state.sessions;
      if (closedTab) {
        const session = state.sessions.find((s) => s.id === closedTab.sessionId);
        if (session?._temporary) {
          // Only remove if no other tab uses this session
          const otherTabUsing = newTabs.some((t) => t.sessionId === closedTab.sessionId);
          if (!otherTabUsing) {
            newSessions = state.sessions.filter((s) => s.id !== closedTab.sessionId);
          }
        }
      }

      if (terminalTabs.length === 0) {
        return {
          tabs: newTabs,
          sessions: newSessions,
          activeTabId: 'asset-list',
          mainView: 'asset-list' as MainView,
          splitCount: 1,
          splitPanes: [],
        };
      }

      const newActiveId =
        state.activeTabId === id
          ? newTabs[newTabs.length - 1].id
          : state.activeTabId;
      const newMainView = newActiveId === 'asset-list' ? 'asset-list' : 'terminal';

      const collapsedCount = terminalTabs.length <= 1 ? 1 : state.splitCount;
      const collapsedPanes = collapsedCount === 1 ? [] : newSplitPanes;
      return {
        tabs: newTabs,
        sessions: newSessions,
        activeTabId: newActiveId,
        mainView: newMainView as MainView,
        splitCount: collapsedCount,
        splitPanes: collapsedPanes,
      };
    }),
  setActiveTab: (id) =>
    set({ activeTabId: id, mainView: id === 'asset-list' ? 'asset-list' : 'terminal' }),
  updateTabConnected: (id, connected) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id ? { ...tab, connected } : tab
      ),
    })),

  splitCount: 1,
  splitPanes: [],
  setSplitCount: (n) =>
    set((state) => {
      if (n === 1) return { splitCount: 1, splitPanes: [] };
      const termIds = state.tabs.filter((t) => t.type !== 'asset-list').map((t) => t.id);
      return { splitCount: n, splitPanes: buildSplitPanes(termIds, state.activeTabId, n) };
    }),

  broadcastInput: false,
  toggleBroadcastInput: () => set((s) => ({ broadcastInput: !s.broadcastInput })),

  showNewSession: false,
  setShowNewSession: (show) => set({ showNewSession: show }),
  showQuickConnect: false,
  setShowQuickConnect: (show) => set({ showQuickConnect: show }),
  showCommandPalette: false,
  setShowCommandPalette: (show) => set({ showCommandPalette: show }),
  showTerminalSearch: false,
  setShowTerminalSearch: (show) => set({ showTerminalSearch: show }),
  editingSession: null,
  setEditingSession: (session) => set({ editingSession: session }),
  showDockerModal: false,
  setShowDockerModal: (show) => set({ showDockerModal: show }),
  showLocalTerminalModal: false,
  setShowLocalTerminalModal: (show) => set({ showLocalTerminalModal: show }),
  showSerialModal: false,
  setShowSerialModal: (show) => set({ showSerialModal: show }),
  dockerPicker: null,
  setDockerPicker: (p) => set({ dockerPicker: p }),

  showAppMenu: false,
  setShowAppMenu: (show) => set({ showAppMenu: show }),

  showSettings: false,
  setShowSettings: (show) => set({ showSettings: show }),

  sftpPanelOpen: true,
  toggleSftpPanel: () => set((state) => ({ sftpPanelOpen: !state.sftpPanelOpen })),

  serverPanelOpen: false,
  toggleServerPanel: () => set((state) => ({ serverPanelOpen: !state.serverPanelOpen })),

  groupDefaultsTarget: null,
  setGroupDefaultsTarget: (group) => set({ groupDefaultsTarget: group }),

  vaultLocked: false,
  setVaultLocked: (locked) => set({ vaultLocked: locked }),
}));

// Keep store in sync if i18next.changeLanguage is called from outside the store.
i18n.on('languageChanged', (lng) => {
  if (lng === 'zh' || lng === 'en') {
    const cur = useAppStore.getState();
    if (cur.locale !== lng) {
      useAppStore.setState({
        locale: lng,
        t: i18n.getFixedT(lng, 'gwshell') as typeof cur.t,
      });
    }
  }
});
