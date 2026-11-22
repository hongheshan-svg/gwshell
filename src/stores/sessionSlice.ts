import { invoke } from '@tauri-apps/api/core';
import type { StateCreator } from 'zustand';
import type { SessionConfig } from '../types';
import i18n from '../i18n';
import { useToastStore } from './toastStore';

export interface SessionSlice {
  sessions: SessionConfig[];
  setSessions: (sessions: SessionConfig[]) => void;
  addSession: (session: SessionConfig) => void;
  addTemporarySession: (session: SessionConfig) => void;
  removeSession: (id: string) => void;
  updateSessionLatency: (id: string, latency: number | null) => void;
  batchUpdateLatency: (updates: Map<string, number | null>) => void;
  selectedSessionIds: string[];
  setSelectedSessionIds: (ids: string[]) => void;
  toggleSelectSession: (id: string) => void;
}

// Read sessions injected by Tauri's initialization_script before React loads.
// This eliminates the IPC round-trip that causes the empty-then-populated flash.
function popInjectedSessions(): SessionConfig[] {
  if (typeof window === 'undefined') return [];
  const win = window as unknown as Record<string, unknown>; // eslint-disable-line no-restricted-syntax -- window prop access needs index signature; no narrower type available
  const data = win.__GWSHELL_SESSIONS__;
  if (Array.isArray(data)) {
    delete win.__GWSHELL_SESSIONS__;
    const valid = data.filter((e): e is SessionConfig => {
      if (!e || typeof e !== 'object') return false;
      const o = e as Record<string, unknown>; // eslint-disable-line no-restricted-syntax -- narrowed unknown object access needs index signature
      return typeof o.id === 'string' && typeof o.session_type === 'string';
    });
    if (valid.length !== data.length) {
      console.warn(
        `popInjectedSessions: dropped ${data.length - valid.length} malformed entr(ies)`,
      );
    }
    return valid;
  }
  return [];
}

const initialSessions = popInjectedSessions();

export function redactSessionSecrets(session: SessionConfig): SessionConfig {
  const {
    password: _password,
    totp_code: _totpCode,
    jump_password: _jumpPassword,
    proxy_password: _proxyPassword,
    ...safeSession
  } = session;
  return safeSession;
}

export const createSessionSlice: StateCreator<SessionSlice, [], [], SessionSlice> = (set, get) => ({
  sessions: initialSessions,
  setSessions: (sessions) => set({ sessions: sessions.map(redactSessionSecrets) }),
  addSession: (session) => {
    set((state) => {
      const safeSession = redactSessionSecrets(session);
      const exists = state.sessions.some((s) => s.id === safeSession.id);
      const sessions = exists
        ? state.sessions.map((s) => (s.id === safeSession.id ? safeSession : s))
        : [...state.sessions, safeSession];
      return { sessions };
    });
    invoke('save_session', { config: session }).catch((err) => {
      console.error('Failed to save session, the UI may be out of sync:', err);
      useToastStore.getState().pushToast({
        kind: 'error',
        title: i18n.t('toast.sessionSaveFailed'),
        message: String(err),
      });
    });
  },
  addTemporarySession: (session) =>
    set((state) => ({ sessions: [...state.sessions, redactSessionSecrets(session)] })),
  removeSession: (id) => {
    const removed = get().sessions.find((s) => s.id === id);
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
      selectedSessionIds: state.selectedSessionIds.filter((sid) => sid !== id),
    }));
    invoke('delete_session', { sessionId: id }).catch((err) => {
      if (removed) {
        set((state) => ({ sessions: [...state.sessions, removed] }));
      }
      console.error('Failed to delete session, rolled back:', err);
      useToastStore.getState().pushToast({
        kind: 'error',
        title: i18n.t('toast.sessionDeleteFailed'),
        message: String(err),
      });
    });
  },
  updateSessionLatency: (id, latency) => {
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, latency } : s)),
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
});
