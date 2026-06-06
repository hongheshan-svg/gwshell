# Tabby-Merge Phase 3b-1: Session/Tab Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the open terminal tabs and restore + auto-reconnect them on next launch, gated by the existing (currently dead) `sessionTabMemory` setting.

**Architecture:** All frontend. A new `lib/tabSession.ts` serializes restorable tabs to `localStorage`. `App.tsx` gains a debounced persist effect (keyed on a derived tab signature so `connected` toggles don't rewrite) and a run-once restore effect that re-adds tabs after settings + sessions are ready; existing `TerminalView.setupConnection` auto-reconnects each restored tab. No Rust/IPC changes.

**Tech Stack:** React, TypeScript, Zustand, localStorage.

---

## Verification approach (read first)

Per `CLAUDE.md`: **no automated test framework.** Verify with `npx tsc --noEmit` (type gate; `npm run build` if the environment allows), `npm run smoke:check` when runnable, plus the manual checks. **No Rust — do not run `cargo`.** Commit after every task.

---

## File structure

- Create `src/lib/tabSession.ts` — `PersistedTab`, `saveOpenTabs`, `loadOpenTabs` (localStorage).
- Modify `src/App.tsx` — `sessionTabMemory` selector; debounced persist effect; run-once restore effect.

---

## Task 1: `tabSession.ts` (localStorage serialize/load)

**Files:**
- Create: `src/lib/tabSession.ts`

- [ ] **Step 1: Create the file with EXACTLY:**

```ts
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

// Returns the restorable subset of tabs: excludes the asset-list tab, tabs whose
// session no longer exists, and _temporary (Quick Connect) sessions.
function restorableTabs(tabs: TabInfo[], sessions: SessionConfig[]): TabInfo[] {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  return tabs.filter((t) => {
    if (t.type === 'asset-list') return false;
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
```

- [ ] **Step 2: Verify type-check**

Run: `npx tsc --noEmit`
Expected: zero errors. (`TabInfo`/`SessionConfig` are exported from `src/types/index.ts`; `_temporary` is an optional field on `SessionConfig`.)

- [ ] **Step 3: Reason through (no test framework)**

Confirm by reading: `saveOpenTabs` with one asset-list tab + one ssh tab whose session exists → stores `[{sessionId, type:'ssh', title}]`, `activeTabIndex` = index within restorable (0 if active is the ssh tab, 0 if active is asset-list since asset-list is filtered out). A tab whose session is `_temporary` or missing is excluded. `loadOpenTabs` returns null on absent/corrupt data.

- [ ] **Step 4: Commit**

```bash
git add src/lib/tabSession.ts
git commit -m "feat(restore): localStorage serialize/load for open tabs"
```

---

## Task 2: Debounced persist effect in App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add imports + the `sessionTabMemory` selector**

In `src/App.tsx`:
- Add to the React import so `useMemo` and `useRef` are available (the file already imports `Suspense, lazy, useEffect` from 'react' — extend it):
```tsx
import { Suspense, lazy, useEffect, useMemo, useRef } from 'react';
```
- Add the lib import near the other `./lib/*` imports (e.g. by `import * as commandHistory from './lib/commandHistory';`):
```tsx
import { saveOpenTabs, loadOpenTabs, tabsSignature } from './lib/tabSession';
```
- Add a settings selector near the other `useSettingsStore((s) => ...)` lines (by `settingsLoaded`):
```tsx
  const sessionTabMemory = useSettingsStore((s) => s.settings.sessionTabMemory);
```

- [ ] **Step 2: Add the debounced persist effect**

In `App()`, after the existing sessions-fallback effect (the `useEffect(() => { if (sessions.length === 0) { invoke<SessionConfig[]>('get_sessions')... } }, [])` block), add:

```tsx
  // Persist the open-tab set (debounced) when "remember tabs" is on. Keyed on a
  // derived signature so connect/disconnect (`connected`) changes don't rewrite.
  const tabSig = useMemo(
    () => tabsSignature(tabs, sessions, activeTabId),
    [tabs, sessions, activeTabId],
  );
  useEffect(() => {
    if (!settingsLoaded || !sessionTabMemory) return;
    const timer = setTimeout(() => {
      saveOpenTabs(tabs, sessions, activeTabId);
    }, 500);
    return () => clearTimeout(timer);
    // tabs/sessions/activeTabId intentionally omitted: tabSig captures the
    // restorable signature; the timer reads the latest values when it fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabSig, settingsLoaded, sessionTabMemory]);
```

- [ ] **Step 3: Verify type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(restore): persist open tabs (debounced) when sessionTabMemory is on"
```

---

## Task 3: Run-once restore effect in App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the restore effect**

In `App()`, after the persist effect from Task 2, add:

```tsx
  // Restore tabs once, after settings load AND sessions hydrate. Auto-reconnect
  // happens via each restored TerminalView's setupConnection on mount.
  const restoredRef = useRef(false);
  const { addTab, setActiveTab } = useAppStore();
  useEffect(() => {
    if (restoredRef.current || !settingsLoaded) return;
    if (!sessionTabMemory) { restoredRef.current = true; return; }
    // Wait for sessions to hydrate (sync injection or async get_sessions fallback).
    if (sessions.length === 0) return;
    restoredRef.current = true;

    const stored = loadOpenTabs();
    if (!stored) return;
    const byId = new Map(sessions.map((s) => [s.id, s]));
    const newIds: string[] = [];
    for (const pt of stored.tabs) {
      const s = byId.get(pt.sessionId);
      if (!s || s._temporary) continue; // session deleted or temporary — skip
      const id = crypto.randomUUID();
      addTab({ id, sessionId: pt.sessionId, title: pt.title, type: pt.type, connected: false });
      newIds.push(id);
    }
    if (newIds.length > 0) {
      const idx = Math.min(Math.max(0, stored.activeTabIndex), newIds.length - 1);
      setActiveTab(newIds[idx]);
    }
  }, [settingsLoaded, sessionTabMemory, sessions, addTab, setActiveTab]);
```

> Note on `addTab`/`setActiveTab`: getting them via `const { addTab, setActiveTab } = useAppStore();` returns stable store-action references (Zustand actions don't change identity), so listing them in deps does not cause re-runs. If `addTab`/`setActiveTab` are ALREADY destructured from `useAppStore()` higher in `App()`, do NOT redeclare them — remove this local destructure and just reference the existing ones (and keep them in the dep array). Confirm by reading the existing destructure at the top of `App()`.

- [ ] **Step 2: Verify type-check**

Run: `npx tsc --noEmit`
Expected: zero errors. (`addTab` expects `TabInfo`: `{ id, sessionId, title, type, connected }` — all provided.)

- [ ] **Step 3: Manual check**

`npm run tauri dev` (if runnable):
1. Settings → enable "记住会话标签" (`sessionTabMemory`). Open 2 saved-session tabs + 1 local shell. Restart the app → the 3 tabs reappear and auto-connect; the previously-active tab is focused.
2. Open a Quick Connect (temporary) tab; restart → it does NOT reappear.
3. Delete a session whose tab was open; restart → that tab is skipped.
4. Disable the setting; restart → only the asset-list tab (no restore).

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(restore): restore open tabs on launch + auto-reconnect"
```

---

## Task 4: Final verification

- [ ] **Step 1: Build + smoke (retry if env-blocked; fall back to `npx tsc --noEmit`)**

```bash
npm run build
npm run smoke:check
```
Report PASS/FAIL/BLOCKED per gate.

- [ ] **Step 2: Manual checklist (spec §5)**

`npm run tauri dev`:
1. Enable `sessionTabMemory`; open saved-session + local-shell tabs; restart → restored + auto-connect; active tab preserved.
2. Temporary (Quick Connect) tab → not restored.
3. Deleted-session tab → skipped.
4. Setting off → no restore.
5. Regression: opening/closing tabs, switching, Quick Connect, broadcast, palette, autocomplete all unaffected; first-screen asset-list behavior normal.

- [ ] **Step 3: Final commit (if any cleanup)**

```bash
git add -A
git commit -m "chore(phase3b1): final verification pass"
```

---

## Self-review notes (author)

- **Spec coverage:** §2A(serialize/load)↔Task 1; §2B(debounced persist + derived signature)↔Task 2; §2C(run-once restore + auto-reconnect)↔Task 3; §2D(gate on sessionTabMemory)↔Tasks 2+3 read the setting; §2E边界(skip _temporary/deleted/asset-list, no `connected`, regen id)↔Task 1 filter + Task 3 validation. §6 files: `lib/tabSession.ts` + `App.tsx`. No Rust (matches spec).
- **Placeholder scan:** none.
- **Type consistency:** `PersistedTab`/`StoredTabs`/`saveOpenTabs`/`loadOpenTabs`/`tabsSignature` defined T1, used T2/T3; `addTab({id,sessionId,title,type,connected})` matches `TabInfo`; `sessions` filtered by `_temporary` consistently (T1 + T3); `sessionTabMemory` read in T2/T3.
- **Restore timing:** restore waits for `sessions.length > 0` so the async `get_sessions` fallback is covered; run-once ref prevents double restore; persist is debounced and signature-gated so it won't fight the restore (restoring adds tabs → signature changes → a single debounced save, idempotent).
