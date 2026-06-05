# SSH Command History & Inline Autocomplete — Design Spec

**Date:** 2026-06-05  
**Status:** Approved

---

## Scope

SSH sessions only. All other session types (localshell, serial, sftp) are excluded.

---

## Feature Summary

1. **History recording** — every command sent to an SSH session is persisted to SQLite.
2. **Inline ghost text** — as the user types, a dimmed suffix shows the most-recently-matching historical command. Press `→` or `Tab` to accept.

---

## Data Layer

### SQLite table (added in `database.rs` → `init_tables`)

```sql
CREATE TABLE IF NOT EXISTS command_history (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    command TEXT NOT NULL,
    ts      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cmd_ts ON command_history(ts DESC);
```

### New Rust module: `src-tauri/src/history.rs`

Two public functions consumed by `lib.rs`:

- `load_history(conn, limit: u32) -> Vec<String>`  
  `SELECT DISTINCT command … ORDER BY MAX(ts) DESC LIMIT limit`  
  Returns newest-first deduplicated commands.

- `save_command(conn, command: &str)`  
  `INSERT INTO command_history (command, ts) VALUES (?, ?)`.  
  If total row count exceeds 10 000, delete the oldest batch to cap table size.

### Tauri commands registered in `lib.rs`

| Command | Signature |
|---|---|
| `get_command_history` | `(limit: u32) -> Result<Vec<String>, String>` |
| `save_command_history` | `(command: String) -> Result<(), String>` |

---

## Frontend History Module: `src/lib/commandHistory.ts`

```typescript
let history: string[] = [];  // oldest→newest in memory

export async function init(limit: number): Promise<void>
export function record(command: string): void        // fire-and-forget invoke
export function getSuggestion(prefix: string): string // '' if no match
```

- `init` loads from backend (newest-first from DB → reverse to oldest-first in array).
- `record` pushes to local array and calls `invoke('save_command_history')` without await.
- `getSuggestion` scans from newest end, returns `history[i].slice(prefix.length)` for the first entry that starts with `prefix` and is longer than `prefix`.

---

## Command Capture (TerminalView.tsx)

### Module-level maps (alongside existing `tabListenerCleanups` etc.)

```typescript
const inputBuffers      = new Map<string, string>();            // tabId → current line buffer
const ghostTextState    = new Map<string, string>();            // tabId → current ghost suffix
const ghostTextSetters  = new Map<string, (g: string) => void>(); // tabId → React setState
const ghostAcceptCallbacks = new Map<string, (s: string) => void>(); // tabId → send-to-backend
```

### onData interception (SSH tabs only, inside `setupConnection`)

Added at the top of the existing `onData` handler, before `writeQueue += data`:

| Received `data` | Action |
|---|---|
| `\r` or `\n` | If buffer non-empty, call `record(buf.trim())`; clear buffer + ghost text |
| `\x7f` (Backspace) | Remove last char from buffer |
| `\x15` (Ctrl+U) | Clear buffer and ghost text |
| `\x1b…` (ESC sequences, arrow keys) | Clear ghost text only; do not modify buffer |
| Printable ASCII (`≥ 0x20`, single char) | Append to buffer; recompute ghost text via `getSuggestion(buf)` |
| Other control characters | Pass through unchanged |

After every buffer mutation, update `ghostTextState` and call the registered setter.

After interception, the original `writeQueue += data` path runs unchanged — backend communication is unaffected.

### Ghost text acceptance (attachCustomKeyEventHandler)

Prepended to the existing copy/paste handler block. Applies only when `tab.type === 'ssh'`:

```
if Tab or ArrowRight pressed AND ghostTextState.get(tab.id) is non-empty:
  suffix = ghostTextState.get(tab.id)
  update inputBuffers[tab.id] += suffix
  clear ghostTextState[tab.id] and call setter('')
  call ghostAcceptCallbacks[tab.id](suffix)   // writes suffix to backend
  return false   // suppress xterm default handling
```

`ghostAcceptCallbacks` is registered in `setupConnection` and has access to `writeQueue` + `scheduleWriteFlush`.

### Cleanup

`destroyTerminal(tabId)` extended to delete from all four new maps.

---

## Ghost Text Overlay (TerminalView.tsx JSX)

A `position: absolute` div rendered as a sibling to the xterm canvas, inside the existing `position: relative` terminal container:

```tsx
{ghostText && isActive && settings.terminalCmdHint && (
  <div
    className="terminal-ghost-text"
    style={{
      left: `calc(${cursorX} * var(--cell-w))`,
      top:  `calc(${cursorY} * var(--cell-h))`,
      pointerEvents: 'none',
    }}
  />
)}
```

`cursorX` / `cursorY` are stored as React state (`useState<{x:number,y:number}>`) and updated together with `ghostText` whenever the ghost text setter fires — reading `terminal.buffer.active.cursorX/Y` at that moment ensures the position is current.

`--cell-w` and `--cell-h` CSS variables are set on the container element inside the ResizeObserver callback:

```typescript
const cellW = container.clientWidth  / terminal.cols;
const cellH = container.clientHeight / terminal.rows;
container.style.setProperty('--cell-w', `${cellW}px`);
container.style.setProperty('--cell-h', `${cellH}px`);
```

Color: `--ghost-text-color` — `#555570` for dark theme, `#aaaaaa` for light theme (registered alongside existing theme color tokens).

Font family and size mirror the terminal's settings so the overlay aligns with the xterm grid.

---

## Configuration

All three settings already exist in the UI; this implementation makes them functional:

| Setting | Effect |
|---|---|
| `sshHistoryCmd` | Master toggle; `false` skips all interception and ghost text |
| `sshHistoryCmdLoadCount` | Passed as `limit` to `commandHistory.init()` (default `100`) |
| `terminalCmdHint` | Controls ghost text rendering; history still records when `false` |

---

## Initialization Flow

**App startup** (`App.tsx`, single `useEffect` with empty deps):

```typescript
if (settings.sshHistoryCmd) {
  commandHistory.init(parseInt(settings.sshHistoryCmdLoadCount) || 100);
}
```

**Settings change** (`settingsStore.save()`):

```typescript
if (s.sshHistoryCmd) {
  commandHistory.init(parseInt(s.sshHistoryCmdLoadCount) || 100);
}
```

This reloads the in-memory array whenever the user changes the count or re-enables the feature.

---

## Files Changed

| File | Type |
|---|---|
| `src-tauri/src/history.rs` | New |
| `src-tauri/src/database.rs` | Modified — add table + index in `init_tables` |
| `src-tauri/src/lib.rs` | Modified — `mod history`, two Tauri commands (receive `state: State<AppState>`, call `state.db`) |
| `src/lib/commandHistory.ts` | New |
| `src/components/Terminal/TerminalView.tsx` | Modified — interception logic, ghost overlay, cleanup |
| `src/App.tsx` | Modified — startup `init()` call |
| `src/stores/settingsStore.ts` | Modified — `save()` triggers `init()` |
