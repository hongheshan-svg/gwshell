import type { TabInfo, SessionConfig } from '../types';

export interface PersistedTab {
  sessionId: string;
  type: TabInfo['type'];
  title: string;
}

export interface StoredTabs {
  tabs: PersistedTab[];
  activeTabIndex: number;
}

const KEY = 'gwshell.openTabs';

// Only tab types that TerminalView.setupConnection auto-reconnects on mount.
// docker/sftp/asset-list are excluded (no reconnect branch → would restore dead).
const RESTORABLE_TYPES = new Set<TabInfo['type']>(['ssh', 'localshell', 'serial']);

// Returns the restorable subset of tabs: only reconnectable types, tabs whose
// session still exists, and non-_temporary (Quick Connect) sessions.
function restorableTabs(tabs: TabInfo[], sessions: SessionConfig[]): TabInfo[] {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  return tabs.filter((t) => {
    if (!RESTORABLE_TYPES.has(t.type)) return false;
    const s = byId.get(t.sessionId);
    return !!s && !s._temporary;
  });
}

// Serializes the restorable open tabs to localStorage. Never stores `connected`
// or tab ids (regenerated on restore).
export function saveOpenTabs(tabs: TabInfo[], sessions: SessionConfig[], activeTabId: string | null): void {
  const restorable = restorableTabs(tabs, sessions);
  const persisted: PersistedTab[] = restorable.map((t) => ({ sessionId: t.sessionId, type: t.type, title: t.title }));
  const foundIdx = restorable.findIndex((t) => t.id === activeTabId);
  const activeTabIndex = foundIdx >= 0 ? foundIdx : 0;
  try {
    localStorage.setItem(KEY, JSON.stringify({ tabs: persisted, activeTabIndex } as StoredTabs));
  } catch {
    // quota exceeded / storage disabled — ignore
  }
}

export function loadOpenTabs(): StoredTabs | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredTabs;
    if (!parsed || !Array.isArray(parsed.tabs)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// A stable signature of the restorable tab set + active tab — used to debounce
// persistence so that `connected`-only changes don't trigger a rewrite.
export function tabsSignature(tabs: TabInfo[], sessions: SessionConfig[], activeTabId: string | null): string {
  const restorable = restorableTabs(tabs, sessions);
  return restorable.map((t) => `${t.sessionId}|${t.type}|${t.title}`).join('\n') + `#${activeTabId ?? ''}`;
}
