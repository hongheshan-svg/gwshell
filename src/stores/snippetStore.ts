import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Snippet } from '../types';

interface SnippetStore {
  snippets: Snippet[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (s: Omit<Snippet, 'id' | 'createdAt'>) => Promise<void>;
  update: (s: Snippet) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useSnippetStore = create<SnippetStore>((set, get) => ({
  snippets: [],
  loaded: false,

  load: async () => {
    try {
      const rows = await invoke<string[]>('get_snippets');
      const snippets = rows
        .map((r) => {
          try {
            return JSON.parse(r) as Snippet;
          } catch {
            return null;
          }
        })
        .filter((s): s is Snippet => s !== null)
        .sort((a, b) => a.createdAt - b.createdAt);
      set({ snippets, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  add: async (input) => {
    const snippet: Snippet = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      ...input,
    };
    // Functional update avoids the read-then-write race where two concurrent
    // ops both read the same `get().snippets` snapshot and the second
    // overwrites the first.
    set((state) => ({ snippets: [...state.snippets, snippet] }));
    try {
      await invoke('save_snippet', { id: snippet.id, data: JSON.stringify(snippet) });
    } catch (err) {
      // Roll back the optimistic add so the UI matches the backend.
      set((state) => ({ snippets: state.snippets.filter((s) => s.id !== snippet.id) }));
      console.error('Failed to save snippet, rolled back:', err);
    }
  },

  update: async (snippet) => {
    const prev = get().snippets;
    set((state) => ({ snippets: state.snippets.map((s) => (s.id === snippet.id ? snippet : s)) }));
    try {
      await invoke('save_snippet', { id: snippet.id, data: JSON.stringify(snippet) });
    } catch (err) {
      // Roll back to the pre-update list.
      set({ snippets: prev });
      console.error('Failed to update snippet, rolled back:', err);
    }
  },

  remove: async (id) => {
    const prev = get().snippets;
    set((state) => ({ snippets: state.snippets.filter((s) => s.id !== id) }));
    try {
      await invoke('delete_snippet', { id });
    } catch (err) {
      // Roll back the removed snippet so it reappears.
      set({ snippets: prev });
      console.error('Failed to delete snippet, rolled back:', err);
    }
  },
}));
