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
    set({ snippets: [...get().snippets, snippet] });
    await invoke('save_snippet', { id: snippet.id, data: JSON.stringify(snippet) }).catch(() => {});
  },

  update: async (snippet) => {
    set({ snippets: get().snippets.map((s) => (s.id === snippet.id ? snippet : s)) });
    await invoke('save_snippet', { id: snippet.id, data: JSON.stringify(snippet) }).catch(() => {});
  },

  remove: async (id) => {
    set({ snippets: get().snippets.filter((s) => s.id !== id) });
    await invoke('delete_snippet', { id }).catch(() => {});
  },
}));
