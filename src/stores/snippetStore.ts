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
    // Capture the pre-update object (not the whole list) so a rollback restores
    // just this snippet without clobbering concurrent updates to others.
    const oldSnippet = get().snippets.find((s) => s.id === snippet.id);
    set((state) => ({ snippets: state.snippets.map((s) => (s.id === snippet.id ? snippet : s)) }));
    try {
      await invoke('save_snippet', { id: snippet.id, data: JSON.stringify(snippet) });
    } catch (err) {
      if (oldSnippet) {
        set((state) => ({ snippets: state.snippets.map((s) => (s.id === snippet.id ? oldSnippet : s)) }));
      }
      console.error('Failed to update snippet, rolled back:', err);
    }
  },

  remove: async (id) => {
    // Capture the removed object so a rollback re-inserts just it, preserving
    // any concurrent add/update of other snippets.
    const removed = get().snippets.find((s) => s.id === id);
    set((state) => ({ snippets: state.snippets.filter((s) => s.id !== id) }));
    try {
      await invoke('delete_snippet', { id });
    } catch (err) {
      if (removed) {
        set((state) => ({ snippets: [...state.snippets, removed] }));
      }
      console.error('Failed to delete snippet, rolled back:', err);
    }
  },
}));
