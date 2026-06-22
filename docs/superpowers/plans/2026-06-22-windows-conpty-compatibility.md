# Windows ConPTY Terminal Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Windows terminal TUI rendering issues (Claude Code, Codex CLI) by aligning xterm.js ConPTY configuration with VSCode's terminal implementation.

**Architecture:** Frontend-only changes across 2 files. Pass real Windows build number to xterm.js, enable win32InputMode for local ConPTY sessions, register a DA1 response handler, and enhance resize/switch-back redraw logic. All Windows-specific changes are guarded by `usesLocalConpty` — SSH/serial/non-Windows are unaffected.

**Tech Stack:** React, xterm.js 6.x, TypeScript strict mode. Verification via `npm run build` (tsc + vite) and `npm run smoke:check` — the repo has no first-party test runner.

---

## File Structure

- Modify: `src/lib/terminalPtyOptions.ts` — remove build clamp, pass real buildNumber
- Modify: `src/components/Terminal/TerminalView.tsx` — win32InputMode, DA1 handler, double-refresh, alt-screen toggle

## Context for the implementer

- `usesLocalConpty()` is a closure defined inside `TerminalView`'s `initTerminal` effect (around line 547). It returns `true` only for `localshell` tabs and `docker` tabs whose `docker_connect_method` is not `ssh`. SSH and serial always return `false`.
- `getXtermWindowsPty(osInfo, usesLocalConpty())` is called at line 555 to set `termOpts.windowsPty`.
- `forceTerminalRedraw` (line 368) is called after reparenting and resize-settle. It does `fitAddon.fit()` + `clearTextureAtlas()` + `refresh(0, rows-1)` + re-issues `resize_pty`/`resize_ssh`.
- `tabListenerCleanups` (a `Map<string, () => void>`) stores cleanup functions per tab, executed on remount/close. Set at line ~1414.
- `sendInputToTab(tabId, data)` (line 262) sends raw bytes to a tab's PTY input queue.
- xterm.js `allowProposedApi: true` is already set in `termOpts` (line 538), so `vtExtensions` and `parser.registerCsiHandler` are available.
- `wasReparented` (line 598) is `true` when the xterm element was moved to a new container (split toggle, tab switch). `wasFreshlyOpened` (line 599) is `true` when the terminal was just created.

---

## Task 1: Pass real Windows build number to xterm.js

**Files:**
- Modify: `src/lib/terminalPtyOptions.ts`

- [ ] **Step 1: Rewrite `terminalPtyOptions.ts`**

Replace the entire file content. Remove `normalizeConptyBuildForXterm` and `XTERM_CONPTY_SAFE_REFLOW_BUILD`. `getXtermWindowsPty` now returns the real build number, or `undefined` if the build is not a valid number.

```ts
export interface TerminalOsInfo {
  os: string;
  windowsBuild?: number;
}

export interface XtermWindowsPtyOptions {
  backend: "conpty";
  buildNumber: number;
}

/**
 * Returns xterm.js windowsPty compatibility metadata for local ConPTY
 * sessions. Passes the real Windows build number so xterm.js can apply the
 * correct ConPTY heuristics (reflow disabling, wrapping assumptions) based on
 * its own build-number thresholds. Returns undefined for non-Windows, non-PTY
 * sessions, or when the build number is unknown.
 */
export function getXtermWindowsPty(
  osInfo: TerminalOsInfo,
  usesLocalConpty: boolean,
): XtermWindowsPtyOptions | undefined {
  if (!usesLocalConpty || osInfo.os !== "windows") return undefined;

  const build = osInfo.windowsBuild;
  if (typeof build !== "number" || !Number.isFinite(build)) return undefined;

  return {
    backend: "conpty",
    buildNumber: Math.trunc(build),
  };
}
```

- [ ] **Step 2: Check for remaining references to removed exports**

Run a search for `normalizeConptyBuildForXterm` and `XTERM_CONPTY_SAFE_REFLOW_BUILD` across the codebase. If any references remain, remove them.

Run: `grep -rn "normalizeConptyBuildForXterm\|XTERM_CONPTY_SAFE_REFLOW_BUILD" src/`
Expected: no matches (or only the now-deleted definitions).

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS (tsc strict + vite). If tsc reports unused imports in `TerminalView.tsx` referencing the removed functions, remove those imports.

- [ ] **Step 4: Commit**

```bash
git add src/lib/terminalPtyOptions.ts
git commit -m "fix: pass real windows build number to xterm.js for conpty heuristics"
```

---

## Task 2: Enable win32InputMode for local ConPTY sessions

**Files:**
- Modify: `src/components/Terminal/TerminalView.tsx`

- [ ] **Step 1: Add `vtExtensions` to `termOpts`**

In `TerminalView.tsx`, inside the `initTerminal` async function, find the `termOpts` object (around line 521-541). The object includes `allowProposedApi: true` and `copyOnSelect: false`. After the `windowsPty` assignment (line 556), add the `vtExtensions` option conditionally.

Find this code (around line 555-556):

```ts
        const windowsPty = getXtermWindowsPty(osInfo, usesLocalConpty());
        if (windowsPty) termOpts.windowsPty = windowsPty;
```

Add after it:

```ts
        // Enable Win32 INPUT_RECORD keyboard encoding (DECSET 9001) for local
        // ConPTY sessions. ConPTY's default VT encoding is lossy with complex
        // modifier keys (Ctrl+Shift+letter, Alt+arrows); win32InputMode lets
        // TUI apps like Claude Code / Codex receive complete keyboard events.
        // The option is opt-in: if the application doesn't request CSI ? 9001 h,
        // there is no effect. SSH/serial sessions are excluded — their PTY is
        // on a remote Unix host and never touches ConPTY.
        if (usesLocalConpty()) {
          (termOpts as Record<string, unknown>).vtExtensions = { win32InputMode: true };
        }
```

Note: `termOpts` is typed as `Record<string, unknown>`, so the cast is safe. If tsc complains, use the cast shown above.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/Terminal/TerminalView.tsx
git commit -m "feat: enable win32InputMode for local conpty sessions"
```

---

## Task 3: Register DA1 response handler for ConPTY

**Files:**
- Modify: `src/components/Terminal/TerminalView.tsx`

- [ ] **Step 1: Register the DA1 CSI handler after terminal open**

In `TerminalView.tsx`, inside the `initTerminal` function, find the WebGL renderer attachment block (around line 888-896). After that block (after `instance.rendererLost = false; } catch {}`), and before the "Immediate fit attempt" comment (line 898), add the DA1 handler registration.

Insert this code:

```ts
      // ConPTY 1.22+ sends a DA1 request (CSI c) at startup and waits for a
      // terminal response before continuing to render. If we don't respond,
      // ConPTY waits for a timeout, causing TUI apps (Claude Code, Codex) to
      // appear frozen on launch. Register a CSI handler that responds
      // immediately with VT220-level device attributes. Only for local ConPTY
      // sessions — SSH/serial PTYs don't go through ConPTY.
      if (usesLocalConpty()) {
        try {
          const da1Dispose = instance.terminal.parser.registerCsiHandler({ final: 'c' }, (params) => {
            if (params.length === 0 || (params.length === 1 && params[0] === 0)) {
              instance.terminal.write('\x1b[?61;4c');
              return true;
            }
            return false;
          });
          // Store dispose alongside the other per-tab cleanups so it's torn
          // down on remount/close (added to tabListenerCleanups later).
          pendingDisposes.push(da1Dispose);
        } catch {}
      }
```

- [ ] **Step 2: Add the `pendingDisposes` array**

The `pendingDisposes` array collects dispose functions that need to be cleaned up with the tab's listeners. Find where `tabListenerCleanups.set(tab.id, () => {` is called (around line 1414). Just before that line, there should be a place where other dispose functions are collected.

Find this existing pattern (around line 1439-1441):

```ts
        try { dataDispose.dispose(); } catch {}
        try { resizeDispose?.dispose(); } catch {}
        try { osc7Dispose.dispose(); } catch {}
```

Add `pendingDisposes` as a local array declared near the top of the `setupConnection` function (before the listener setup). Find a suitable spot — after the `cleanupTabListeners(tab.id);` call (around line 985), add:

```ts
      const pendingDisposes: Array<{ dispose(): void }> = [];
```

Then, in the cleanup function (inside `tabListenerCleanups.set`), add before the existing dispose calls:

```ts
        for (const d of pendingDisposes) { try { d.dispose(); } catch {} }
```

This should go right before the `try { dataDispose.dispose(); } catch {}` line.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS (tsc strict + noUnusedLocals). If `pendingDisposes` is flagged as unused, ensure it's referenced in the cleanup block.

- [ ] **Step 4: Commit**

```bash
git add src/components/Terminal/TerminalView.tsx
git commit -m "feat: register DA1 response handler for conpty startup"
```

---

## Task 4: Enhanced resize/switch redraw for ConPTY

**Files:**
- Modify: `src/components/Terminal/TerminalView.tsx`

- [ ] **Step 1: Add double-refresh to `forceTerminalRedraw`**

Find `forceTerminalRedraw` (line 368-391). After the existing `try { inst.terminal.refresh(0, inst.terminal.rows - 1); } catch {}` (line 381), add a deferred second refresh via `requestAnimationFrame`:

Replace lines 379-381:

```ts
  try { inst.fitAddon.fit(); } catch {}
  try { inst.terminal.clearTextureAtlas(); } catch {}
  try { inst.terminal.refresh(0, inst.terminal.rows - 1); } catch {}
```

With:

```ts
  try { inst.fitAddon.fit(); } catch {}
  try { inst.terminal.clearTextureAtlas(); } catch {}
  try { inst.terminal.refresh(0, inst.terminal.rows - 1); } catch {}

  // ConPTY redraws asynchronously after receiving SIGWINCH. The first refresh
  // clears the stale glyph atlas; this deferred second pass catches ConPTY's
  // asynchronous repaint, eliminating ghost cells in TUI apps.
  const term = inst.terminal;
  requestAnimationFrame(() => {
    try { term.clearTextureAtlas(); } catch {}
    try { term.refresh(0, term.rows - 1); } catch {}
  });
```

- [ ] **Step 2: Add alt-screen toggle on reparent for ConPTY sessions**

Find the reparenting block in `initTerminal` (around line 924-933):

```ts
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (wasReparented) {
            forceTerminalRedraw(tab.id, tab.sessionId, tab.type);
          } else {
            scheduleTerminalFit(tab.id);
            scheduleTerminalResizeSettle(tab.id, tab.sessionId, tab.type, 80);
          }
        });
      });
```

Replace with:

```ts
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (wasReparented) {
            forceTerminalRedraw(tab.id, tab.sessionId, tab.type);
            // For local ConPTY sessions, force ConPTY to re-send the current
            // screen content by toggling alt-screen mode. \x1b[?1049h enters
            // alt-screen (saving current screen), \x1b[?1049l exits (restoring)
            // — the net effect is a full repaint. Unsupported terminals ignore
            // these sequences safely.
            if (usesLocalConpty()) {
              sendInputToTab(tab.id, '\x1b[?1049h\x1b[?1049l');
            }
          } else {
            scheduleTerminalFit(tab.id);
            scheduleTerminalResizeSettle(tab.id, tab.sessionId, tab.type, 80);
          }
        });
      });
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/Terminal/TerminalView.tsx
git commit -m "feat: enhanced resize and switch-back redraw for conpty"
```

---

## Task 5: Verification

**Files:** All modified files.

- [ ] **Step 1: Run frontend build**

Run: `npm run build`
Expected: PASS (tsc strict + vite build).

- [ ] **Step 2: Run smoke check**

Run: `npm run smoke:check`
Expected: PASS — 49 frontend invokes / 83 backend commands, settings store consumers ok.

- [ ] **Step 3: Run Rust check**

Run: `cd src-tauri; cargo check`
Expected: PASS — no backend files touched.

- [ ] **Step 4: Run `git diff --check`**

Run: `git diff --check`
Expected: no whitespace errors.

- [ ] **Step 5: Manual verification (requires Windows machine)**

Run: `npm run tauri dev`

Confirm on Windows:
1. Open local shell, run `claude` or `codex`, confirm TUI renders correctly (no ghost cells, cursor positioned right, status bars visible)
2. Resize window while TUI is running, confirm correct repaint (no stale content)
3. Switch to another tab and back, confirm TUI screen fully restores
4. Use Ctrl+Shift+arrows, Alt+keys in TUI, confirm modifier keys work
5. Confirm SSH/serial sessions behave identically to before (no regression)

- [ ] **Step 6: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: polish conpty compatibility"
```

---

## Self-Review

- **Spec coverage:** Task 1 = real build number (spec §1). Task 2 = win32InputMode (spec §2). Task 3 = DA1 handler (spec §3). Task 4 = double-refresh + alt-screen toggle (spec §4). All spec sections covered.
- **Placeholder scan:** No TBD/TODO. All code blocks are complete. The `pendingDisposes` pattern is fully defined in Task 3 (declaration + usage + cleanup).
- **Type consistency:** `usesLocalConpty()` is used consistently across Tasks 2-4. `sendInputToTab(tab.id, data)` matches the existing export signature. `termOpts` cast to `Record<string, unknown>` is consistent with its existing declaration.
