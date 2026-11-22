import { create } from 'zustand';

export interface TabDockDraft {
  input: string;
  answer: string;
  error: string;
  notice: string;
}

export const EMPTY_DOCK_DRAFT: TabDockDraft = { input: '', answer: '', error: '', notice: '' };

interface TerminalAiStore {
  open: boolean;
  setOpen: (open: boolean) => void;
  draftsByTab: Record<string, TabDockDraft>;
  updateDraft: (tabId: string, updater: (prev: TabDockDraft) => TabDockDraft) => void;
  pruneDrafts: (liveTabIds: ReadonlySet<string>) => void;
}

export const useTerminalAiStore = create<TerminalAiStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  draftsByTab: {},
  updateDraft: (tabId, updater) => {
    if (!tabId) return;
    set((state) => ({
      draftsByTab: {
        ...state.draftsByTab,
        [tabId]: updater(state.draftsByTab[tabId] ?? EMPTY_DOCK_DRAFT),
      },
    }));
  },
  pruneDrafts: (liveTabIds) =>
    set((state) => {
      let changed = false;
      const next: Record<string, TabDockDraft> = {};
      for (const [id, draft] of Object.entries(state.draftsByTab)) {
        if (liveTabIds.has(id)) {
          next[id] = draft;
        } else {
          changed = true;
        }
      }
      return changed ? { draftsByTab: next } : state;
    }),
}));
