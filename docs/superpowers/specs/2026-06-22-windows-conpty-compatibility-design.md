# Windows ConPTY Terminal Compatibility Design

## Goal

Fix Windows terminal TUI rendering issues (Claude Code, Codex CLI) by aligning xterm.js ConPTY configuration with VSCode's terminal implementation.

## Problem

On Windows, Claude Code / Codex CLI exhibit three issues in GWShell's terminal:

1. **TUI rendering corruption** — cursor jumps, line misalignment, ghost cells, missing status bars
2. **No redraw after resize/tab-switch** — TUI apps don't repaint when the terminal is resized or focused again
3. **Keyboard input anomalies** — modifier key combinations (Ctrl+Shift+letter, Alt+arrows) are lost or garbled

## Root Causes (vs VSCode)

| Issue | GWShell current | VSCode approach |
|---|---|---|
| TUI rendering | `buildNumber` clamped to ≥21376, disabling xterm.js wrapping heuristics even on old builds | Passes real build number; lets xterm.js decide heuristics |
| Keyboard input | No `win32InputMode` enabled | `vtExtensions: { win32InputMode: true }` — ConPTY uses Win32 INPUT_RECORD encoding |
| Startup delay | No DA1 response handler | Registers CSI 'c' handler responding `\x1b[?61;4c` to avoid ConPTY 1.22+ timeout |
| Resize/switch redraw | Single `clearTextureAtlas` + `refresh` | Double-refresh via rAF + alt-screen toggle sequence for ConPTY |

## Scope

Frontend-only changes. No backend PTY changes, no new dependencies. All Windows-specific behavior is guarded by `usesLocalConpty` — SSH, serial, and non-Windows sessions are completely unaffected.

## Changes

### 1. Pass real Windows build number to xterm.js

**File:** `src/lib/terminalPtyOptions.ts`

Remove the `normalizeConptyBuildForXterm` clamp and `XTERM_CONPTY_SAFE_REFLOW_BUILD` constant. `getXtermWindowsPty` returns the real `osInfo.windowsBuild` value. If the build is not a valid number, return `undefined` (no `windowsPty` set), letting xterm.js use its default behavior.

xterm.js uses `buildNumber` to decide: `if !(backend === 'conpty' && buildNumber >= 21376)` — reflow is disabled and lines are assumed wrapped if the last character is not whitespace. Passing the real build lets this heuristic work correctly on all Windows versions.

### 2. Enable win32InputMode for local ConPTY sessions

**File:** `src/components/Terminal/TerminalView.tsx`

In the `termOpts` object (where `allowProposedApi: true` is already set), add:

```ts
vtExtensions: usesLocalConpty() ? { win32InputMode: true } : undefined,
```

This enables DECSET 9001 (Win32 INPUT_RECORD keyboard encoding). ConPTY will encode keyboard events using the Windows-native INPUT_RECORD format instead of lossy VT sequences, preserving modifier keys. The option is opt-in: if an application doesn't request `CSI ? 9001 h`, there is no effect.

Only enabled when `usesLocalConpty()` returns true (localshell, or docker-over-local-PTY). SSH and serial sessions are excluded — their PTY is on a remote Unix host and never touches ConPTY.

### 3. Register DA1 response handler for ConPTY

**File:** `src/components/Terminal/TerminalView.tsx`

After the terminal is opened and attached, when `usesLocalConpty()` is true, register a CSI handler:

```ts
const da1Dispose = terminal.parser.registerCsiHandler({ final: 'c' }, (params) => {
  if (params.length === 0 || (params.length === 1 && params[0] === 0)) {
    terminal.write('\x1b[?61;4c');  // VT220 level, 4-color support
    return true;
  }
  return false;
});
```

This intercepts ConPTY 1.22+'s DA1 (Device Attributes) request and responds immediately, preventing a startup timeout where ConPTY waits for a terminal response before continuing to render.

The handler dispose function is added to `tabListenerCleanups` so it's cleaned up on tab close/remount. Only the empty-params or `[0]` case is handled — other CSI 'c' sequences pass through unchanged.

### 4. Enhanced resize/switch redraw for ConPTY

**File:** `src/components/Terminal/TerminalView.tsx`

Two enhancements to `forceTerminalRedraw`:

**a) Double-refresh via requestAnimationFrame:**

After the existing `clearTextureAtlas()` + `refresh(0, rows-1)`, schedule a second pass:

```ts
requestAnimationFrame(() => {
  try { terminal.clearTextureAtlas(); } catch {}
  try { terminal.refresh(0, terminal.rows - 1); } catch {}
});
```

ConPTY redraws asynchronously after receiving SIGWINCH. The first refresh clears the stale atlas; the rAF refresh catches ConPTY's asynchronous repaint, eliminating ghost cells.

**b) Alt-screen toggle on reparent/switch-back:**

When `wasReparented` is true and `usesLocalConpty()` is true, after `forceTerminalRedraw`, send an alt-screen toggle sequence to the PTY:

```ts
sendInputToTab(tab.id, '\x1b[?1049h\x1b[?1049l');
```

This forces ConPTY to re-send the current screen content. `\x1b[?1049h` enters alt-screen (saving the current screen), `\x1b[?1049l` exits (restoring it) — the net effect is a full repaint. Unsupported terminals ignore these sequences safely.

Both enhancements are guarded by `usesLocalConpty()` — SSH and serial sessions use the existing single-refresh path unchanged.

## Files

- Modify: `src/lib/terminalPtyOptions.ts` — remove build clamp, pass real buildNumber
- Modify: `src/components/Terminal/TerminalView.tsx` — win32InputMode, DA1 handler, double-refresh, alt-screen toggle
- No new files, no backend changes, no i18n changes

## Verification

- `npm run build` (tsc strict + noUnusedLocals) — type check, no unused code after removing `normalizeConptyBuildForXterm`
- `npm run smoke:check` — IPC registry unchanged
- `cd src-tauri; cargo check` — backend unaffected
- **Windows manual testing:**
  1. Open local shell, run `claude` or `codex`, confirm TUI renders correctly (no ghost cells, cursor positioned right)
  2. Resize window while TUI is running, confirm correct repaint (no stale content)
  3. Switch to another tab and back, confirm TUI screen fully restores
  4. Use Ctrl+Shift+arrows, Alt+keys in TUI, confirm modifier keys work
  5. Confirm SSH/serial sessions behave identically to before (no regression)

## Risk Control

- All Windows-specific changes guarded by `usesLocalConpty()` — SSH/serial/non-Windows completely unaffected
- `win32InputMode` is opt-in — no effect unless application requests `CSI ? 9001 h`
- DA1 handler only intercepts empty-params `CSI c` — other sequences pass through
- Alt-screen toggle `\x1b[?1049h\x1b[?1049l` is standard VT — unsupported terminals ignore it
- Real `buildNumber` only affects xterm.js heuristic decisions, doesn't break anything
