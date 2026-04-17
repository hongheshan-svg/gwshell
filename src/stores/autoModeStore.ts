import { create } from 'zustand';
import type { AutoModeLogEntry } from '../types';

const LOG_CAP_PER_TAB = 500;

interface AutoModeStore {
  /** Per-tab enabled flag. Undefined = never touched. */
  enabled: Record<string, boolean>;
  /** Per-tab cumulative auto-confirmation count in this session. */
  counters: Record<string, number>;
  /** Per-tab log ring buffer (bounded). */
  logs: Record<string, AutoModeLogEntry[]>;
  /** Log panel visibility. */
  logPanelOpen: boolean;
  /** Which tab's log the panel is currently showing. */
  logPanelTabId: string | null;
  /** Monotonic counter used to trigger the status-bar flash animation. */
  flashTick: Record<string, number>;

  setEnabled: (tabId: string, value: boolean) => void;
  toggle: (tabId: string) => void;
  incrementCounter: (tabId: string) => void;
  pushLog: (tabId: string, entry: Omit<AutoModeLogEntry, 'id'>) => void;
  clearLog: (tabId: string) => void;
  cleanup: (tabId: string) => void;
  openLogPanel: (tabId: string) => void;
  closeLogPanel: () => void;
  toggleLogPanel: (tabId: string) => void;
}

const makeId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const useAutoModeStore = create<AutoModeStore>((set) => ({
  enabled: {},
  counters: {},
  logs: {},
  logPanelOpen: false,
  logPanelTabId: null,
  flashTick: {},

  setEnabled: (tabId, value) =>
    set((state) => ({ enabled: { ...state.enabled, [tabId]: value } })),

  toggle: (tabId) =>
    set((state) => ({ enabled: { ...state.enabled, [tabId]: !state.enabled[tabId] } })),

  incrementCounter: (tabId) =>
    set((state) => ({
      counters: { ...state.counters, [tabId]: (state.counters[tabId] ?? 0) + 1 },
      flashTick: { ...state.flashTick, [tabId]: (state.flashTick[tabId] ?? 0) + 1 },
    })),

  pushLog: (tabId, entry) =>
    set((state) => {
      const existing = state.logs[tabId] ?? [];
      const next = [...existing, { ...entry, id: makeId() }];
      if (next.length > LOG_CAP_PER_TAB) next.splice(0, next.length - LOG_CAP_PER_TAB);
      return { logs: { ...state.logs, [tabId]: next } };
    }),

  clearLog: (tabId) =>
    set((state) => ({ logs: { ...state.logs, [tabId]: [] } })),

  cleanup: (tabId) =>
    set((state) => {
      const enabled = { ...state.enabled };
      const counters = { ...state.counters };
      const logs = { ...state.logs };
      const flashTick = { ...state.flashTick };
      delete enabled[tabId];
      delete counters[tabId];
      delete logs[tabId];
      delete flashTick[tabId];
      return {
        enabled,
        counters,
        logs,
        flashTick,
        logPanelOpen: state.logPanelTabId === tabId ? false : state.logPanelOpen,
        logPanelTabId: state.logPanelTabId === tabId ? null : state.logPanelTabId,
      };
    }),

  openLogPanel: (tabId) => set({ logPanelOpen: true, logPanelTabId: tabId }),
  closeLogPanel: () => set({ logPanelOpen: false }),
  toggleLogPanel: (tabId) =>
    set((state) =>
      state.logPanelOpen && state.logPanelTabId === tabId
        ? { logPanelOpen: false }
        : { logPanelOpen: true, logPanelTabId: tabId }
    ),
}));
