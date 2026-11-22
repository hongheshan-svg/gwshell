import { create } from 'zustand';
import type { AiAssistantMode } from '../types/agent';

export interface AiToolExecutionView {
  command: string;
  ok: boolean;
  output: string;
  error?: string | null;
}

export interface AiChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  thinking?: string;
  requestedModel?: string;
  responseModel?: string;
  streaming?: boolean;
  error?: string;
  toolResult?: AiToolExecutionView;
  createdAt: number;
}

export interface AiTabThread {
  messages: AiChatMessage[];
  draft: string;
}

export const EMPTY_THREAD: AiTabThread = {
  messages: [],
  draft: '',
};

interface AiChatStore {
  mode: AiAssistantMode;
  includeContext: boolean;
  threadsByKey: Record<string, AiTabThread>;
  streamingKey: string | null;
  activeRequestId: string | null;
  streamingPhase: string;
  setMode: (mode: AiAssistantMode) => void;
  setIncludeContext: (include: boolean) => void;
  setDraft: (key: string, draft: string) => void;
  appendMessage: (key: string, message: AiChatMessage) => void;
  updateMessage: (
    key: string,
    messageId: string,
    updater: (msg: AiChatMessage) => AiChatMessage,
  ) => void;
  clearThread: (key: string) => void;
  setStreaming: (key: string | null, requestId: string | null, phase?: string) => void;
  setStreamingPhase: (phase: string) => void;
  pruneThreads: (validKeys: Set<string>) => void;
}

export const useAiChatStore = create<AiChatStore>((set) => ({
  mode: 'chat',
  includeContext: true,
  threadsByKey: {},
  streamingKey: null,
  activeRequestId: null,
  streamingPhase: '',

  setMode: (mode) => set({ mode }),
  setIncludeContext: (includeContext) => set({ includeContext }),

  setDraft: (key, draft) =>
    set((state) => {
      const current = state.threadsByKey[key] ?? EMPTY_THREAD;
      if (current.draft === draft) return state;
      return {
        threadsByKey: {
          ...state.threadsByKey,
          [key]: { ...current, draft },
        },
      };
    }),

  appendMessage: (key, message) =>
    set((state) => {
      const current = state.threadsByKey[key] ?? EMPTY_THREAD;
      return {
        threadsByKey: {
          ...state.threadsByKey,
          [key]: { ...current, messages: [...current.messages, message] },
        },
      };
    }),

  updateMessage: (key, messageId, updater) =>
    set((state) => {
      const current = state.threadsByKey[key];
      if (!current) return state;
      const idx = current.messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return state;
      const nextMessages = [...current.messages];
      nextMessages[idx] = updater(nextMessages[idx]);
      return {
        threadsByKey: {
          ...state.threadsByKey,
          [key]: { ...current, messages: nextMessages },
        },
      };
    }),

  clearThread: (key) =>
    set((state) => ({
      threadsByKey: {
        ...state.threadsByKey,
        [key]: { messages: [], draft: '' },
      },
    })),

  setStreaming: (streamingKey, activeRequestId, phase = '') =>
    set({ streamingKey, activeRequestId, streamingPhase: phase }),

  setStreamingPhase: (streamingPhase) => set({ streamingPhase }),

  pruneThreads: (validKeys) =>
    set((state) => {
      let changed = false;
      const next: Record<string, AiTabThread> = {};
      for (const [k, v] of Object.entries(state.threadsByKey)) {
        if (k === 'global' || validKeys.has(k)) {
          next[k] = v;
        } else {
          changed = true;
        }
      }
      return changed ? { threadsByKey: next } : state;
    }),
}));
