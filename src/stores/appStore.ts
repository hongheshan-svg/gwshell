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
  addSession: (session) =>
    set((state) => ({ sessions: [...state.sessions, session] })),
  removeSession: (id) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
      selectedSessionIds: state.selectedSessionIds.filter((sid) => sid !== id),
    })),
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
    const terminalTabs = state.tabs.filter(t => t.type !== 'asset-list');
    const panes: (string | null)[] = [];
    for (let i = 0; i < count; i++) {
      // Keep existing assignment if valid, otherwise auto-fill from terminal tabs
      const existing = state.splitPanes[i];
      if (existing && terminalTabs.some(t => t.id === existing)) {
        panes.push(existing);
      } else {
        // Auto-assign an unassigned terminal tab
        const used = new Set(panes.filter(Boolean));
        const available = terminalTabs.find(t => !used.has(t.id));
        panes.push(available ? available.id : null);
      }
    }
    // If switching to split mode, also switch to terminal view
    const firstPane = panes.find(p => p !== null);
    const extra: Partial<{ activeTabId: string | null; mainView: MainView }> = {};
    if (count > 1 && firstPane) {
      extra.activeTabId = firstPane;
      extra.mainView = 'terminal';
    }
    return { splitCount: count, splitPanes: panes, ...extra };
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
