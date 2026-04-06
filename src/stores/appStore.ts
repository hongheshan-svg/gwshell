import { create } from 'zustand';
import type { SessionConfig, TabInfo, ThemeMode, MainView } from '../types';
import { detectLocale, getT, type Locale, type TranslationKeys } from '../i18n';

/** Split layout: how many terminal panes to show simultaneously */
export type SplitCount = 1 | 2 | 4 | 6 | 8;

interface AppStore {
  // Locale
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKeys, params?: Record<string, string | number>) => string;

  // Theme
  theme: ThemeMode;
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
}

const initialLocale = detectLocale();
const initialT = getT(initialLocale);

export const useAppStore = create<AppStore>((set, _get) => ({
  locale: initialLocale,
  setLocale: (locale: Locale) => set({ locale, t: getT(locale) }),
  t: initialT,

  theme: 'dark',
  toggleTheme: () =>
    set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),

  sidebarCollapsed: false,
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  activeNavItem: 'sessions',
  setActiveNavItem: (item) => set({ activeNavItem: item }),

  sessions: [],
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
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke('save_session', { config: session }).catch(() => {});
    });
  },
  removeSession: (id) => {
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
      selectedSessionIds: state.selectedSessionIds.filter((sid) => sid !== id),
    }));
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke('delete_session', { sessionId: id }).catch(() => {});
    });
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

  tabs: [{ id: 'asset-list', sessionId: '', title: initialT('tab_list'), type: 'asset-list', connected: false }],
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
      const newTabs = state.tabs.filter((t) => t.id !== id);
      const newActiveId =
        state.activeTabId === id
          ? newTabs.length > 0
            ? newTabs[newTabs.length - 1].id
            : null
          : state.activeTabId;
      return { tabs: newTabs, activeTabId: newActiveId };
    }),
  setActiveTab: (id) =>
    set({ activeTabId: id, mainView: id === 'asset-list' ? 'asset-list' : 'terminal' }),

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

    // Find the "source" session to clone from:
    // 1) Active tab's session  2) First terminal tab's session  3) First session in list
    const activeTab = currentTabs.find(t => t.id === state.activeTabId && t.type !== 'asset-list');
    const sourceSession: SessionConfig | undefined =
      (activeTab && currentSessions.find(s => s.id === activeTab.sessionId)) ||
      (terminalTabs[0] && currentSessions.find(s => s.id === terminalTabs[0].sessionId)) ||
      currentSessions[0];

    // If source session has no open tab yet, open one first
    if (count > 1 && sourceSession && !terminalTabs.some(t => t.sessionId === sourceSession.id)) {
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

    // Auto-create cloned sessions to fill remaining panes
    const needed = count > 1 ? count - terminalTabs.length : 0;
    for (let i = 0; i < needed; i++) {
      const sessionId = crypto.randomUUID();
      const tabId = crypto.randomUUID();
      const num = terminalTabs.length + i + 1;

      if (sourceSession) {
        // Clone the source session with a new ID and incremented name
        const cloned: SessionConfig = {
          ...sourceSession,
          id: sessionId,
          name: `${sourceSession.name} ${num}`,
          created_at: new Date().toISOString().slice(0, 10),
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
        // Fallback: create a blank local shell
        const session: SessionConfig = {
          id: sessionId,
          name: `Terminal ${num}`,
          session_type: 'localshell',
          auth_method: 'password',
          created_at: new Date().toISOString().slice(0, 10),
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
    }
    return result;
  }),
  splitPanes: [null],
  setSplitPanes: (panes) => set({ splitPanes: panes }),
  assignPane: (slotIndex, tabId) => set((state) => {
    const panes = [...state.splitPanes];
    if (slotIndex >= 0 && slotIndex < panes.length) {
      panes[slotIndex] = tabId;
    }
    return { splitPanes: panes };
  }),
  focusedPane: 0,
  setFocusedPane: (index) => set({ focusedPane: index }),

  splitDirection: null,
  setSplitDirection: (dir) => set({ splitDirection: dir }),
}));
