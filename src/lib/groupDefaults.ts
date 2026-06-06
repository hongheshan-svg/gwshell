import type { SessionConfig } from '../types';

// Curated, non-secret fields a group can supply as defaults.
export const INHERITABLE_FIELDS = [
  'username', 'port', 'auth_method', 'private_key_path',
  'jump_host', 'jump_port', 'jump_username', 'jump_private_key_path',
  'proxy_type', 'proxy_host', 'proxy_port', 'proxy_username', 'env_vars',
] as const;

export type GroupDefaults = Partial<Pick<SessionConfig, typeof INHERITABLE_FIELDS[number]>>;
export type GroupDefaultsMap = Record<string, GroupDefaults>;

const KEY = 'gwshell.groupDefaults';

export function loadGroupDefaults(): GroupDefaultsMap {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as GroupDefaultsMap) : {};
  } catch { return {}; }
}

export function saveGroupDefaults(map: GroupDefaultsMap): void {
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

function isUnset(v: unknown): boolean {
  return v === undefined || v === null || v === '';
}

// Returns a session with inheritable fields filled from its group's defaults
// where the session's own value is unset. Pure; returns a new object.
export function applyGroupDefaults(session: SessionConfig, all: GroupDefaultsMap): SessionConfig {
  if (!session.group) return session;
  const defs = all[session.group];
  if (!defs) return session;
  const out: SessionConfig = { ...session };
  for (const f of INHERITABLE_FIELDS) {
    if (isUnset(out[f]) && !isUnset(defs[f])) {
      (out as unknown as Record<string, unknown>)[f] = defs[f];
    }
  }
  return out;
}
