# Technical Debt Wave - Design Spec

**Date:** 2026-07-19
**Status:** Draft (awaiting user review)
**Scope:** Eliminate the three largest technical debts blocking GWShell's evolution: TerminalView.tsx decomposition (2635 -> ~800 lines), global.css split (5981 lines -> co-located), and React performance optimization (1 -> comprehensive memoization). Builds on the quality infrastructure wave (PR #19, merged) which provides lint/test/CI safety net.

---

## 1. Goals & Non-Goals

### 1.1 Goals

1. **Decompose TerminalView.tsx** from 2635 lines to ~800 lines by extracting 6 modules (4 `lib/` files + 3 overlay components + 1 connection orchestrator), following the existing `terminalRegistry.ts` / `terminalContext.ts` module-level Map pattern.
2. **Split global.css** from 5981 lines (100 sections) into co-located per-component CSS files, matching the existing pattern in `Toast/toast.css`, `AssetDashboard/AssetDashboard.css`, `ServerPanel/ServerPanel.css`, `ConfirmDialog/confirm.css`.
3. **Add React performance optimizations**: `React.memo` on list row components (`SessionRow`, `AssetRow`), `useCallback` stabilization on handlers passed to memoized children, virtualization assessment for large lists.

### 1.2 Non-Goals

- New user-visible features (RDP/VNC/recording/plugins/etc.).
- Changing terminal rendering behavior (WebGL lifecycle, theme resolution).
- Changing the IPC contract or backend Rust code.
- a11y focus-trap for all modals (separate spec).
- Metrics poller backoff (separate spec).
- Refactoring other large files (SftpPanel 1217 lines, SettingsModal 1108 lines, NewSessionModal 929 lines) - those are separate specs if needed.

### 1.3 Success Criteria

- `TerminalView.tsx` is ≤ 900 lines (from 2635), with all module-level mutable state moved to extracted `lib/` modules.
- 5 external callers (`SnippetPanel`, `TerminalContainer`, `TerminalAiDock`, `TabBar`, `keymap/actions`) import from new module paths, not from `TerminalView.tsx`.
- `global.css` is ≤ 200 lines (global resets + layout shell only), with all component-specific CSS co-located.
- Every component directory that has a `.tsx` file also has a co-located `.css` file (matching the Toast/AssetDashboard/ServerPanel/ConfirmDialog pattern).
- At least 5 new `React.memo` wrappers on list row components + high-frequency-rerender components.
- All CI gates pass: `npm run lint` (0 violations), `npm run build`, `npm run smoke:check`, `cargo clippy -- -D warnings`, `cargo test`, `cargo fmt --check`.
- No runtime behavior change -- terminal connections, copy/paste, completion, resize, theme switch, split panes all work identically.

---

## 2. Sub-project A - TerminalView Decomposition

### 2.1 Architecture

Follow the existing pattern: `terminalRegistry.ts` (module-level `Map` + type) and `terminalContext.ts` (module-level `Map` + accessor functions). Each extraction is a pure move -- the module-level singletons move to a new file, callers update import paths, no logic changes.

**Dependency order** (leaf modules first):

```
A. terminalClipboard.ts   (leaf - pure functions)
B. terminalPlatform.ts    (leaf - OS info cache)
   ↓
C. terminalCompletionState.ts  (depends on B for PASSWORD_PROMPT_RE)
   ↓
D. terminalLifecycle.ts   (depends on C for tabInputSenders + completion Maps cleanup)
   ↓
E. Overlay components     (leaf - pure JSX)
   ↓
F. terminalConnection.ts  (depends on A, B, C, D - the setupConnection body)
```

### 2.2 Extraction A - `src/lib/terminalClipboard.ts`

**Move from TerminalView.tsx:**
- `PASSWORD_PROMPT_RE` (const regex, line 80)
- `isPasteAction` (function, line 67)
- `writeClipboardText` (function, line 83)
- `readClipboardText` (function, line 93)
- `readTerminalSelection` (function, line 99)
- `isCopyShortcut` (function, line 109) -- imports `isMacPlatform` from B
- `isPasteShortcut` (function, line 121) -- imports `isMacPlatform` from B

**Exposes:** all above as named exports.
**New file:** `src/lib/terminalClipboard.ts`
**Risk:** LOW. Pure functions, no shared mutable state. The only coupling is `isMacPlatform` (from B).

### 2.3 Extraction B - `src/lib/terminalPlatform.ts`

**Move from TerminalView.tsx:**
- `cachedOsInfo` (let, line 135)
- `osInfoPromise` (let, line 136)
- `getOsInfo` (function, line 138)
- `void getOsInfo()` pre-warm IIFE (line 155)
- `isMacPlatform` (function, line 104)
- `webglDebugEnabled` (function, line 176)
- `cellSize` (function, line 250)
- `isInteractiveTerminal` (function, line 239)

**Exposes:** `getOsInfo`, `isMacPlatform`, `webglDebugEnabled`, `cellSize`, `isInteractiveTerminal`.
**New file:** `src/lib/terminalPlatform.ts`
**Risk:** LOW. Module-level cache moves with the functions; pre-warm IIFE fires on import. No behavior change.

### 2.4 Extraction C - `src/lib/terminalCompletionState.ts`

**Move from TerminalView.tsx (13 Maps + 3 Sets + helpers):**
- `inputBuffers` (Map, 207)
- `completionSetters` (Map, 208)
- `completionAccept` (Map, 212)
- `tabCwd` (Map, 214)
- `remoteOsCache` (Map, 219) + `REMOTE_OS_TTL_MS` (const, 220)
- `tabCompletions` (Map, 221)
- `tabCompletionIdx` (Map, 222)
- `completionNav` (Map, 223)
- `tabInputSenders` (Map, 224) -- **stays here** (used by D's `sendInputToTab`)
- `bracketedPaste` (Map, 225)
- `awaitingPassword` (Map, 231)
- `awaitingPasswordTimer` (Map, 234)
- `tabCommandTable` (Map, 237)
- Helpers: `tabScope` (263), `syncTable` (277), `normalizeTable` (287), `estimateDropdownRows` (295)
- `resetCompletionState(tabId)` -- new helper consolidating the per-tab cleanup currently inlined in `destroyTerminal`

**Exposes:** all Maps as direct named exports (same singleton pattern as `terminalRegistry`). Plus `tabScope`, `syncTable`, `normalizeTable`, `estimateDropdownRows`, `resetCompletionState`.
**New file:** `src/lib/terminalCompletionState.ts`
**Risk:** MEDIUM. The Maps are mutated from ~15 call sites inside the monster effect's closures. Moving is mechanically safe (same singletons), but every call site inside `TerminalView.tsx` needs to import from the new module. **Behavior-preserving if done as a pure move** -- do NOT change the API surface in this PR.

### 2.5 Extraction D - `src/lib/terminalLifecycle.ts`

**Move from TerminalView.tsx (8 Maps/Sets/lets + helpers):**
- `connectedTabs` (Set, 159)
- `reconnectableTabs` (Set, 204)
- `tabListenerCleanups` (Map, 188)
- `terminalInteractionCleanups` (Map, 189)
- `fitFrameIds` (Map, 190)
- `settleTimerIds` (Map, 191)
- `pendingBackendResize` (Map, 197)
- `sentFirstResize` (Set, 198)
- `suggestedRendererTypeDom` (let, 165)
- Helpers: `cleanupTabListeners` (305), `cleanupTerminalInteractions` (314), `safeFit` (382), `scheduleTerminalFit` (396), `scheduleTerminalResizeSettle` (406), `forceTerminalRedraw` (440)
- Exported: `destroyTerminal` (333), `sendInputToTab` (324) -- **these are imported by 5 external files**

**External caller import path updates (5 files):**
- `src/components/Sidebar/SnippetPanel.tsx` -- `sendInputToTab` from `TerminalView` -> from `lib/terminalLifecycle`
- `src/components/Terminal/TerminalAiDock.tsx` -- `sendInputToTab` same
- `src/components/TabBar/TabBar.tsx` -- `destroyTerminal` same
- `src/keymap/actions.ts` -- `destroyTerminal` same
- `src/components/Terminal/TerminalContainer.tsx` -- `TerminalView` stays (it's the component, not a helper)

**Exposes:** all above as named exports.
**New file:** `src/lib/terminalLifecycle.ts`
**Risk:** MEDIUM-HIGH. `destroyTerminal` currently cleans up every Map in C and D -- after extraction it must call `resetCompletionState(tabId)` from C. The 5 external callers' import paths change.

### 2.6 Extraction E - Overlay components

**Move JSX from TerminalView.tsx to 3 new components:**

1. `src/components/Terminal/TerminalContextMenu.tsx` (lines 2546-2570, ~25 lines)
   - Props: `{ x, y, canCopy, onCopy, onPaste, onSelectAll, onClear }`
   - Uses `useTranslation` internally (no `t` prop)

2. `src/components/Terminal/FingerprintDialog.tsx` (lines 2572-2603, ~32 lines)
   - Props: `{ info: FingerprintInfo, onAccept: () => void, onReject: () => void }`
   - `FingerprintInfo` type moves to `src/components/Terminal/types.ts`

3. `src/components/Terminal/PasteConfirmDialog.tsx` (lines 2605-2632, ~28 lines)
   - Props: `{ text: string, lineCount: number, onCancel: () => void, onPaste: () => void }`

**New file:** `src/components/Terminal/types.ts` (shared types: `FingerprintInfo`, `TerminalContextMenuState`)
**Risk:** LOW. Pure presentational split, no logic moves.

### 2.7 Extraction F - `src/lib/terminalConnection.ts`

**Move from TerminalView.tsx:**
The `setupConnection` function body (lines ~1291-2335, ~1000 lines) -- the connection orchestration:
- Tauri event wiring (`listen("ssh-data-{id}")`, `listen("ssh-exit-{id}")`, etc.)
- writeQueue with backpressure
- render coalescing (RAF-batched `terminal.write`)
- session logging (`appendTerminalOutput`)
- OSC7 CWD capture
- command-history/completion `onData` tracking
- resize debounce
- SSH connect with fingerprint dialog flow
- serial/docker/localshell connect branches
- reconnect logic

**Design:** factory function returning a cleanup handle:
```typescript
export interface TerminalConnectionHandle {
  cleanup: () => void;
  sendInput: (data: string) => void;
  reconnect: () => Promise<void>;
}

export function createTerminalConnection(opts: {
  tab: TabInfo;
  instance: TerminalInstance;
  sessionsRef: React.MutableRefObject<SessionConfig[]>;
  t: TFunction;
  onFingerprintPrompt: (info: FingerprintInfo) => Promise<boolean>;
  onDockerPick: (containers: DockerContainer[]) => Promise<string | null>;
  onCancelled: () => void;
}): TerminalConnectionHandle
```

**The `cancelled` flag pattern:** the current code uses a local `let cancelled = false` inside the effect, set to `true` in the cleanup function. All async callbacks check `if (cancelled) return` before writing to the terminal. The factory function captures this internally -- `cleanup()` sets `cancelled = true`, and all internal callbacks check it.

**Risk:** HIGH. This is ~1000 lines of tightly-coupled async code. The extraction requires lifting all closure variables (`instance`, `cancelled`, `tab`, `sessionsRef`, `t`, React state setters) into an opts bag. **Must be done last, after A-E are stable and tested.** If anything goes wrong, revert F and keep A-E (which are valuable on their own).

---

## 3. Sub-project B - global.css Split

### 3.1 Strategy

`global.css` (5981 lines, 100 sections) -> co-located per-component CSS. Keep `global.css` as a thin shell (≤ 200 lines) with only:
- CSS reset / base styles
- `:root` / `body` / `#root` layout
- App-level layout (app-root, titlebar, sidebar shell, main content shell)
- Import of `theme.css` (already separate)

### 3.2 Component CSS extraction

Each major section in `global.css` moves to a co-located `.css` file next to its component:

| global.css section (line range) | Target file | ~Lines |
|---|---|---|
| Icon Navbar (148-180) | `src/components/Sidebar/Sidebar.css` | 33 |
| Sidebar Panel (181-306) | `src/components/Sidebar/Sidebar.css` | 126 |
| Session Tree (307-451) | `src/components/Sidebar/SessionPanel.css` | 145 |
| Tab Bar (461-593) | `src/components/TabBar/TabBar.css` | 133 |
| Terminal Container (594-686) | `src/components/Terminal/TerminalContainer.css` | 93 |
| Terminal AI dock (687-1123) | `src/components/Terminal/TerminalAiDock.css` | 437 |
| Command completion dropdown (1124-1173) | `src/components/Terminal/CompletionDropdown.css` | 50 |
| xterm scrollbar (1174-1268) | `src/components/Terminal/TerminalView.css` | 95 |
| Terminal + SFTP Wrapper (1269-1279) | `src/components/SftpPanel/SftpPanel.css` | 11 |
| In-terminal Search Bar (1280-1326) | `src/components/Terminal/TerminalSearchBar.css` | 47 |
| SFTP Panel (1327-1925) | `src/components/SftpPanel/SftpPanel.css` | 599 |
| SFTP Editor (1926-...) | `src/components/SftpPanel/SftpEditor.css` | ~100 |
| Settings Modal (...-...) | `src/components/Settings/SettingsModal.css` | ~200 |
| New Session Modal | `src/components/Modals/NewSessionModal.css` | ~150 |
| Docker Modal | `src/components/Modals/DockerModal.css` | ~80 |
| Local Terminal Modal | `src/components/Modals/LocalTerminalModal.css` | ~60 |
| Serial Port Modal | `src/components/Modals/SerialPortModal.css` | ~70 |
| Asset Table | `src/components/AssetTable/AssetTable.css` | ~120 |
| Asset Dashboard | (already co-located) | - |
| Server Panel | (already co-located) | - |
| Command Palette | `src/components/CommandPalette/CommandPalette.css` | ~60 |
| Agent Panel | `src/components/Agent/AgentPanel.css` | ~150 |
| Unlock Screen | `src/components/UnlockScreen.css` | ~30 |
| Update Checker / Security Notice | (already removed in wave 1) | - |
| Status Bar | `src/components/StatusBar/StatusBar.css` | ~40 |
| Title Bar (71-138) | `src/components/TitleBar/TitleBar.css` | 68 |

**Each co-located CSS file is imported by its component's `.tsx` file** (e.g. `import './TabBar.css'` at the top of `TabBar.tsx`). This matches the existing `Toast/toast.css` + `ToastProvider.tsx` pattern.

### 3.3 Backwards compatibility

- All CSS class names stay the same (only the file location changes).
- No CSS selector changes.
- `global.css` remains imported in `App.tsx` (or `main.tsx`) for the base shell.
- The co-located CSS files are imported by their respective components, so Vite bundles them.

---

## 4. Sub-project C - React Performance

### 4.1 List row memoization

**`SessionRow` (already `React.memo` in `SessionPanel.tsx:345`):**
- Verify the memo comparison is correct (default shallow compare should work).
- Verify the callbacks passed to it (`onConnect`, `onContextMenu`) are stabilized with `useCallback` in the parent.
- If callbacks are inline, wrap them in `useCallback` with proper deps.

**`AssetRow` (new `React.memo`):**
- Extract the per-row JSX in `AssetTable.tsx` (the `.map((session) => ...)` at line 252) into a `AssetRow` component.
- Wrap with `React.memo`.
- Stabilize callbacks (`onConnect`, `onContextMenu`, `onDelete`) with `useCallback` in `AssetTable`.

### 4.2 useCallback stabilization

Audit all callbacks passed to memoized children. The most common pattern to fix:
```tsx
// Before (inline callback - breaks memo):
<SessionRow onConnect={(s) => connect(s)} />

// After (stabilized):
const handleConnect = useCallback((s: SessionConfig) => connect(s), [connect]);
<SessionRow onConnect={handleConnect} />
```

### 4.3 High-frequency-rerender components

- `StatusBar` -- re-renders on every tab switch, latency ping, metrics tick. Check if it can be memoized.
- `TabBar` tab items -- re-render on every tab switch. Extract `TabItem` + `React.memo`.
- `ServerPanel` metric cards -- re-render every 2s on metrics tick. Each card (`CpuCard`, `MemCard`, etc.) should be `React.memo` so only the changed card re-renders.

### 4.4 Virtualization assessment

- `AssetTable` (317 lines, non-virtualized) -- 500+ hosts will be slow. **Assess** `@tanstack/react-virtual` (already a dep for SFTP file list). If the row height is fixed, add virtualization. If variable (group headers), defer.
- `SessionPanel` session tree (295 lines, non-virtualized) -- typically < 50 sessions, likely fine without virtualization. Note in code comment.

---

## 5. Build Sequencing

Strict order -- each PR is independently reviewable and shippable:

1. **PR1: `refactor(terminal): extract terminalClipboard + terminalPlatform`** (Extractions A+B, low risk). ~250 lines out of TerminalView. 2 new `lib/` files. No external caller changes.

2. **PR2: `refactor(terminal): extract overlay components`** (Extraction E, low risk). ~85 lines of JSX out. 3 new components + 1 types file. No external caller changes.

3. **PR3: `refactor(terminal): extract terminalCompletionState`** (Extraction C, medium risk). ~400 lines out. 1 new `lib/` file. 13 Maps move. Internal import updates only (no external callers).

4. **PR4: `refactor(terminal): extract terminalLifecycle + update external callers`** (Extraction D, medium-high risk). ~250 lines out. 1 new `lib/` file. 5 external caller import paths change.

5. **PR5: `refactor(terminal): extract terminalConnection`** (Extraction F, high risk). ~1000 lines out. 1 new `lib/` file. TerminalView drops to ~800 lines. **Revert if unstable.**

6. **PR6: `refactor(css): split global.css into co-located component CSS`** (Sub-project B). ~5800 lines move from `global.css` to ~20 co-located `.css` files. `global.css` shrinks to ≤ 200 lines.

7. **PR7: `perf: React.memo + useCallback for list rows and metric cards`** (Sub-project C). 5+ new `React.memo` wrappers. `AssetRow` extraction. `TabItem` extraction. ServerPanel card memoization.

PR1-2 are independent and can land in parallel. PR3 depends on PR1 (C imports from A). PR4 depends on PR3 (D calls `resetCompletionState` from C). PR5 depends on PR4. PR6-7 are independent of PR1-5 but should land after (so the codebase is stable).

---

## 6. Testing Strategy

### 6.1 What's tested

| Layer | Coverage |
|---|---|
| Existing Rust tests (170) | Unchanged - no backend changes. |
| Existing Node tests (3 scripts) | Unchanged. |
| Smoke check (6 checks) | Enforces IPC parity, i18n parity, event-name parity, capabilities allowlist, no-window-confirm. |
| ESLint (0 violations) | Enforces no `any`, no `as` casts without disable-comment + reason, no floating promises. |
| Manual verification | Terminal connect (SSH/local/serial/docker), copy/paste, completion dropdown, resize, theme switch, split panes, SFTP, context menu, fingerprint dialog, paste confirm. |

### 6.2 What's NOT tested (acknowledged gaps)

- No unit tests for the extracted modules (they're pure moves of untested code). Adding tests is a separate effort.
- No E2E tests for terminal behavior. Manual verification is the gate.
- No visual regression tests for CSS split (class names don't change, so it should be identical).

### 6.3 Verification checklist (per PR)

After each PR:
- `npm run lint` (0 violations)
- `npm run build` (tsc + vite)
- `npm run smoke:check` (6 checks)
- `npm run format:check`
- `cd src-tauri && cargo clippy -- -D warnings && cargo fmt --check && cd ..` (unchanged, but verify no breakage)
- Manual: open app, connect to a session, type commands, copy/paste, resize window, switch theme, split panes.

---

## 7. Risk & Rollback

| Risk | Mitigation |
|---|---|
| Extraction F (terminalConnection) breaks terminal behavior | PR5 is revertible independently of PR1-4. If F is unstable, revert just PR5 and keep A-E. |
| CSS split causes visual regression | All class names stay the same; only file locations change. Vite bundles them identically. Manual visual check per PR6. |
| `React.memo` causes stale UI (memo too aggressive) | Use default shallow compare. If a row shows stale data, the callback dep array is wrong -- fix the `useCallback` deps, don't remove the memo. |
| External caller import path breaks (PR4) | CI's `smoke:check` + `tsc` catch missing imports. The 5 callers are known. |
| Module-level state initialization order | The pre-warm IIFE in `terminalPlatform.ts` fires on import. As long as `TerminalView.tsx` imports the new modules, the IIFE runs. Verify with a `console.log` during dev. |

---

## 8. Out of Scope (explicit reminders)

- SftpPanel.tsx (1217 lines) decomposition - separate spec.
- SettingsModal.tsx (1108 lines) decomposition - separate spec.
- NewSessionModal.tsx (929 lines) decomposition - separate spec.
- a11y focus-trap for modals - separate spec.
- Metrics poller exponential backoff - separate spec.
- All README "Planned" features - separate specs.
- Adding unit tests for extracted terminal modules - separate effort.

---

## 9. References

- Structural analysis (this session): `src/components/Terminal/TerminalView.tsx` deep-dive by Explore agent.
- Existing module pattern: `src/components/Terminal/terminalRegistry.ts`, `src/lib/terminalContext.ts`.
- Existing co-located CSS pattern: `src/components/Toast/toast.css`, `src/components/AssetDashboard/AssetDashboard.css`.
- Quality infrastructure wave (merged): PR #19, spec at `docs/superpowers/specs/2026-07-05-quality-infrastructure-wave-design.md`.
