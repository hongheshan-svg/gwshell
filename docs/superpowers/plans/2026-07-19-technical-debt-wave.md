# Technical Debt Wave - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose TerminalView.tsx (2635 -> ~800 lines), split global.css (5981 -> ~200 lines co-located), and add React.memo performance optimizations.

**Architecture:** 7 sequentially-dependent PRs. PR1-5 progressively extract modules from TerminalView following the existing `terminalRegistry.ts`/`terminalContext.ts` pattern (module-level Map + accessor). PR6 splits CSS into co-located files. PR7 adds memoization. Each PR is a pure move (no logic change) except PR5 (high-risk connection orchestration extraction).

**Tech Stack:** React 19 + TypeScript 5.8 + Vite 7 + xterm.js 6. No new dependencies.

## Global Constraints

- **TypeScript strict mode** (`noUnusedLocals` + `noUnusedParameters`). Two-space indent, named exports, PascalCase component files.
- **ESLint 9 flat config** (`eslint.config.mjs`): no `any`, no `as` casts without `// eslint-disable-next-line no-restricted-syntax -- reason`, no floating promises, no `console.log`.
- **Conventional Commits**: `refactor:`, `perf:`, `chore:` with optional scope. Imperative subject.
- **i18n rule**: every user-facing string through i18next. `gwshell.en.json` and `gwshell.zh.json` must stay key-for-key identical (smoke:check enforces).
- **Existing module pattern**: `terminalRegistry.ts` (module-level `Map` + type, direct named exports) and `terminalContext.ts` (module-level `Map` + accessor functions). Follow this style.
- **Existing co-located CSS pattern**: `Toast/toast.css` + `ToastProvider.tsx` `import './toast.css'`. Follow this style.
- **CI gates** (all must pass per PR): `npm run lint` (0 violations), `npm run build`, `npm run smoke:check` (6 checks), `npm run format:check`, `npm run test:node`.
- **No backend changes**: all work is in `src/` (frontend only). `cargo` checks should be unaffected but verify nothing breaks.
- **Behavior-preserving**: terminal connections, copy/paste, completion, resize, theme switch, split panes must work identically after each PR.

### Spec reference

Implements `docs/superpowers/specs/2026-07-19-technical-debt-wave-design.md`.

---

## PR1: `refactor(terminal): extract terminalClipboard + terminalPlatform`

### Task 1.1: Create `src/lib/terminalPlatform.ts`

**Files:**

- Create: `src/lib/terminalPlatform.ts`
- Modify: `src/components/Terminal/TerminalView.tsx` (remove moved code, add import)

**Interfaces:**

- Produces: `getOsInfo`, `isMacPlatform`, `webglDebugEnabled`, `cellSize`, `isInteractiveTerminal`, `cachedOsInfo` (for internal use by clipboard module)

- [ ] **Step 1: Read the source code to move**

Read `src/components/Terminal/TerminalView.tsx` lines 104-155 (isMacPlatform + cachedOsInfo + osInfoPromise + getOsInfo + pre-warm IIFE) and lines 176-182 (webglDebugEnabled) and lines 239-260 (isInteractiveTerminal + cellSize). These are the functions/vars to move.

- [ ] **Step 2: Create `src/lib/terminalPlatform.ts`**

Copy the following from `TerminalView.tsx` into the new file. Keep the exact code, only add the necessary imports:

```typescript
// src/lib/terminalPlatform.ts
// Platform detection and OS info caching for terminal features.
// Extracted from TerminalView.tsx to reduce its size and isolate platform
// concerns. Module-level cache (cachedOsInfo) is a singleton shared across
// all terminal instances, same pattern as terminalRegistry.ts.

import type { Terminal } from '@xterm/xterm';
import { invoke } from '@tauri-apps/api/core';

// --- OS info cache (shared singleton, pre-warmed at module load) ---

let cachedOsInfo: { os: string; windowsBuild?: number } | null = null;
let osInfoPromise: Promise<{ os: string; windowsBuild?: number }> | null = null;

/** Fetch OS info via Tauri, cache the result, and dedupe concurrent calls. */
export async function getOsInfo(): Promise<{ os: string; windowsBuild?: number }> {
  if (cachedOsInfo) return cachedOsInfo;
  osInfoPromise ??= invoke<{ os: string; windowsBuild?: number }>('get_os_info')
    .then((info) => {
      cachedOsInfo = info;
      return info;
    })
    .catch(() => {
      const fallback = { os: 'unknown' };
      cachedOsInfo = fallback;
      return fallback;
    });
  return osInfoPromise;
}

/** True on macOS. Uses cached OS info if available, falls back to navigator. */
export function isMacPlatform(): boolean {
  if (cachedOsInfo) return cachedOsInfo.os === 'macos';
  return /mac/i.test(navigator.platform);
}

// Pre-warm OS info at module load so the first terminal doesn't stall.
void getOsInfo();

// --- WebGL debug flag ---

/** True if localStorage has the WebGL debug flag set. */
export function webglDebugEnabled(): boolean {
  try {
    return localStorage.getItem('gwshell:webgl-debug') === '1';
  } catch {
    return false;
  }
}

// --- Terminal type helpers ---

/** True for session types that have an interactive shell (ssh/localshell/serial/docker). */
export function isInteractiveTerminal(type: string): boolean {
  return type === 'ssh' || type === 'localshell' || type === 'serial' || type === 'docker';
}

/** Read xterm's cell dimensions for dropdown positioning. */
export function cellSize(term: Terminal, el: HTMLElement): { w: number; h: number } {
  // Copy the exact body from TerminalView.tsx lines 250-260.
  // It reads term._core?._renderService?.dimensions or falls back to el.clientWidth / cols.
}
```

**IMPORTANT:** Copy the EXACT function bodies from `TerminalView.tsx` -- do not rewrite or "improve" them. The `cellSize` body is at lines 250-260; copy it verbatim.

- [ ] **Step 3: Remove the moved code from `TerminalView.tsx`**

Delete from `TerminalView.tsx`:

- `cachedOsInfo` + `osInfoPromise` declarations (lines 135-136)
- `getOsInfo` function (lines 138-153)
- `void getOsInfo()` pre-warm (line 155)
- `isMacPlatform` function (lines 104-107)
- `webglDebugEnabled` function (lines 176-182)
- `isInteractiveTerminal` function (lines 239-241)
- `cellSize` function (lines 250-260)

- [ ] **Step 4: Add import in `TerminalView.tsx`**

Add to the imports at the top of `TerminalView.tsx`:

```typescript
import {
  getOsInfo,
  isMacPlatform,
  webglDebugEnabled,
  isInteractiveTerminal,
  cellSize,
} from '../../lib/terminalPlatform';
```

- [ ] **Step 5: Verify build + lint + smoke**

```bash
npm run build && npm run lint && npm run smoke:check
```

All must pass. If `tsc` reports a missing import, the moved code referenced something still in `TerminalView.tsx` -- add it to the new file's imports.

- [ ] **Step 6: Commit**

```bash
git add src/lib/terminalPlatform.ts src/components/Terminal/TerminalView.tsx
git commit -m "refactor(terminal): extract terminalPlatform (OS info cache, isMacPlatform, cellSize)"
```

---

### Task 1.2: Create `src/lib/terminalClipboard.ts`

**Files:**

- Create: `src/lib/terminalClipboard.ts`
- Modify: `src/components/Terminal/TerminalView.tsx`

**Interfaces:**

- Consumes: `isMacPlatform` from `terminalPlatform.ts`
- Produces: `PASSWORD_PROMPT_RE`, `isPasteAction`, `writeClipboardText`, `readClipboardText`, `readTerminalSelection`, `isCopyShortcut`, `isPasteShortcut`

- [ ] **Step 1: Create `src/lib/terminalClipboard.ts`**

Copy the following from `TerminalView.tsx` into the new file:

```typescript
// src/lib/terminalClipboard.ts
// Clipboard read/write helpers and keyboard shortcut detection for the
// terminal. Extracted from TerminalView.tsx. The copy/paste shortcut
// detection depends on isMacPlatform() from terminalPlatform.ts.

import type { Terminal } from '@xterm/xterm';
import {
  readText as clipboardRead,
  writeText as clipboardWrite,
} from '@tauri-apps/plugin-clipboard-manager';
import { isMacPlatform } from './terminalPlatform';

// --- Password prompt detection (used by render coalescing to suppress
// completions and history capture while the shell is asking for a password) ---

export const PASSWORD_PROMPT_RE =
  /password:\s*$|passphrase:\s*$|verification code:\s*$|2fa code:\s*$|totp:\s*$|pin:\s*$/i;

// --- Paste action detection (right/middle-click menu) ---

export const isPasteAction = (value: string) => value === 'paste' || value === '粘贴';

// --- Clipboard I/O (Tauri clipboard with browser fallback) ---

export async function writeClipboardText(text: string): Promise<void> {
  // Copy exact body from TerminalView.tsx lines 83-91.
}

export async function readClipboardText(): Promise<string> {
  // Copy exact body from TerminalView.tsx lines 93-97.
}

export function readTerminalSelection(terminal: Terminal): string {
  // Copy exact body from TerminalView.tsx lines 99-102.
}

// --- Keyboard shortcut detection ---

export function isCopyShortcut(e: KeyboardEvent): boolean {
  // Copy exact body from TerminalView.tsx lines 109-119.
  // Uses isMacPlatform() imported above.
}

export function isPasteShortcut(e: KeyboardEvent, ctrlVPaste: boolean): boolean {
  // Copy exact body from TerminalView.tsx lines 121-132.
  // Uses isMacPlatform() imported above.
}
```

**IMPORTANT:** Copy the EXACT function bodies from `TerminalView.tsx` lines 80-132. Do NOT rewrite them.

- [ ] **Step 2: Remove the moved code from `TerminalView.tsx`**

Delete from `TerminalView.tsx`:

- `PASSWORD_PROMPT_RE` (lines 80-81)
- `isPasteAction` (lines 67-68)
- `writeClipboardText` (lines 83-91)
- `readClipboardText` (lines 93-97)
- `readTerminalSelection` (lines 99-102)
- `isCopyShortcut` (lines 109-119)
- `isPasteShortcut` (lines 121-132)

- [ ] **Step 3: Add import in `TerminalView.tsx`**

```typescript
import {
  PASSWORD_PROMPT_RE,
  isPasteAction,
  writeClipboardText,
  readClipboardText,
  readTerminalSelection,
  isCopyShortcut,
  isPasteShortcut,
} from '../../lib/terminalClipboard';
```

- [ ] **Step 4: Verify build + lint + smoke**

```bash
npm run build && npm run lint && npm run smoke:check && npm run format:check
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/terminalClipboard.ts src/components/Terminal/TerminalView.tsx
git commit -m "refactor(terminal): extract terminalClipboard (clipboard I/O, shortcut detection)"
```

---

## PR2: `refactor(terminal): extract overlay components`

### Task 2.1: Create `src/components/Terminal/types.ts`

**Files:**

- Create: `src/components/Terminal/types.ts`
- Modify: `src/components/Terminal/TerminalView.tsx`

- [ ] **Step 1: Read the type definitions to move**

Read `TerminalView.tsx` lines 54-65 for the `FingerprintInfo` and context menu state types.

- [ ] **Step 2: Create `src/components/Terminal/types.ts`**

```typescript
// src/components/Terminal/types.ts
// Shared types for TerminalView and its overlay components.

export interface FingerprintInfo {
  host: string;
  port: number;
  keyType: string;
  fingerprint: string;
}

export interface TerminalContextMenuState {
  x: number;
  y: number;
  canCopy: boolean;
}
```

- [ ] **Step 3: Update `TerminalView.tsx` to import from `types.ts`**

Replace the inline `FingerprintInfo` and `TerminalContextMenuState` interface definitions in `TerminalView.tsx` with:

```typescript
import type { FingerprintInfo, TerminalContextMenuState } from './types';
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/components/Terminal/types.ts src/components/Terminal/TerminalView.tsx
git commit -m "refactor(terminal): extract shared overlay types to types.ts"
```

---

### Task 2.2: Create `TerminalContextMenu.tsx`

**Files:**

- Create: `src/components/Terminal/TerminalContextMenu.tsx`
- Modify: `src/components/Terminal/TerminalView.tsx`

- [ ] **Step 1: Read the JSX to move**

Read `TerminalView.tsx` lines 2546-2570 (the `contextMenu && isActive && (...)` block).

- [ ] **Step 2: Create `src/components/Terminal/TerminalContextMenu.tsx`**

```tsx
// src/components/Terminal/TerminalContextMenu.tsx
import { useTranslation } from 'react-i18next';
import type { TerminalContextMenuState } from './types';

interface TerminalContextMenuProps {
  state: TerminalContextMenuState;
  onCopy: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
  onClear: () => void;
}

export function TerminalContextMenu({
  state,
  onCopy,
  onPaste,
  onSelectAll,
  onClear,
}: TerminalContextMenuProps) {
  const { t } = useTranslation();
  // Copy the exact JSX from TerminalView.tsx lines 2546-2570.
  // The outer div uses style={{ left: state.x, top: state.y }}.
  // The buttons call onCopy/onPaste/onSelectAll/onClear.
  // canCopy gates the Copy button's disabled state.
}
```

Copy the EXACT JSX from the source. The `t('...')` calls stay the same.

- [ ] **Step 3: Replace the inline JSX in `TerminalView.tsx`**

Replace the `contextMenu && isActive && (...)` block with:

```tsx
{
  contextMenu && isActive && (
    <TerminalContextMenu
      state={contextMenu}
      onCopy={copySelection}
      onPaste={pasteClipboard}
      onSelectAll={selectAllTerminal}
      onClear={clearTerminal}
    />
  );
}
```

- [ ] **Step 4: Add import in `TerminalView.tsx`**

```typescript
import { TerminalContextMenu } from './TerminalContextMenu';
```

- [ ] **Step 5: Verify build + lint + smoke**

```bash
npm run build && npm run lint && npm run smoke:check
```

- [ ] **Step 6: Commit**

```bash
git add src/components/Terminal/TerminalContextMenu.tsx src/components/Terminal/TerminalView.tsx
git commit -m "refactor(terminal): extract TerminalContextMenu component"
```

---

### Task 2.3: Create `FingerprintDialog.tsx`

**Files:**

- Create: `src/components/Terminal/FingerprintDialog.tsx`
- Modify: `src/components/Terminal/TerminalView.tsx`

- [ ] **Step 1: Read the JSX to move**

Read `TerminalView.tsx` lines 2572-2603 (the `fingerprintInfo && isActive && (...)` block).

- [ ] **Step 2: Create `src/components/Terminal/FingerprintDialog.tsx`**

```tsx
// src/components/Terminal/FingerprintDialog.tsx
import { useTranslation } from 'react-i18next';
import type { FingerprintInfo } from './types';

interface FingerprintDialogProps {
  info: FingerprintInfo;
  onAccept: () => void;
  onReject: () => void;
}

export function FingerprintDialog({ info, onAccept, onReject }: FingerprintDialogProps) {
  const { t } = useTranslation();
  // Copy the exact JSX from TerminalView.tsx lines 2572-2603.
  // The 🔒 emoji, host:port, keyType, fingerprint display stay.
  // Accept button calls onAccept; Reject calls onReject.
}
```

- [ ] **Step 3: Replace the inline JSX in `TerminalView.tsx`**

```tsx
{
  fingerprintInfo && isActive && (
    <FingerprintDialog
      info={fingerprintInfo}
      onAccept={() => {
        fingerprintResolveRef.current?.(true);
        setFingerprintInfo(null);
      }}
      onReject={() => {
        fingerprintResolveRef.current?.(false);
        setFingerprintInfo(null);
      }}
    />
  );
}
```

- [ ] **Step 4: Add import + verify**

```typescript
import { FingerprintDialog } from './FingerprintDialog';
```

```bash
npm run build && npm run lint && npm run smoke:check
```

- [ ] **Step 5: Commit**

```bash
git add src/components/Terminal/FingerprintDialog.tsx src/components/Terminal/TerminalView.tsx
git commit -m "refactor(terminal): extract FingerprintDialog component"
```

---

### Task 2.4: Create `PasteConfirmDialog.tsx`

**Files:**

- Create: `src/components/Terminal/PasteConfirmDialog.tsx`
- Modify: `src/components/Terminal/TerminalView.tsx`

- [ ] **Step 1: Read the JSX to move**

Read `TerminalView.tsx` lines 2605-2632 (the `pasteConfirm !== null && (...)` block).

- [ ] **Step 2: Create `src/components/Terminal/PasteConfirmDialog.tsx`**

```tsx
// src/components/Terminal/PasteConfirmDialog.tsx
import { useTranslation } from 'react-i18next';

interface PasteConfirmDialogProps {
  text: string;
  onCancel: () => void;
  onPaste: () => void;
}

export function PasteConfirmDialog({ text, onCancel, onPaste }: PasteConfirmDialogProps) {
  const { t } = useTranslation();
  const lineCount = text.split('\n').length;
  // Copy the exact JSX from TerminalView.tsx lines 2605-2632.
  // Title, line count, 8-line preview, Cancel/Paste buttons.
}
```

- [ ] **Step 3: Replace the inline JSX in `TerminalView.tsx`**

```tsx
{
  pasteConfirm !== null && (
    <PasteConfirmDialog
      text={pasteConfirm}
      onCancel={() => setPasteConfirm(null)}
      onPaste={() => {
        const terminal = terminalInstances.get(tab.id)?.terminal;
        if (terminal) terminal.paste(pasteConfirm);
        setPasteConfirm(null);
      }}
    />
  );
}
```

- [ ] **Step 4: Add import + verify**

```typescript
import { PasteConfirmDialog } from './PasteConfirmDialog';
```

```bash
npm run build && npm run lint && npm run smoke:check && npm run format:check
```

- [ ] **Step 5: Commit**

```bash
git add src/components/Terminal/PasteConfirmDialog.tsx src/components/Terminal/TerminalView.tsx
git commit -m "refactor(terminal): extract PasteConfirmDialog component"
```

---

## PR3: `refactor(terminal): extract terminalCompletionState`

### Task 3.1: Create `src/lib/terminalCompletionState.ts`

**Files:**

- Create: `src/lib/terminalCompletionState.ts`
- Modify: `src/components/Terminal/TerminalView.tsx`

**Interfaces:**

- Consumes: `CommandTable` type, `Completion` type, `tableForShellName`/`tableForRemoteShell` from `commandDictionary`
- Produces: 13 named-export Maps + 4 helper functions + `resetCompletionState`

- [ ] **Step 1: Read the code to move**

Read `TerminalView.tsx` lines 207-237 (the 13 Maps) and lines 263-300 (the 4 helpers: `tabScope`, `syncTable`, `normalizeTable`, `estimateDropdownRows`).

- [ ] **Step 2: Create `src/lib/terminalCompletionState.ts`**

```typescript
// src/lib/terminalCompletionState.ts
// Per-tab completion and command-history state. Module-level Maps are
// singletons shared across all terminal instances (same pattern as
// terminalRegistry.ts). Extracted from TerminalView.tsx.

import type { Completion } from './completion';
import type { CommandTable } from './commandDictionary';
import { tableForShellName, tableForRemoteShell } from './commandDictionary';

// --- Per-tab mutable state (module-level singletons) ---

export const inputBuffers = new Map<string, string>();
export const completionSetters = new Map<
  string,
  (items: Completion[], index: number, x: number, y: number, above: boolean) => void
>();
export const completionAccept = new Map<string, (suffix: string) => void>();
export const tabCwd = new Map<string, string>();
export const remoteOsCache = new Map<string, { table: CommandTable; at: number }>();
export const REMOTE_OS_TTL_MS = 5 * 60 * 1000;
export const tabCompletions = new Map<string, Completion[]>();
export const tabCompletionIdx = new Map<string, number>();
export const completionNav = new Map<string, boolean>();
export const tabInputSenders = new Map<string, (data: string) => void>();
export const bracketedPaste = new Map<string, boolean>();
export const awaitingPassword = new Map<string, boolean>();
export const awaitingPasswordTimer = new Map<string, ReturnType<typeof setTimeout>>();
export const tabCommandTable = new Map<string, CommandTable>();

// --- Helpers ---

export function tabScope(
  // Copy exact signature + body from TerminalView.tsx lines 263-275.
);

export function syncTable(
  // Copy exact signature + body from TerminalView.tsx lines 277-285.
);

export function normalizeTable(s: string): CommandTable {
  // Copy exact body from TerminalView.tsx lines 287-293.
}

export function estimateDropdownRows(items: Completion[]): number {
  // Copy exact body from TerminalView.tsx lines 295-300.
}

/** Clear all completion state for a tab. Called by destroyTerminal + reconnect. */
export function resetCompletionState(tabId: string): void {
  inputBuffers.delete(tabId);
  completionSetters.delete(tabId);
  completionAccept.delete(tabId);
  tabCwd.delete(tabId);
  tabCompletions.delete(tabId);
  tabCompletionIdx.delete(tabId);
  completionNav.delete(tabId);
  tabInputSenders.delete(tabId);
  bracketedPaste.delete(tabId);
  awaitingPassword.delete(tabId);
  const timer = awaitingPasswordTimer.get(tabId);
  if (timer) clearTimeout(timer);
  awaitingPasswordTimer.delete(tabId);
  tabCommandTable.delete(tabId);
}
```

**IMPORTANT:** Copy the EXACT function bodies. The `resetCompletionState` function is new -- it consolidates the per-tab cleanup currently inlined in `destroyTerminal`. Verify it matches all the deletes in `destroyTerminal` for the completion Maps.

- [ ] **Step 3: Remove the moved code from `TerminalView.tsx`**

Delete from `TerminalView.tsx`:

- All 13 Map/Set declarations (lines 207-237, excluding `REMOTE_OS_TTL_MS` if it's a const)
- `tabScope`, `syncTable`, `normalizeTable`, `estimateDropdownRows` functions (lines 263-300)
- The per-tab cleanup of these Maps inside `destroyTerminal` (replace with `resetCompletionState(tabId)` call)

- [ ] **Step 4: Add import in `TerminalView.tsx`**

```typescript
import {
  inputBuffers,
  completionSetters,
  completionAccept,
  tabCwd,
  remoteOsCache,
  REMOTE_OS_TTL_MS,
  tabCompletions,
  tabCompletionIdx,
  completionNav,
  tabInputSenders,
  bracketedPaste,
  awaitingPassword,
  awaitingPasswordTimer,
  tabCommandTable,
  tabScope,
  syncTable,
  normalizeTable,
  estimateDropdownRows,
  resetCompletionState,
} from '../../lib/terminalCompletionState';
```

- [ ] **Step 5: Verify build + lint + smoke**

```bash
npm run build && npm run lint && npm run smoke:check && npm run format:check
```

If `tsc` reports "X is declared but never read" -- that means a moved Map is still referenced somewhere in `TerminalView.tsx` that you missed. Find and fix.

- [ ] **Step 6: Commit**

```bash
git add src/lib/terminalCompletionState.ts src/components/Terminal/TerminalView.tsx
git commit -m "refactor(terminal): extract terminalCompletionState (13 Maps + helpers + reset)"
```

---

## PR4: `refactor(terminal): extract terminalLifecycle + update external callers`

### Task 4.1: Create `src/lib/terminalLifecycle.ts`

**Files:**

- Create: `src/lib/terminalLifecycle.ts`
- Modify: `src/components/Terminal/TerminalView.tsx`

**Interfaces:**

- Consumes: `terminalInstances` from `terminalRegistry`, `resetCompletionState` + `tabInputSenders` from `terminalCompletionState`, `clearTerminalAiContext` from `terminalContext`
- Produces: `connectedTabs`, `reconnectableTabs`, `tabListenerCleanups`, `terminalInteractionCleanups`, `fitFrameIds`, `settleTimerIds`, `pendingBackendResize`, `sentFirstResize`, `suggestedRendererTypeDom`, `cleanupTabListeners`, `cleanupTerminalInteractions`, `safeFit`, `scheduleTerminalFit`, `scheduleTerminalResizeSettle`, `forceTerminalRedraw`, `destroyTerminal`, `sendInputToTab`

- [ ] **Step 1: Read the code to move**

Read `TerminalView.tsx` lines 159-204 (the 8 Maps/Sets/lets) and lines 305-482 (the helpers + exported functions: `cleanupTabListeners`, `cleanupTerminalInteractions`, `sendInputToTab`, `destroyTerminal`, `safeFit`, `scheduleTerminalFit`, `scheduleTerminalResizeSettle`, `forceTerminalRedraw`).

- [ ] **Step 2: Create `src/lib/terminalLifecycle.ts`**

Move the 8 Maps/Sets/lets and the 8 helper functions. Add imports for the dependencies:

```typescript
// src/lib/terminalLifecycle.ts
// Connection lifecycle, fit/resize scheduling, and terminal teardown.
// Module-level state is singleton (same pattern as terminalRegistry.ts).
// Extracted from TerminalView.tsx.

import { invoke } from '@tauri-apps/api/core';
import { terminalInstances } from '../components/Terminal/terminalRegistry';
import { tabInputSenders, resetCompletionState } from './terminalCompletionState';
import { clearTerminalAiContext } from './terminalContext';

// --- Per-tab lifecycle state (module-level singletons) ---

export const connectedTabs = new Set<string>();
export const reconnectableTabs = new Set<string>();
export const tabListenerCleanups = new Map<string, () => void>();
export const terminalInteractionCleanups = new Map<string, () => void>();
export const fitFrameIds = new Map<string, number>();
export const settleTimerIds = new Map<string, ReturnType<typeof setTimeout>>();
export const pendingBackendResize = new Map<string, ReturnType<typeof setTimeout>>();
export const sentFirstResize = new Set<string>();
export let suggestedRendererTypeDom = false;

export function setSuggestedRendererTypeDom(value: boolean): void {
  suggestedRendererTypeDom = value;
}

// --- Cleanup helpers ---

export function cleanupTabListeners(tabId: string): void {
  // Copy exact body from TerminalView.tsx lines 305-312.
}

export function cleanupTerminalInteractions(tabId: string): void {
  // Copy exact body from TerminalView.tsx lines 314-322.
}

// --- Input injection (used by SnippetPanel + TerminalAiDock) ---

export function sendInputToTab(tabId: string, data: string): boolean {
  // Copy exact body from TerminalView.tsx lines 324-331.
  // Uses tabInputSenders from terminalCompletionState.
}

// --- Full teardown ---

export function destroyTerminal(tabId: string): void {
  // Copy exact body from TerminalView.tsx lines 333-380.
  // CRITICAL: replace the inline per-tab cleanup of completion Maps
  // with: resetCompletionState(tabId);
  // Keep the cleanup of lifecycle Maps (connectedTabs, reconnectableTabs, etc.).
}

// --- Fit / resize scheduling ---

export function safeFit(tabId: string): void {
  // Copy exact body from TerminalView.tsx lines 382-394.
}

export function scheduleTerminalFit(tabId: string): void {
  // Copy exact body from TerminalView.tsx lines 396-404.
}

export function scheduleTerminalResizeSettle(
  // Copy exact signature + body from TerminalView.tsx lines 406-438.
);

export function forceTerminalRedraw(
  // Copy exact signature + body from TerminalView.tsx lines 440-482.
);
```

**IMPORTANT:**

1. `suggestedRendererTypeDom` is a `let` that's written to inside the WebGL catch block. Since `let` can't be exported mutably, add a `setSuggestedRendererTypeDom` setter and update the write site in `TerminalView.tsx` to call it.
2. `destroyTerminal` currently inlines the cleanup of all completion Maps. Replace that with `resetCompletionState(tabId)` (from PR3).
3. Copy ALL function bodies EXACTLY. No logic changes.

- [ ] **Step 3: Remove the moved code from `TerminalView.tsx`**

Delete the 8 Maps/Sets/lets (lines 159-204) and the 8 helper functions (lines 305-482).

- [ ] **Step 4: Add import in `TerminalView.tsx`**

```typescript
import {
  connectedTabs,
  reconnectableTabs,
  tabListenerCleanups,
  terminalInteractionCleanups,
  fitFrameIds,
  settleTimerIds,
  pendingBackendResize,
  sentFirstResize,
  suggestedRendererTypeDom,
  setSuggestedRendererTypeDom,
  cleanupTabListeners,
  cleanupTerminalInteractions,
  sendInputToTab,
  destroyTerminal,
  safeFit,
  scheduleTerminalFit,
  scheduleTerminalResizeSettle,
  forceTerminalRedraw,
} from '../../lib/terminalLifecycle';
```

- [ ] **Step 5: Update the WebGL catch block**

Find the `suggestedRendererTypeDom = true` write site in the WebGL loading code inside `TerminalView.tsx`. Replace with `setSuggestedRendererTypeDom(true)`.

- [ ] **Step 6: Verify build + lint + smoke**

```bash
npm run build && npm run lint && npm run smoke:check && npm run format:check
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/terminalLifecycle.ts src/components/Terminal/TerminalView.tsx
git commit -m "refactor(terminal): extract terminalLifecycle (fit/resize/cleanup + destroyTerminal)"
```

---

### Task 4.2: Update 5 external callers' import paths

**Files:**

- Modify: `src/components/Sidebar/SnippetPanel.tsx`
- Modify: `src/components/Terminal/TerminalAiDock.tsx`
- Modify: `src/components/TabBar/TabBar.tsx`
- Modify: `src/keymap/actions.ts`

- [ ] **Step 1: Update `SnippetPanel.tsx`**

Change:

```typescript
import { sendInputToTab } from '../Terminal/TerminalView';
```

To:

```typescript
import { sendInputToTab } from '../../lib/terminalLifecycle';
```

- [ ] **Step 2: Update `TerminalAiDock.tsx`**

Change:

```typescript
import { sendInputToTab } from './TerminalView';
```

To:

```typescript
import { sendInputToTab } from '../../lib/terminalLifecycle';
```

- [ ] **Step 3: Update `TabBar.tsx`**

Change:

```typescript
import { destroyTerminal } from '../Terminal/TerminalView';
```

To:

```typescript
import { destroyTerminal } from '../../lib/terminalLifecycle';
```

- [ ] **Step 4: Update `keymap/actions.ts`**

Change:

```typescript
import { destroyTerminal } from '../components/Terminal/TerminalView';
```

To:

```typescript
import { destroyTerminal } from '../lib/terminalLifecycle';
```

- [ ] **Step 5: Verify build + lint + smoke**

```bash
npm run build && npm run lint && npm run smoke:check
```

If `tsc` reports any other file importing from `TerminalView` that should now import from `terminalLifecycle`, update it too. Run `grep -rn "from.*TerminalView" src/ --include="*.ts" --include="*.tsx" | grep -v "TerminalView.tsx"` to find all importers -- the only one that should remain is `TerminalContainer.tsx` importing the `TerminalView` component itself.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(terminal): update 4 external callers to import from terminalLifecycle"
```

---

## PR5: `refactor(terminal): extract terminalConnection`

### Task 5.1: Create `src/lib/terminalConnection.ts`

**Files:**

- Create: `src/lib/terminalConnection.ts`
- Modify: `src/components/Terminal/TerminalView.tsx`

**Interfaces:**

- Consumes: `TerminalInstance` from `terminalRegistry`, all exports from `terminalClipboard`, `terminalPlatform`, `terminalCompletionState`, `terminalLifecycle`
- Produces: `createTerminalConnection(opts) => TerminalConnectionHandle`

**Background:** The `setupConnection` function body (lines ~1291-2335, ~1000 lines) is the connection orchestration. It's currently an async function defined inside the monster `useEffect`. The extraction wraps it in a factory function that receives all needed context via an opts bag and returns a cleanup handle.

- [ ] **Step 1: Read the full `setupConnection` body**

Read `TerminalView.tsx` from the `const setupConnection = async () => {` line (~1291) to its closing `};` (~2335). This is the code to move. Understand:

- What closure variables it reads: `tab`, `instance` (the TerminalInstance), `sessionsRef`, `t`, `cancelled`, and the React state setters (`setFingerprintInfo`, `setPasteConfirm`, `setCompletionItems`/`setCompletionIndex`/`setCompletionPos` via `completionSetters`).
- What it defines internally: `renderQueue`, `writeQueue`, `renderRafId`, various `listen()` cleanup functions.
- The 4 connect branches: `localshell`, `ssh`, `serial`, `docker`.

- [ ] **Step 2: Design the opts interface**

```typescript
// src/lib/terminalConnection.ts

import type { Terminal } from '@xterm/xterm';
import type { TabInfo } from '../types';
import type { TerminalInstance } from '../components/Terminal/terminalRegistry';
import type { SessionConfig } from '../types';
import type { TFunction } from 'i18next';
import type { FingerprintInfo } from '../components/Terminal/types';

export interface TerminalConnectionOptions {
  tab: TabInfo;
  instance: TerminalInstance;
  sessionsRef: React.MutableRefObject<SessionConfig[]>;
  t: TFunction;
  locale: 'en' | 'zh';
  // Callbacks for React state mutations (the factory can't call setState directly)
  onFingerprintPrompt: (info: FingerprintInfo) => Promise<boolean>;
  onDockerPick: () => Promise<string | null>;
  onCancelled: () => void;
  // Settings needed inside the connection
  terminalCmdHint: boolean;
  pasteWarnMultiline: boolean;
}

export interface TerminalConnectionHandle {
  cleanup: () => void;
  sendInput: (data: string) => void;
  reconnect: () => Promise<void>;
}

export function createTerminalConnection(
  opts: TerminalConnectionOptions,
): TerminalConnectionHandle {
  let cancelled = false;
  // ... move the entire setupConnection body here ...
  // Replace `setFingerprintInfo(x)` with `opts.onFingerprintPrompt(x)` (await it).
  // Replace `cancelled` references with the local `cancelled` variable.
  // Return { cleanup, sendInput, reconnect }.
}
```

- [ ] **Step 3: Move the `setupConnection` body into `createTerminalConnection`**

This is the hardest step. Copy the ENTIRE `setupConnection` function body into `createTerminalConnection`. Then:

- Replace all `tab` references with `opts.tab`.
- Replace `instance` with `opts.instance`.
- Replace `sessionsRef` with `opts.sessionsRef`.
- Replace `t(...)` with `opts.t(...)`.
- Replace `locale` with `opts.locale`.
- Replace `terminalCmdHint` with `opts.terminalCmdHint`.
- Replace `pasteWarnMultiline` with `opts.pasteWarnMultiline`.
- The fingerprint dialog flow: replace `setFingerprintInfo(info)` + `await new Promise(resolve => { fingerprintResolveRef.current = resolve })` with `const accepted = await opts.onFingerprintPrompt(info)`.
- The docker picker flow: replace the `listenTypedEvent('gwshell:docker-pick')` + `setDockerPicker` with `const containerId = await opts.onDockerPick()`.
- Replace `if (cancelled) return` checks -- `cancelled` is now a local in the factory.
- The `cleanup` function (currently in the `return () => { ... }` of the useEffect) becomes `handle.cleanup`.
- `sendInput` wraps `tabInputSenders.get(opts.tab.id)`.
- `reconnect` is the reconnect logic currently inline.

- [ ] **Step 4: Update the monster useEffect in `TerminalView.tsx`**

Replace the `const setupConnection = async () => { ... }` + its call + the cleanup function with:

```typescript
const connection = createTerminalConnection({
  tab,
  instance,
  sessionsRef,
  t,
  locale: i18n.language.startsWith('zh') ? 'zh' : 'en',
  onFingerprintPrompt: async (info) => {
    return new Promise<boolean>((resolve) => {
      fingerprintResolveRef.current = resolve;
      setFingerprintInfo(info);
    });
  },
  onDockerPick: async () => {
    return new Promise<string | null>((resolve) => {
      // Bridge to the docker picker event (same as current code).
      const unsub = listenTypedEvent<DockerPickPayload>('gwshell:docker-pick', (detail) => {
        resolve(detail.containerId);
      });
      // Cancel handling stays the same.
    });
  },
  onCancelled: () => {
    /* same as current cancelled = true effect */
  },
  terminalCmdHint,
  pasteWarnMultiline,
});

// cleanup
return () => {
  connection.cleanup();
};
```

- [ ] **Step 5: Verify build + lint + smoke**

```bash
npm run build && npm run lint && npm run smoke:check && npm run format:check
```

**This is the highest-risk PR.** If `tsc` reports type errors, the opts interface doesn't match the actual closure variables -- fix the interface. If the app crashes or terminal doesn't connect, the `cancelled` flag or a callback wiring is wrong. **If you can't get it stable in a reasonable time, revert this PR and keep PR1-4 (which are valuable on their own).**

- [ ] **Step 6: Manual verification**

Open the app and test:

- Local shell: type commands, verify output appears.
- SSH: connect to a host, verify fingerprint dialog appears, accept, type commands.
- Serial: connect to a port (if available).
- Docker: exec into a container.
- Copy/paste: Ctrl+C/Ctrl+V.
- Completion: type a command prefix, verify dropdown appears.
- Resize: drag window, verify terminal resizes.
- Theme switch: toggle dark/light.
- Split panes: split 2x1, switch between panes.
- Reconnect: kill the SSH server, verify reconnect on keystroke.

- [ ] **Step 7: Commit**

```bash
git add src/lib/terminalConnection.ts src/components/Terminal/TerminalView.tsx
git commit -m "refactor(terminal): extract terminalConnection (setupConnection factory, ~1000 lines)

High-risk extraction: moves the connection orchestration (Tauri event
wiring, writeQueue, render coalescing, SSH/serial/docker/localshell
connect branches, reconnect logic) from the monster useEffect into a
factory function. TerminalView.tsx drops to ~800 lines.

The factory receives all context via an opts bag (tab, instance,
sessionsRef, t, callbacks for fingerprint/docker picker). The cancelled
flag is internal to the factory. Returns a cleanup handle.

If unstable, revert this commit -- PR1-4 are valuable on their own."
```

---

## PR6: `refactor(css): split global.css into co-located component CSS`

### Task 6.1: Split global.css into ~20 co-located CSS files

**Files:**

- Create: ~20 co-located `.css` files (one per component directory)
- Modify: `src/styles/global.css` (shrink to ≤ 200 lines)
- Modify: ~20 `.tsx` files (add `import './ComponentName.css'`)

**Strategy:** For each section in `global.css`, move it to a co-located `.css` file next to its component, then add an `import './ComponentName.css'` at the top of the component's `.tsx` file. Class names stay the same -- only file locations change.

- [ ] **Step 1: Map global.css sections to component files**

Run this to get the section list with line ranges:

```bash
grep -n "^/\*" src/styles/global.css | head -40
```

Expected mapping (section -> target file):

- TitleBar (71-138) -> `src/components/TitleBar/TitleBar.css`
- Icon Navbar + Sidebar Panel + Session Tree (148-451) -> `src/components/Sidebar/Sidebar.css` + `src/components/Sidebar/SessionPanel.css`
- Tab Bar (461-593) -> `src/components/TabBar/TabBar.css`
- Terminal Container (594-686) -> `src/components/Terminal/TerminalContainer.css`
- Terminal AI dock (687-1123) -> `src/components/Terminal/TerminalAiDock.css`
- Command completion dropdown (1124-1173) -> `src/components/Terminal/CompletionDropdown.css`
- xterm scrollbar (1174-1268) -> `src/components/Terminal/TerminalView.css`
- SFTP Panel + Editor (1269-1925+) -> `src/components/SftpPanel/SftpPanel.css`
- Search Bar (1280-1326) -> `src/components/Terminal/TerminalSearchBar.css`
- Settings Modal -> `src/components/Settings/SettingsModal.css`
- New Session / Docker / Local Terminal / Serial Port Modals -> `src/components/Modals/*.css`
- Asset Table -> `src/components/AssetTable/AssetTable.css`
- Command Palette -> `src/components/CommandPalette/CommandPalette.css`
- Agent Panel -> `src/components/Agent/AgentPanel.css`
- Unlock Screen -> `src/components/UnlockScreen.css`
- Status Bar -> `src/components/StatusBar/StatusBar.css`
- App-root / body / #root / layout shell (1-70) -> STAYS in `global.css`

- [ ] **Step 2: Move each section**

For each section:

1. Create the target `.css` file with the section content (exact CSS, no changes).
2. Delete the section from `global.css`.
3. Add `import './ComponentName.css'` to the component's `.tsx` file (after existing imports, before any JSX).

**Do NOT change any CSS class names, selectors, or property values.** This is a pure file-location move.

- [ ] **Step 3: Keep `global.css` as the base shell**

`global.css` should retain only:

- The header comment + `@import './theme.css'` (if it exists)
- `:root` / `*` / `body` / `#root` base styles
- `#app-root` layout (the flex shell)
- Any truly global utility classes (if any)

Target: ≤ 200 lines.

- [ ] **Step 4: Verify build + smoke + visual**

```bash
npm run build && npm run lint && npm run smoke:check && npm run format:check
```

Open the app and visually verify:

- All panels render correctly (sidebar, tabs, terminal, SFTP, status bar).
- Dark/light theme both look correct.
- No missing styles (blank elements, unstyled buttons).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(css): split global.css into ~20 co-located component CSS files

global.css shrinks from 5981 lines to ~200 (base shell only). Each
component now has a co-located .css file imported by its .tsx, matching
the existing Toast/AssetDashboard/ServerPanel/ConfirmDialog pattern.

No class names or selectors changed -- pure file-location move."
```

---

## PR7: `perf: React.memo + useCallback for list rows and metric cards`

### Task 7.1: Memoize `AssetRow` + stabilize callbacks

**Files:**

- Modify: `src/components/AssetTable/AssetTable.tsx`

- [ ] **Step 1: Read the current AssetTable row rendering**

Read `AssetTable.tsx` to find the `.map((session) => (...))` that renders each row. The row is currently inline JSX.

- [ ] **Step 2: Extract `AssetRow` component + wrap with `React.memo`**

Create an `AssetRow` component (in the same file or a new `AssetRow.tsx`):

```tsx
interface AssetRowProps {
  session: SessionConfig;
  onConnect: (session: SessionConfig) => void;
  onContextMenu: (e: React.MouseEvent, session: SessionConfig) => void;
  onDelete: (session: SessionConfig) => void;
}

const AssetRow = React.memo(function AssetRow({
  session,
  onConnect,
  onContextMenu,
  onDelete,
}: AssetRowProps) {
  // Move the per-row JSX here.
});
```

- [ ] **Step 3: Stabilize callbacks in `AssetTable` with `useCallback`**

```tsx
const handleConnect = useCallback(
  (s: SessionConfig) => {
    // same body as the inline handler
  },
  [/* deps */],
);

const handleContextMenu = useCallback(
  (e: React.MouseEvent, s: SessionConfig) => {
    // same body
  },
  [/* deps */],
);

const handleDelete = useCallback(
  (s: SessionConfig) => {
    // same body
  },
  [/* deps */],
);
```

- [ ] **Step 4: Replace inline `.map` with `<AssetRow>`**

```tsx
{
  groupSessions.map((session) => (
    <AssetRow
      key={session.id}
      session={session}
      onConnect={handleConnect}
      onContextMenu={handleContextMenu}
      onDelete={handleDelete}
    />
  ));
}
```

- [ ] **Step 5: Verify build + lint**

```bash
npm run build && npm run lint && npm run smoke:check
```

- [ ] **Step 6: Commit**

```bash
git add src/components/AssetTable/AssetTable.tsx
git commit -m "perf(asset-table): memoize AssetRow + stabilize callbacks with useCallback"
```

---

### Task 7.2: Memoize `TabItem` + stabilize callbacks

**Files:**

- Modify: `src/components/TabBar/TabBar.tsx`

- [ ] **Step 1: Extract `TabItem` + `React.memo`**

Find the per-tab rendering in `TabBar.tsx` (the `.map((tab) => (...))`). Extract into:

```tsx
const TabItem = React.memo(function TabItem({
  tab,
  isActive,
  onClose,
  onActivate,
  onReorder,
}: TabItemProps) {
  // per-tab JSX
});
```

- [ ] **Step 2: Stabilize callbacks with `useCallback`**

- [ ] **Step 3: Verify + commit**

```bash
npm run build && npm run lint && npm run smoke:check
git add src/components/TabBar/TabBar.tsx
git commit -m "perf(tabbar): memoize TabItem + stabilize callbacks"
```

---

### Task 7.3: Memoize ServerPanel metric cards

**Files:**

- Modify: `src/components/ServerPanel/CpuCard.tsx` (and MemCard, DiskCard, NetCard, NicList, ProcessList)

- [ ] **Step 1: Wrap each metric card with `React.memo`**

For each card component (`CpuCard`, `MemCard`, `DiskCard`, `NetCard`):

```tsx
export const CpuCard = React.memo(function CpuCard({ metrics }: CpuCardProps) {
  // existing body
});
```

This prevents a 2s metrics tick from re-rendering ALL cards when only one changed.

- [ ] **Step 2: Verify + commit**

```bash
npm run build && npm run lint && npm run smoke:check
git add src/components/ServerPanel/
git commit -m "perf(server-panel): memoize metric cards (CpuCard/MemCard/DiskCard/NetCard)"
```

---

### Task 7.4: Verify `SessionRow` memo + stabilize parent callbacks

**Files:**

- Modify: `src/components/Sidebar/SessionPanel.tsx`

- [ ] **Step 1: Verify `SessionRow` is already `React.memo`**

Confirm `SessionRow` at line 345 is wrapped with `React.memo`.

- [ ] **Step 2: Stabilize the callbacks passed to `SessionRow`**

Check that `onConnect` and `onContextMenu` are wrapped in `useCallback` with proper deps. If they're inline, wrap them:

```tsx
const handleConnect = useCallback(
  (s: SessionConfig) => {
    // same body
  },
  [/* deps */],
);
```

- [ ] **Step 3: Verify + commit**

```bash
npm run build && npm run lint && npm run smoke:check
git add src/components/Sidebar/SessionPanel.tsx
git commit -m "perf(session-panel): stabilize callbacks passed to memoized SessionRow"
```

---

### Task 7.5: Final verification + AGENTS.md update

- [ ] **Step 1: Run full CI suite**

```bash
npm run ci:check
cd src-tauri && cargo clippy -- -D warnings && cargo fmt --check && cd ..
```

- [ ] **Step 2: Count React.memo wrappers**

```bash
grep -rn "React.memo\|memo(" src/ --include="*.tsx" --include="*.ts" | wc -l
```

Expected: at least 8 (1 existing SessionRow + 2 new AssetRow/TabItem + 4 metric cards + 1 TabItem).

- [ ] **Step 3: Update AGENTS.md**

Add a note in the "## Architecture notes" section about the TerminalView decomposition:

```markdown
- **TerminalView decomposition**: `TerminalView.tsx` (~800 lines) delegates to:
  `lib/terminalClipboard.ts` (clipboard + shortcut detection),
  `lib/terminalPlatform.ts` (OS info cache),
  `lib/terminalCompletionState.ts` (13 per-tab completion Maps),
  `lib/terminalLifecycle.ts` (fit/resize/cleanup + destroyTerminal + sendInputToTab),
  `lib/terminalConnection.ts` (setupConnection factory). External callers import
  `sendInputToTab`/`destroyTerminal` from `terminalLifecycle`, NOT from `TerminalView`.
```

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "docs: document TerminalView decomposition in AGENTS.md"
```

---

## Self-Review Notes

### Spec coverage

| Spec section                                | Tasks implementing it    |
| ------------------------------------------- | ------------------------ |
| §2.2 Extraction A (terminalClipboard)       | Task 1.2                 |
| §2.3 Extraction B (terminalPlatform)        | Task 1.1                 |
| §2.4 Extraction C (terminalCompletionState) | Task 3.1                 |
| §2.5 Extraction D (terminalLifecycle)       | Tasks 4.1, 4.2           |
| §2.6 Extraction E (overlay components)      | Tasks 2.1, 2.2, 2.3, 2.4 |
| §2.7 Extraction F (terminalConnection)      | Task 5.1                 |
| §3 global.css split                         | Task 6.1                 |
| §4.1 AssetRow memoization                   | Task 7.1                 |
| §4.1 TabItem memoization                    | Task 7.2                 |
| §4.3 ServerPanel cards                      | Task 7.3                 |
| §4.1 SessionRow stabilization               | Task 7.4                 |
| AGENTS.md update                            | Task 7.5                 |

### Type consistency check

- `FingerprintInfo` defined in Task 2.1 `types.ts`, used in Task 2.3 `FingerprintDialog.tsx` and Task 5.1 `terminalConnection.ts` opts. ✅
- `TerminalContextMenuState` defined in Task 2.1, used in Task 2.2. ✅
- `resetCompletionState(tabId: string)` defined in Task 3.1, called in Task 4.1 `destroyTerminal`. ✅
- `sendInputToTab(tabId, data)` moved to Task 4.1, imported by Tasks 4.2 callers. ✅
- `createTerminalConnection(opts)` defined in Task 5.1, called in Task 5.1 useEffect. ✅
- `setSuggestedRendererTypeDom(value: boolean)` defined in Task 4.1, called in Task 4.1 WebGL catch. ✅

### Placeholder scan

The plan uses "Copy exact body from TerminalView.tsx lines X-Y" for function bodies. This is intentional -- the exact code is in the source file and must be copied verbatim (no logic changes). The implementer reads the source file and copies. This is NOT a "TBD" placeholder -- it's a "copy from here" instruction with exact line numbers. The alternative (pasting 1000 lines of code into the plan) would make the plan unreadable and would drift from the source.
