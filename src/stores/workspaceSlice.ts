import type { StateCreator } from 'zustand';
import type { MainView, TabInfo } from '../types';
import i18n, { type Locale } from '../i18n';
import { buildSplitPanes, clearSlot, fillFirstEmpty } from '../lib/splitLayout';
import { clearTempPassword } from '../lib/tempSecrets';
import type { SessionSlice } from './sessionSlice';

export interface WorkspaceSlice {
  mainView: MainView;
  setMainView: (view: MainView) => void;

  tabs: TabInfo[];
  activeTabId: string | null;
  addTab: (tab: TabInfo) => void;
  removeTab: (id: string) => void;
  reorderTabs: (fromId: string, toId: string) => void;
  setActiveTab: (id: string) => void;
  updateTabConnected: (id: string, connected: boolean) => void;

  splitCount: 1 | 2 | 4 | 6 | 8;
  splitPanes: (string | null)[];
  setSplitCount: (n: 1 | 2 | 4 | 6 | 8) => void;

  broadcastInput: boolean;
  toggleBroadcastInput: () => void;
}

export function createWorkspaceSlice(
  initialLocale: Locale,
): StateCreator<WorkspaceSlice & SessionSlice, [], [], WorkspaceSlice> {
  return (set) => ({
    mainView: 'asset-list',
    setMainView: (view) => set({ mainView: view }),

    tabs: [
      {
        id: 'asset-list',
        sessionId: '',
        title: i18n.getFixedT(initialLocale, 'gwshell')('tab_list'),
        type: 'asset-list',
        connected: false,
      },
    ],
    activeTabId: 'asset-list',
    addTab: (tab) =>
      set((state) => ({
        tabs: [...state.tabs, tab],
        activeTabId: tab.id,
        mainView: tab.type === 'asset-list' ? 'asset-list' : 'terminal',
        splitPanes:
          state.splitCount > 1 ? fillFirstEmpty(state.splitPanes, tab.id) : state.splitPanes,
      })),
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
        const newSplitPanes = clearSlot(state.splitPanes, id);

        let newSessions = state.sessions;
        if (closedTab) {
          const session = state.sessions.find((s) => s.id === closedTab.sessionId);
          if (session?._temporary) {
            const otherTabUsing = newTabs.some((t) => t.sessionId === closedTab.sessionId);
            if (!otherTabUsing) {
              clearTempPassword(closedTab.sessionId);
              newSessions = state.sessions.filter((s) => s.id !== closedTab.sessionId);
            }
          }
        }

        if (terminalTabs.length === 0) {
          return {
            tabs: newTabs,
            sessions: newSessions,
            activeTabId: 'asset-list',
            mainView: 'asset-list' as MainView, // eslint-disable-line no-restricted-syntax -- literal narrowing for MainView union
            splitCount: 1,
            splitPanes: [],
          };
        }

        let newActiveId = state.activeTabId;
        if (state.activeTabId === id) {
          const previousTerminalTabs = state.tabs.filter((t) => t.type !== 'asset-list');
          const idx = previousTerminalTabs.findIndex((t) => t.id === id);
          const leftNeighbor = idx > 0 ? previousTerminalTabs[idx - 1] : undefined;
          const rightNeighbor = idx >= 0 ? previousTerminalTabs[idx + 1] : undefined;
          const neighbor = leftNeighbor ?? rightNeighbor;
          newActiveId = neighbor ? neighbor.id : 'asset-list';
        }
        const newMainView = newActiveId === 'asset-list' ? 'asset-list' : 'terminal';

        const collapsedCount = terminalTabs.length <= 1 ? 1 : state.splitCount;
        const collapsedPanes = collapsedCount === 1 ? [] : newSplitPanes;
        return {
          tabs: newTabs,
          sessions: newSessions,
          activeTabId: newActiveId,
          mainView: newMainView,
          splitCount: collapsedCount,
          splitPanes: collapsedPanes,
        };
      }),
    setActiveTab: (id) =>
      set({ activeTabId: id, mainView: id === 'asset-list' ? 'asset-list' : 'terminal' }),
    updateTabConnected: (id, connected) =>
      set((state) => ({
        tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, connected } : tab)),
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
  });
}
