import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { SessionConfig, TabInfo, ThemeMode, MainView } from '../types';
import i18n, { detectLocale, type Locale, type TranslationKeys } from '../i18n';

/** Split layout: how many terminal panes to show simultaneously */
export type SplitCount = 1 | 2 | 4 | 6 | 8;

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
  setActiveTab: (id: string) => void;
  updateTabConnected: (id: string, connected: boolean) => void;

  // Modals
  showNewSession: boolean;
  setShowNewSession: (show: boolean) => void;
  editingSession: SessionConfig | null;
  setEditingSession: (session: SessionConfig | null) => void;
  showDockerModal: boolean;
  setShowDockerModal: (show: boolean) => void;
  showLocalTerminalModal: boolean;
  setShowLocalTerminalModal: (show: boolean) => void;
  showSerialModal: boolean;
  setShowSerialModal: (show: boolean) => void;

  // Menu
  showAppMenu: boolean;
  setShowAppMenu: (show: boolean) => void;

  // Settings
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;

  // Split panes
  splitCount: SplitCount;
  setSplitCount: (count: SplitCount) => void;
  /** Tab IDs pinned to each split pane slot (index 0..splitCount-1). null = show nothing in that slot */
  splitPanes: (string | null)[];
  setSplitPanes: (panes: (string | null)[]) => void;
  /** Assign a tab to a specific pane slot */
  assignPane: (slotIndex: number, tabId: string | null) => void;
  /** The pane slot that's currently focused (for keyboard/click focus) */
  focusedPane: number;
  setFocusedPane: (index: number) => void;

  // Legacy (kept for compat)
  splitDirection: 'horizontal' | 'vertical' | null;
  setSplitDirection: (dir: 'horizontal' | 'vertical' | null) => void;

  // SFTP Panel
  sftpPanelOpen: boolean;
  toggleSftpPanel: () => void;
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

export const useAppStore = create<AppStore>((set, _get) => ({
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
    // Persist to backend (fire-and-forget)
    invoke('save_session', { config: session }).catch(() => {});
  },
  removeSession: (id) => {
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
      selectedSessionIds: state.selectedSessionIds.filter((sid) => sid !== id),
    }));
    invoke('delete_session', { sessionId: id }).catch(() => {});
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
    })),
  removeTab: (id) =>
    set((state) => {
      if (id === 'asset-list') return state;
      const closedTab = state.tabs.find((t) => t.id === id);
      const newTabs = state.tabs.filter((t) => t.id !== id);
      const terminalTabs = newTabs.filter((t) => t.type !== 'asset-list');

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

      // If no more terminal tabs, reset split mode and show asset list
      if (terminalTabs.length === 0) {
        return {
          tabs: newTabs,
          sessions: newSessions,
          activeTabId: 'asset-list',
          mainView: 'asset-list' as MainView,
          splitCount: 1 as SplitCount,
          splitPanes: [null],
        };
      }

      const newActiveId =
        state.activeTabId === id
          ? newTabs[newTabs.length - 1].id
          : state.activeTabId;
      const newMainView = newActiveId === 'asset-list' ? 'asset-list' : 'terminal';

      // Also clean up splitPanes: remove references to the closed tab
      const cleanedPanes = state.splitPanes.map((p) => (p === id ? null : p));

      return { tabs: newTabs, sessions: newSessions, activeTabId: newActiveId, mainView: newMainView as MainView, splitPanes: cleanedPanes };
    }),
  setActiveTab: (id) =>
    set({ activeTabId: id, mainView: id === 'asset-list' ? 'asset-list' : 'terminal' }),
  updateTabConnected: (id, connected) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id ? { ...tab, connected } : tab
      ),
    })),

  showNewSession: false,
  setShowNewSession: (show) => set({ showNewSession: show }),
  editingSession: null,
  setEditingSession: (session) => set({ editingSession: session }),
  showDockerModal: false,
  setShowDockerModal: (show) => set({ showDockerModal: show }),
  showLocalTerminalModal: false,
  setShowLocalTerminalModal: (show) => set({ showLocalTerminalModal: show }),
  showSerialModal: false,
  setShowSerialModal: (show) => set({ showSerialModal: show }),

  showAppMenu: false,
  setShowAppMenu: (show) => set({ showAppMenu: show }),

  showSettings: false,
  setShowSettings: (show) => set({ showSettings: show }),

  splitCount: 1,
  setSplitCount: (count) => set((state) => {
    let currentTabs = [...state.tabs];
    let currentSessions = [...state.sessions];
    let terminalTabs = currentTabs.filter(t => t.type !== 'asset-list');

    const activeTab = currentTabs.find(t => t.id === state.activeTabId && t.type !== 'asset-list');
    const isOnAssetList = !activeTab;

    // --- Determine source sessions for split ---
    // Priority:
    // 1) If on asset list with selected assets → use those selected assets (each gets a pane)
    // 2) If in a terminal tab → clone that terminal's session
    // 3) Fallback to first session
    let selectedSources: SessionConfig[] = [];
    if (isOnAssetList && state.selectedSessionIds.length > 0 && count > 1) {
      // Use selected assets from the asset table (real sessions, not temporary)
      selectedSources = state.selectedSessionIds
        .map(id => currentSessions.find(s => s.id === id))
        .filter((s): s is SessionConfig => !!s && !s._temporary);
    }

    const sourceSession: SessionConfig | undefined =
      (activeTab && currentSessions.find(s => s.id === activeTab.sessionId)) ||
      (terminalTabs[0] && currentSessions.find(s => s.id === terminalTabs[0].sessionId)) ||
      selectedSources[0] ||
      currentSessions.find(s => !s._temporary);

    // --- Shrinking: remove excess temporary tabs/sessions ---
    if (count < state.splitCount) {
      const tabsToRemove: string[] = [];
      const sessionIdsToRemove = new Set<string>();

      if (count <= 1) {
        // Going back to single: remove ALL temporary tabs
        for (const tab of terminalTabs) {
          const sess = currentSessions.find(s => s.id === tab.sessionId);
          if (sess?._temporary) {
            tabsToRemove.push(tab.id);
            sessionIdsToRemove.add(tab.sessionId);
          }
        }
      } else {
        // Shrinking to fewer panes: keep panes[0..count-1], remove excess temporary
        const keepPaneTabIds = new Set(state.splitPanes.slice(0, count).filter(Boolean) as string[]);
        for (const tab of terminalTabs) {
          if (keepPaneTabIds.has(tab.id)) continue;
          const sess = currentSessions.find(s => s.id === tab.sessionId);
          if (sess?._temporary) {
            tabsToRemove.push(tab.id);
            sessionIdsToRemove.add(tab.sessionId);
          }
        }
      }

      if (tabsToRemove.length > 0) {
        import('../components/Terminal/TerminalView').then(({ destroyTerminal }) => {
          tabsToRemove.forEach(id => destroyTerminal(id));
        });
      }

      currentTabs = currentTabs.filter(t => !tabsToRemove.includes(t.id));
      currentSessions = currentSessions.filter(s => !sessionIdsToRemove.has(s.id));
      terminalTabs = currentTabs.filter(t => t.type !== 'asset-list');
    }

    // --- Growing: open tabs for selected assets or clone source ---
    if (count > 1) {
      if (selectedSources.length > 0) {
        // Open a tab for each selected asset that doesn't already have one
        for (const sess of selectedSources) {
          if (!terminalTabs.some(t => t.sessionId === sess.id)) {
            const tabId = crypto.randomUUID();
            const tab: TabInfo = {
              id: tabId,
              sessionId: sess.id,
              title: sess.name,
              type: sess.session_type as TabInfo['type'],
              connected: false,
            };
            currentTabs = [...currentTabs, tab];
            terminalTabs = currentTabs.filter(t => t.type !== 'asset-list');
          }
        }
      } else if (sourceSession && !terminalTabs.some(t => t.sessionId === sourceSession.id)) {
        const tabId = crypto.randomUUID();
        const tab: TabInfo = {
          id: tabId,
          sessionId: sourceSession.id,
          title: sourceSession.name,
          type: sourceSession.session_type as TabInfo['type'],
          connected: false,
        };
        currentTabs = [...currentTabs, tab];
        terminalTabs = currentTabs.filter(t => t.type !== 'asset-list');
      }
    }

    // Auto-create temporary clones to fill remaining panes
    const needed = count > 1 ? count - terminalTabs.length : 0;
    for (let i = 0; i < needed; i++) {
      const sessionId = crypto.randomUUID();
      const tabId = crypto.randomUUID();
      const num = terminalTabs.length + i + 1;
      // Pick a source for the clone: cycle through selected sources, or use single source
      const cloneFrom = selectedSources.length > 0
        ? selectedSources[(terminalTabs.length + i) % selectedSources.length]
        : sourceSession;

      if (cloneFrom) {
        const cloned: SessionConfig = {
          ...cloneFrom,
          id: sessionId,
          name: `${cloneFrom.name} ${num}`,
          created_at: new Date().toISOString().slice(0, 10),
          _temporary: true,
        };
        const tab: TabInfo = {
          id: tabId,
          sessionId,
          title: cloned.name,
          type: cloned.session_type as TabInfo['type'],
          connected: false,
        };
        currentSessions = [...currentSessions, cloned];
        currentTabs = [...currentTabs, tab];
        terminalTabs.push(tab);
      } else {
        const session: SessionConfig = {
          id: sessionId,
          name: `Terminal ${num}`,
          session_type: 'localshell',
          auth_method: 'password',
          created_at: new Date().toISOString().slice(0, 10),
          _temporary: true,
        };
        const tab: TabInfo = {
          id: tabId,
          sessionId,
          title: session.name,
          type: 'localshell',
          connected: false,
        };
        currentSessions = [...currentSessions, session];
        currentTabs = [...currentTabs, tab];
        terminalTabs.push(tab);
      }
    }

    const panes: (string | null)[] = [];
    const used = new Set<string>();
    for (let i = 0; i < count; i++) {
      const existing = state.splitPanes[i];
      if (existing && !used.has(existing) && terminalTabs.some(t => t.id === existing)) {
        panes.push(existing);
        used.add(existing);
      } else {
        const available = terminalTabs.find(t => !used.has(t.id));
        if (available) {
          panes.push(available.id);
          used.add(available.id);
        } else {
          panes.push(null);
        }
      }
    }

    const firstPane = panes.find(p => p !== null);
    const realTerminalTabs = currentTabs.filter(t => t.type !== 'asset-list');
    const result: Partial<AppStore> = {
      splitCount: count,
      splitPanes: panes,
      tabs: currentTabs,
      sessions: currentSessions,
    };
    if (count > 1) {
      result.mainView = 'terminal';
      if (firstPane) {
        result.activeTabId = firstPane;
      }
    } else if (count === 1) {
      // Single pane: activate the first remaining terminal tab, or show asset list
      if (realTerminalTabs.length > 0) {
        result.activeTabId = realTerminalTabs[0].id;
        result.mainView = 'terminal';
      } else {
        result.activeTabId = 'asset-list';
        result.mainView = 'asset-list';
      }
    }
    return result;
  }),
  splitPanes: [null],
  setSplitPanes: (panes) => set({ splitPanes: panes }),
  assignPane: (slotIndex, tabId) => set((state) => {
    const panes = [...state.splitPanes];
    if (slotIndex >= 0 && slotIndex < panes.length) {
      // Remove the tab from any other pane first to prevent the same
      // terminal appearing in multiple panes (which causes duplicate
      // event listeners and double keystrokes).
      if (tabId) {
        for (let i = 0; i < panes.length; i++) {
          if (i !== slotIndex && panes[i] === tabId) {
            panes[i] = null;
          }
        }
      }
      panes[slotIndex] = tabId;
    }
    return { splitPanes: panes };
  }),
  focusedPane: 0,
  setFocusedPane: (index) => set({ focusedPane: index }),

  splitDirection: null,
  setSplitDirection: (dir) => set({ splitDirection: dir }),

  sftpPanelOpen: true,
  toggleSftpPanel: () => set((state) => ({ sftpPanelOpen: !state.sftpPanelOpen })),
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
