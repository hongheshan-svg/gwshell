# Multi-Pane Split (4/6/8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 2-pane `splitTabId` split with a `splitCount` (1/2/4/6/8) + `splitPanes` slot model that tiles open terminal tabs in a grid, with a tab-bar count selector.

**Architecture:** A pure `splitLayout` module (Node-tested) builds/maintains the slot array; `appStore` swaps `splitTabId` for `splitCount`+`splitPanes`; `TerminalContainer` renders an N-cell grid (filled slots → `TerminalView`, empty → placeholder, off-grid tabs mounted-hidden); `TabBar` gets a count-selector popover; CSS gains per-count grid templates.

**Tech Stack:** React + TypeScript, Zustand, xterm.js, lucide-react, i18next. Logic tested via Node `scripts/*.mjs` + `loadTs` (no test runner).

**Spec:** `docs/superpowers/specs/2026-06-09-multi-pane-split-design.md`
**Branch:** `feat/multi-split` (already created).

---

## Current code (verified)

- `appStore.ts`: `splitTabId: string | null` (interface lines 50-51, impl 253-254); `removeTab` (204-243) computes `newSplitTabId = state.splitTabId === id ? null : state.splitTabId` and returns it in both early-return and normal branches; it also removes `_temporary` sessions whose last tab closed.
- `TabBar.tsx`: destructures `splitTabId, setSplitTabId`; `handleToggleSplit` (49-57) toggles `splitTabId` (picks the most-recent OTHER terminal tab as partner); split button (119-129) shown when `terminalTabs.length >= 2`, `Columns2` icon, `tab-btn-active` when `splitTabId != null && splitTabId !== activeTabId`, `style={{marginLeft:'auto'}}`. The SFTP button (131-145) keys its `marginLeft:auto` off `terminalTabs.length >= 2` (i.e. whether the split button is present).
- `TerminalContainer.tsx`: full file known; `splitActive` guard (36-39); split render maps ALL `terminalTabs` to `<TerminalView>` inside `.terminal-container.terminal-split-grid`, `visible={tab.id===activeTabId || tab.id===splitTabId}`.
- `global.css`: `.terminal-container.terminal-split-grid` (588: `display:grid; grid-template-columns:1fr 1fr; gap:1px; background:var(--border-color)`); `.terminal-pane` (595, `flex:1; position:relative; contain:layout paint`); each `TerminalView` root IS `.terminal-pane`. `.terminal-pane.broadcasting` (3607).
- i18n key `split_toggle` exists.

---

## File Structure

- **Create** `src/lib/splitLayout.ts` — `buildSplitPanes`, `clearSlot`, `fillFirstEmpty` (pure).
- **Create** `scripts/test-split-layout.mjs` — Node unit tests.
- **Modify** `src/stores/appStore.ts` — state + `setSplitCount`; `removeTab` and `addTab` slot upkeep.
- **Modify** `src/components/Terminal/TerminalContainer.tsx` — N-cell grid render.
- **Modify** `src/components/TabBar/TabBar.tsx` — count-selector popover.
- **Modify** `src/styles/global.css` — per-count grid templates + active-pane + empty cell.
- **Modify** `CLAUDE.md` — split-pane section.

---

## Task 1: `splitLayout` pure logic + tests (TDD)

**Files:** Create `src/lib/splitLayout.ts`, `scripts/test-split-layout.mjs`.

- [ ] **Step 1: Write the test**

Create `scripts/test-split-layout.mjs` (reuse the `loadTs` pattern from `scripts/test-completion.mjs` — copy its `loadTs` helper verbatim):

```js
#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
const root = process.cwd();
const nodeRequire = createRequire(import.meta.url);
function loadTs(rel, requireMap = {}) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const m = { exports: {} };
  new Function('exports', 'require', 'module', js)(m.exports, (s) => (s in requireMap ? requireMap[s] : nodeRequire(s)), m);
  return m.exports;
}
const { buildSplitPanes, clearSlot, fillFirstEmpty } = loadTs('src/lib/splitLayout.ts');

// buildSplitPanes: active first, then order, padded with null to length n
assert.deepEqual(buildSplitPanes(['a','b','c'], 'b', 4), ['b','a','c', null], 'active first + pad');
assert.deepEqual(buildSplitPanes(['a','b','c'], 'a', 2), ['a','b'], 'truncate to n');
assert.deepEqual(buildSplitPanes(['a'], 'a', 4), ['a', null, null, null], 'fewer tabs than n');
assert.deepEqual(buildSplitPanes([], null, 2), [null, null], 'no tabs');
assert.deepEqual(buildSplitPanes(['a','b'], 'zzz', 2), ['a','b'], 'active not in tabs -> plain order');

// clearSlot: null out a tab's slot, keep others
assert.deepEqual(clearSlot(['a','b',null], 'a'), [null,'b',null], 'clears matching slot');
assert.deepEqual(clearSlot(['a','b'], 'x'), ['a','b'], 'no match -> unchanged');

// fillFirstEmpty: put id in first null slot, else unchanged
assert.deepEqual(fillFirstEmpty(['a',null,null], 'b'), ['a','b',null], 'fills first null');
assert.deepEqual(fillFirstEmpty(['a','b'], 'c'), ['a','b'], 'no empty -> unchanged');
assert.deepEqual(fillFirstEmpty(['a','b'], 'a'), ['a','b'], 'already present -> unchanged');

console.log('split layout tests passed');
```

- [ ] **Step 2: Run it; confirm FAIL**

Run: `node scripts/test-split-layout.mjs`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/lib/splitLayout.ts`**

```ts
/** Pure helpers for the multi-pane split slot array. A "pane slot" holds a tab
 *  id or null (empty). Slot count equals the split count (2/4/6/8). */

/** Build the slot array of length `n` from the current terminal tab ids:
 *  the active tab leads (so it is always visible), then the rest in order,
 *  truncated to `n` and padded with null. */
export function buildSplitPanes(
  tabIds: string[],
  activeId: string | null,
  n: number,
): (string | null)[] {
  const ordered =
    activeId && tabIds.includes(activeId)
      ? [activeId, ...tabIds.filter((id) => id !== activeId)]
      : [...tabIds];
  const panes: (string | null)[] = ordered.slice(0, n);
  while (panes.length < n) panes.push(null);
  return panes;
}

/** Null out any slot holding `tabId` (used when a tab closes). */
export function clearSlot(panes: (string | null)[], tabId: string): (string | null)[] {
  return panes.map((p) => (p === tabId ? null : p));
}

/** Put `tabId` into the first empty slot, unless it is already present or there
 *  is no empty slot. Used when a new terminal tab opens during a split. */
export function fillFirstEmpty(panes: (string | null)[], tabId: string): (string | null)[] {
  if (panes.includes(tabId)) return panes;
  const i = panes.indexOf(null);
  if (i === -1) return panes;
  const next = [...panes];
  next[i] = tabId;
  return next;
}
```

- [ ] **Step 4: Run; confirm PASS**

Run: `node scripts/test-split-layout.mjs`
Expected: `split layout tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/splitLayout.ts scripts/test-split-layout.mjs
git commit -m "feat(split): pane slot layout helpers with tests"
```

---

## Task 2: appStore migration to splitCount/splitPanes

**Files:** Modify `src/stores/appStore.ts`.

- [ ] **Step 1: Swap the state fields**

In the store interface, replace:
```ts
  splitTabId: string | null;
  setSplitTabId: (id: string | null) => void;
```
with:
```ts
  splitCount: 1 | 2 | 4 | 6 | 8;
  splitPanes: (string | null)[];
  setSplitCount: (n: 1 | 2 | 4 | 6 | 8) => void;
```

Add the import at the top of the file:
```ts
import { buildSplitPanes, clearSlot, fillFirstEmpty } from '../lib/splitLayout';
```

Replace the impl (lines 253-254):
```ts
  splitTabId: null,
  setSplitTabId: (id) => set({ splitTabId: id }),
```
with:
```ts
  splitCount: 1,
  splitPanes: [],
  setSplitCount: (n) =>
    set((state) => {
      if (n === 1) return { splitCount: 1, splitPanes: [] };
      const termIds = state.tabs.filter((t) => t.type !== 'asset-list').map((t) => t.id);
      return { splitCount: n, splitPanes: buildSplitPanes(termIds, state.activeTabId, n) };
    }),
```

- [ ] **Step 2: Update `removeTab` slot cleanup**

In `removeTab` (lines 204-243), replace the `newSplitTabId` line:
```ts
      const newSplitTabId = state.splitTabId === id ? null : state.splitTabId;
```
with:
```ts
      const newSplitPanes = clearSlot(state.splitPanes, id);
```
In the `terminalTabs.length === 0` early return, replace `splitTabId: newSplitTabId,` with:
```ts
          splitCount: 1,
          splitPanes: [],
```
In the final return, replace `splitTabId: newSplitTabId` with:
```ts
        splitPanes: newSplitPanes,
```
(`splitCount` is unchanged in the normal branch — a closed tab just empties its slot.)

- [ ] **Step 3: Fill a new tab into an empty slot (during split)**

Find the `addTab` reducer in `appStore.ts` (it adds a tab to `state.tabs`). In its returned state, when `state.splitCount > 1`, also update `splitPanes` to drop the new tab into the first empty slot:
```ts
      // (inside addTab's set((state) => { ... return {...} }))
      splitPanes: state.splitCount > 1 ? fillFirstEmpty(state.splitPanes, newTab.id) : state.splitPanes,
```
(Use the real new-tab variable name from `addTab` — read it; it may be `tab`/`newTab`/the `id` passed in. The key: the id just added to `tabs`. If `addTab` doesn't currently spread other fields into its return, add `splitPanes` to the returned object.)

- [ ] **Step 4: Verify**

Run: `npm run build` (tsc will flag any remaining `splitTabId` references — there should be none in appStore, but TabBar/TerminalContainer still reference it and are fixed in later tasks, so a FAILED build here is EXPECTED and should name only TabBar.tsx / TerminalContainer.tsx). Confirm appStore itself has no type errors (the errors must be confined to the two consumer files).

- [ ] **Step 5: Commit**

```bash
git add src/stores/appStore.ts
git commit -m "feat(split): appStore splitCount/splitPanes state and upkeep"
```

---

## Task 3: TerminalContainer multi-pane render

**Files:** Modify `src/components/Terminal/TerminalContainer.tsx`.

- [ ] **Step 1: Rewrite the component**

Read the current `TerminalView` root element first to confirm it renders with `className="terminal-pane"` (the CSS targets `.terminal-pane` and the current 2-pane maps `TerminalView`s straight into the grid). The new render keeps rendering `TerminalView` per filled slot, adds empty placeholders for null slots, and mounts off-grid tabs hidden. Replace the file body's split logic with:

```tsx
import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../stores/appStore';
import { TerminalView } from './TerminalView';
import { AssetTable } from '../AssetTable/AssetTable';

export const TerminalContainer: React.FC = () => {
  const { tabs, activeTabId, mainView, splitCount, splitPanes, setActiveTab } = useAppStore(
    useShallow((s) => ({
      tabs: s.tabs,
      activeTabId: s.activeTabId,
      mainView: s.mainView,
      splitCount: s.splitCount,
      splitPanes: s.splitPanes,
      setActiveTab: s.setActiveTab,
    })),
  );

  if (activeTabId === 'asset-list' || mainView === 'asset-list') {
    return <div className="terminal-container"><AssetTable /></div>;
  }

  const terminalTabs = tabs.filter((t) => t.type !== 'asset-list');
  if (terminalTabs.length === 0) {
    return <div className="terminal-container"><AssetTable /></div>;
  }

  const splitActive = splitCount > 1;

  if (splitActive) {
    const slotIds = new Set(splitPanes.filter((id): id is string => id != null));
    // Tabs not shown in any slot must stay MOUNTED (preserve xterm) but hidden.
    const offGrid = terminalTabs.filter((t) => !slotIds.has(t.id));
    return (
      <>
        <div className={`terminal-container terminal-split-grid split-${splitCount}`}>
          {splitPanes.map((id, slot) => {
            if (id == null) {
              return <div key={`empty-${slot}`} className="terminal-pane terminal-pane-empty" />;
            }
            const tab = terminalTabs.find((t) => t.id === id);
            if (!tab) {
              return <div key={`gone-${slot}`} className="terminal-pane terminal-pane-empty" />;
            }
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                className={`terminal-pane-cell${isActive ? ' is-active-pane' : ''}`}
                onMouseDown={() => { if (!isActive) setActiveTab(tab.id); }}
              >
                <TerminalView tab={tab} isActive={isActive} visible />
              </div>
            );
          })}
        </div>
        <div style={{ display: 'none' }}>
          {offGrid.map((tab) => (
            <TerminalView key={tab.id} tab={tab} isActive={false} visible={false} />
          ))}
        </div>
      </>
    );
  }

  return (
    <div className="terminal-container">
      {terminalTabs.map((tab) => (
        <TerminalView key={tab.id} tab={tab} isActive={tab.id === activeTabId} />
      ))}
    </div>
  );
};
```

Notes for the implementer:
- The current single-pane render passes no `visible` prop; keep that branch identical to today.
- Wrapping each `TerminalView` in a `.terminal-pane-cell` grid cell (rather than making `TerminalView` itself the grid child) gives a stable click target + active-border element without depending on `TerminalView`'s internal root class. The cell must fill the grid track and `TerminalView`'s `.terminal-pane` must fill the cell — handled by CSS in Task 5.
- `onMouseDown` (not `onClick`) so focusing happens before xterm grabs the event; only call `setActiveTab` when not already active (avoid redundant state writes).
- If `TerminalView`'s root already supplies the grid-cell sizing assumptions (it used `flex:1` for the old fl/grid), verify in Task 5's CSS that `.terminal-pane-cell > .terminal-pane` fills the cell.

- [ ] **Step 2: Verify (still expect TabBar errors)**

Run: `npm run build`. `TerminalContainer` should now compile; only `TabBar.tsx` should still reference the removed `splitTabId`. Confirm remaining errors are confined to `TabBar.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/Terminal/TerminalContainer.tsx
git commit -m "feat(split): N-cell grid render with empty slots and hidden off-grid tabs"
```

---

## Task 4: TabBar split-count selector

**Files:** Modify `src/components/TabBar/TabBar.tsx`.

- [ ] **Step 1: Swap store usage + add the selector**

In the `useAppStore()` destructure (line 9), replace `splitTabId, setSplitTabId` with `splitCount, setSplitCount`.

Remove `handleToggleSplit` (lines 49-57). Add local popover state near the top of the component:
```ts
const [splitMenuOpen, setSplitMenuOpen] = useState(false);
```
(ensure `useState` is imported.)

Replace the split toggle button block (lines 119-129) with a selector button + popover. Use `lucide-react` icons already imported where possible (`Columns2` exists; also import `Square`, `Grid2x2`, `LayoutGrid`). Render:
```tsx
{terminalTabs.length >= 2 && (
  <div className="split-selector" style={{ marginLeft: 'auto', position: 'relative' }}>
    <button
      className={`tab-add-btn ${splitCount > 1 ? 'tab-btn-active' : ''}`}
      onClick={() => setSplitMenuOpen((v) => !v)}
      title={t('split_layout')}
    >
      <Columns2 size={14} />
    </button>
    {splitMenuOpen && (
      <>
        <div className="split-menu-backdrop" onClick={() => setSplitMenuOpen(false)} />
        <div className="split-menu">
          {([1, 2, 4, 6, 8] as const).map((n) => (
            <button
              key={n}
              className={`split-menu-item${splitCount === n ? ' active' : ''}`}
              onClick={() => { setSplitCount(n); setSplitMenuOpen(false); }}
            >
              {n === 1 ? <Square size={14} /> : n === 2 ? <Columns2 size={14} /> : n === 4 ? <Grid2x2 size={14} /> : <LayoutGrid size={14} />}
              <span>{n === 1 ? t('split_single') : `${n}`}</span>
            </button>
          ))}
        </div>
      </>
    )}
  </div>
)}
```
Keep the SFTP button's `marginLeft` logic working: it currently keys off `terminalTabs.length >= 2` to know whether the split control (which carries `marginLeft:auto`) is present. The new `.split-selector` wrapper carries `marginLeft:auto`, so that condition is still correct — leave the SFTP button block as-is.

Add the i18n keys to BOTH locale files: `split_layout` ("Split layout" / "分屏布局"), `split_single` ("Single" / "单屏"). (The old `split_toggle` key may now be unused — grep `split_toggle` across `src/`; if zero refs remain, remove it from both locales.)

- [ ] **Step 2: Add popover CSS** (to `global.css`, can also be folded into Task 5):
```css
.split-menu-backdrop { position: fixed; inset: 0; z-index: 40; }
.split-menu {
  position: absolute; top: 100%; right: 0; margin-top: 4px; z-index: 41;
  background: var(--bg-secondary); border: 1px solid var(--border-color);
  border-radius: 8px; padding: 4px; box-shadow: 0 8px 24px rgba(0,0,0,0.28);
  display: flex; flex-direction: column; min-width: 120px;
}
.split-menu-item {
  display: flex; align-items: center; gap: 8px; padding: 6px 10px;
  border-radius: 5px; background: none; border: none; color: var(--text-primary);
  cursor: pointer; font-size: 13px; text-align: left;
}
.split-menu-item:hover { background: var(--bg-hover); }
.split-menu-item.active { color: var(--accent-primary); }
```

- [ ] **Step 3: Verify**

Run: `npm run build` and `npm run smoke:check`.
Expected: BOTH pass now (all `splitTabId` references gone). Then `git grep -n splitTabId -- src/` → no matches.

- [ ] **Step 4: Commit**

```bash
git add src/components/TabBar/TabBar.tsx src/styles/global.css src/i18n/locales/gwshell.en.json src/i18n/locales/gwshell.zh.json
git commit -m "feat(split): tab-bar split-count selector"
```

---

## Task 5: Grid CSS for all counts + pane styling

**Files:** Modify `src/styles/global.css`.

- [ ] **Step 1: Replace the single grid template**

Replace the `.terminal-container.terminal-split-grid` rule (lines 588-593, currently `grid-template-columns: 1fr 1fr`) with count-specific templates and the cell/empty styles:
```css
.terminal-container.terminal-split-grid {
  display: grid;
  gap: 1px;
  background: var(--border-color);
}
.terminal-split-grid.split-2 { grid-template: 1fr / repeat(2, 1fr); }
.terminal-split-grid.split-4 { grid-template: repeat(2, 1fr) / repeat(2, 1fr); }
.terminal-split-grid.split-6 { grid-template: repeat(2, 1fr) / repeat(3, 1fr); }
.terminal-split-grid.split-8 { grid-template: repeat(2, 1fr) / repeat(4, 1fr); }

/* Each grid cell wraps a TerminalView (.terminal-pane). */
.terminal-pane-cell {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-primary);
}
.terminal-pane-cell > .terminal-pane { position: absolute; inset: 0; }
.terminal-pane-cell.is-active-pane { box-shadow: inset 0 0 0 2px var(--accent-primary); }

.terminal-pane-empty {
  display: flex; align-items: center; justify-content: center;
  background: var(--bg-primary); color: var(--text-muted);
  min-width: 0; min-height: 0;
}
.terminal-pane-empty::after { content: "—"; font-size: 20px; opacity: 0.4; }
```

(Confirm `.terminal-pane`'s existing `flex:1` doesn't fight the absolute fill — since `.terminal-pane-cell > .terminal-pane` is set to `position:absolute; inset:0`, it fills the cell regardless of `flex`. If the active-border `inset box-shadow` is clipped, ensure `.terminal-pane-cell` has no `contain:paint` that hides it — it doesn't here.)

- [ ] **Step 2: Verify**

Run: `npm run build`.
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/styles/global.css
git commit -m "feat(split): per-count grid templates and active-pane styling"
```

---

## Task 6: CLAUDE.md + full verification

**Files:** Modify `CLAUDE.md`.

- [ ] **Step 1: Update the Split-Pane Architecture section**

Replace the current 2-pane `splitTabId` description in `CLAUDE.md` with the new model: `splitCount` (1/2/4/6/8) selects the grid; `splitPanes: (tabId|null)[]` maps slots to open terminal tabs (active-first when (re)built by `setSplitCount`); empty slots render blank; off-grid tabs stay mounted-hidden to preserve their xterm instances; closing a tab empties its slot; state is session-only.

- [ ] **Step 2: Full verification**

Run: `git grep -n "splitTabId\|setSplitTabId" -- src/` (expect NONE), then `node scripts/test-split-layout.mjs`, `node scripts/test-completion.mjs`, `npm run build`, `npm run smoke:check`.
Expected: all green, no `splitTabId` refs.

- [ ] **Step 3: Manual verification**

`npm run tauri dev`. Open 3+ terminal tabs (e.g. 3 local shells). Then:
1. Split selector → 4 → 2×2 grid, 3 panes filled + 1 empty "—". All three terminals are live (no reconnect).
2. Click an inactive pane → its border highlights (active), others don't; no pane reflow/jump.
3. Select 6 then 8 → grid reshapes (3×2, then 4×2); every populated pane fits/resizes correctly (text reflows).
4. Close a tab (× in tab bar) → its pane goes empty "—"; other panes unaffected.
5. Open a new local shell while in split → it fills the first empty slot.
6. Select 1 → back to single pane (active tab); re-select 4 → grid rebuilds. Throughout, no terminal is destroyed/reconnected (xterm instances preserved).
7. Broadcast input (status bar) across the visible panes still works.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update split-pane architecture for multi-pane split"
```

---

## Self-Review (plan author)

- **Spec coverage:** slot model + active-first build (Task 1/2 `buildSplitPanes`), `setSplitCount` rebuild (Task 2), `removeTab` slot clear + new-tab fill (Task 2 `clearSlot`/`fillFirstEmpty`), N-cell grid with empty slots + mounted-hidden off-grid tabs (Task 3), count selector (Task 4), per-count layouts 2×1/2×2/3×2/4×2 + active-pane highlight + empty cell (Task 5), migration + CLAUDE.md (Task 2/4/6). Non-goals (drag/resize/clone/persist) excluded. Covered.
- **Placeholders:** Task 2 Step 3 and Task 3 Step 1 instruct reading the real `addTab` variable name and `TerminalView` root — deliberate (those depend on current code the plan quotes the shape of), with the exact edit specified. All pure logic + store + CSS have complete code.
- **Type/name consistency:** `splitCount`/`splitPanes`/`setSplitCount` identical across Tasks 2-4; `buildSplitPanes(tabIds, activeId, n)`, `clearSlot(panes, tabId)`, `fillFirstEmpty(panes, tabId)` signatures consistent between Task 1 (def) and Task 2 (use); CSS classes `terminal-split-grid split-{n}`, `terminal-pane-cell`, `is-active-pane`, `terminal-pane-empty` consistent between Task 3 (render) and Task 5 (styles).
