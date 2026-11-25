import { create } from 'zustand';

/**
 * Ping latency per saved-session id, kept out of `appStore.sessions` on
 * purpose: every TerminalView subscribes to `sessions`, so writing latency
 * into that array re-rendered every open terminal on each ping round.
 * `null` = probe failed / timed out; absent = not probed yet.
 */
interface LatencyState {
  latency: Record<string, number | null>;
  setMany: (updates: Map<string, number | null>) => void;
}

export const useLatencyStore = create<LatencyState>((set) => ({
  latency: {},
  setMany: (updates) =>
    set((state) => {
      let changed = false;
      const next = { ...state.latency };
      updates.forEach((val, id) => {
        if (next[id] !== val) {
          next[id] = val;
          changed = true;
        }
      });
      return changed ? { latency: next } : state;
    }),
}));
