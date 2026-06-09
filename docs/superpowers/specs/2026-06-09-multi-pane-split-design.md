# Multi-Pane Split (4/6/8) — Design

Date: 2026-06-09
Status: Approved (design), pending spec review

## Goal

Extend the terminal split view from the current 2-pane-only layout to
**1 / 2 / 4 / 6 / 8** panes that tile already-open terminal tabs in a grid. The
user picks the split count from the tab bar; each pane shows one open terminal,
empty slots stay blank, and focusing a pane does not rearrange the others.

## Current state

- `appStore` has `splitTabId: string | null`. The 2-pane split engages when
  `splitTabId` is a distinct, still-open terminal tab.
- `TerminalContainer.tsx` renders ALL terminal tabs; when split is active it adds
  the `.terminal-split-grid` class (CSS `grid-template-columns: 1fr 1fr`) and
  marks only the active tab + `splitTabId` partner `visible`. Non-visible tabs
  stay mounted (to preserve their xterm instances) but hidden.
- `TabBar.tsx` has a split toggle button that calls `setSplitTabId(...)` (only
  shown when ≥2 terminal tabs exist).
- `removeTab` (appStore) clears `splitTabId` when the partner tab closes.
- CLAUDE.md's "Split-Pane Architecture" section currently documents the 2-pane
  `splitTabId` model (updated in a prior cleanup).

## Decisions (from clarification)

- **Pane content:** tile already-open terminal tabs (not clones). Empty slots
  stay blank when there are fewer tabs than panes.
- **State model:** a stable slot array (`splitPanes`) so focusing a pane only
  highlights it — slots do not reflow on focus.
- **Counts/layouts:** 1 (single), 2 = 2×1, 4 = 2×2, 6 = 3×2, 8 = 4×2 (terminals
  are wide, so more columns than rows).

## Architecture

### State (`src/stores/appStore.ts`)

Replace `splitTabId: string | null` with:

```ts
splitCount: 1 | 2 | 4 | 6 | 8;          // default 1 (no split)
splitPanes: (string | null)[];          // slot index -> tabId or null (empty)
setSplitCount: (n: 1 | 2 | 4 | 6 | 8) => void;
```

`setSplitCount(n)`:
- `n === 1` → `splitCount = 1`, `splitPanes = []` (single-pane mode).
- else → `splitCount = n`; rebuild `splitPanes` of length `n` from the CURRENT
  terminal tabs: the active tab first, then the rest in tab-bar order, take up to
  `n` ids, pad the remainder with `null`. (Always rebuilding on `setSplitCount`
  is acceptable for v1 — it only runs when the user changes the count.)

Focusing a pane is just `setActiveTab(slotTabId)` (no separate setter needed);
the active pane is whichever slot holds `activeTabId`.

`removeTab` (existing reducer): when a tab closes, set any `splitPanes` slot
holding that id to `null` (replacing the old single `splitTabId` cleanup). When
`splitCount > 1` but the active tab was closed, pick a new active from a non-null
slot if possible (mirror existing active-tab fallback logic).

Opening/assigning: when a new terminal tab is created while split is active,
fill the first `null` slot with it (so new tabs appear in the grid). If no empty
slot, leave it out of the grid (still an open tab, reachable via the tab bar).

### Layout (`src/components/Terminal/TerminalContainer.tsx`)

- `splitActive = splitCount > 1`. (A grid with only the active tab filled and the
  rest empty is valid and predictable — that is what "tile open tabs, blank
  empty slots" means.)
- When active: render a grid with class `terminal-split-grid split-{splitCount}`.
  Render exactly `splitCount` cells in slot order. Each cell:
  - non-null slot → `<TerminalView tab={tab} isActive={tab.id===activeTabId}
    visible />` wrapped in a pane div that, on click/focus, calls
    `setActiveTab(slot.tabId)`. The active pane gets an `is-active-pane` class
    (highlight border).
  - null slot → an empty placeholder cell (muted, e.g. a centered "—" or a
    short hint; non-interactive in v1).
- Tabs NOT present in any slot must still be MOUNTED (to preserve their xterm
  instances) but hidden — render them outside the visible grid in a
  `display:none` container (same "mounted but not visible" principle the current
  code relies on). This avoids destroying/recreating terminals when toggling
  split.
- When `splitCount === 1` → the existing single-pane render (active tab only).

### CSS (`src/styles/global.css`)

Replace the single `.terminal-split-grid { grid-template-columns: 1fr 1fr }`
with count-specific templates:

```css
.terminal-split-grid { display: grid; gap: 1px; width: 100%; height: 100%; }
.terminal-split-grid.split-2 { grid-template: 1fr / repeat(2, 1fr); }
.terminal-split-grid.split-4 { grid-template: repeat(2, 1fr) / repeat(2, 1fr); }
.terminal-split-grid.split-6 { grid-template: repeat(2, 1fr) / repeat(3, 1fr); }
.terminal-split-grid.split-8 { grid-template: repeat(2, 1fr) / repeat(4, 1fr); }
.terminal-pane.is-active-pane { /* highlight border via existing accent var */ }
.terminal-pane-empty { /* muted placeholder cell */ }
```

(Reuse the existing pane/active styling conventions; check what classes the
current split uses for the broadcasting/active border.)

### TabBar (`src/components/TabBar/TabBar.tsx`)

Replace the single split-toggle button with a **split-count selector**: a button
that opens a small popover listing the five options (1 / 2 / 4 / 6 / 8), each
shown with a small grid-layout icon (reuse `lucide-react` icons such as
`Square`, `Columns2`, `Grid2x2`, and composed/again icons for 6 and 8, or simple
labeled cells). The current `splitCount` option is highlighted. Selecting one
calls `setSplitCount(n)`. The selector is only shown when there are ≥2 terminal
tabs (same gate as today). Close the popover on outside click / Esc (reuse
`useEscapeClose` and the click-outside pattern used by other menus).

### Focus & resize

- Clicking a pane sets the active tab; the grid cells already each host a
  `TerminalView` that fits/resizes via its own `ResizeObserver`, so reflowing
  the grid (changing `splitCount`) triggers each pane's resize automatically —
  no extra wiring beyond what `TerminalView` already does.
- The active pane border uses the existing accent styling.

### Migration / cleanup

Remove all `splitTabId` references and replace with the new model:
`appStore` (state + `removeTab` cleanup), `TerminalContainer`, `TabBar`,
`App.tsx` (if it reads `splitTabId`). Update CLAUDE.md's "Split-Pane
Architecture" section to describe `splitCount` + `splitPanes`.

## Non-goals (v1)

- Drag-to-rearrange panes between slots.
- Resizable pane dividers (panes are equal-sized grid cells).
- Per-pane close buttons (close terminals via the tab bar).
- Cloning the active session to fill empty slots (empty stays empty).
- Persisting `splitCount`/`splitPanes` across app restart (session-only UI state,
  matching the current `splitTabId`).
- Nested/asymmetric splits.

## Files

- **Modify** `src/stores/appStore.ts` — new state + setters; `removeTab` cleanup.
- **Modify** `src/components/Terminal/TerminalContainer.tsx` — multi-pane grid +
  mounted-hidden tabs.
- **Modify** `src/components/TabBar/TabBar.tsx` — split-count selector popover.
- **Modify** `src/styles/global.css` — per-count grid templates + pane styles.
- **Modify** `src/App.tsx` — only if it references `splitTabId`.
- **Modify** `CLAUDE.md` — split-pane section.

## Testing

- No GUI test harness. Pure-logic targets get a Node test (the repo's
  `scripts/*.mjs` + `loadTs` pattern): extract the `setSplitCount` slot-building
  logic and the `removeTab` slot-cleanup logic into testable helpers (e.g.
  `buildSplitPanes(tabs, activeId, n)` and `clearPaneSlot(panes, tabId)`) and
  unit-test them (active-first ordering, padding with null, shrink/grow,
  removing a slotted tab, fewer tabs than panes).
- `npm run build` (tsc) + `npm run smoke:check`.
- Manual: open 3+ terminal tabs; pick 4 → 2×2 grid with 3 filled + 1 empty;
  click panes to focus (border moves, no reflow); pick 6/8 (grid reshapes, all
  panes fit/resize); close a tab (its slot empties); pick 1 (back to single);
  verify xterm instances are preserved (no reconnect) when toggling counts.
