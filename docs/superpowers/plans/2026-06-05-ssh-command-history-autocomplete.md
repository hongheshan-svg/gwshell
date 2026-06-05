# SSH Command History & Inline Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist SSH terminal commands to SQLite and show inline ghost-text suggestions as the user types.

**Architecture:** Frontend intercepts keystrokes in the xterm `onData` handler (SSH tabs only), maintains a line buffer, calls the `commandHistory` module for suggestions, and renders a positioned overlay div. History is stored in a new `command_history` SQLite table via two new Tauri commands.

**Tech Stack:** Rust/rusqlite (backend), React/TypeScript/xterm.js (frontend), Tauri 2 IPC.

---

## File Map

| File | Action |
|---|---|
| `src-tauri/src/history.rs` | New — pure SQL logic for load/save |
| `src-tauri/src/database.rs` | Modify — add table migration + two wrapper methods |
| `src-tauri/src/lib.rs` | Modify — `mod history`, two Tauri commands, register in handler |
| `src/lib/commandHistory.ts` | New — in-memory history + IPC wrapper |
| `src/App.tsx` | Modify — call `commandHistory.init()` after settings load |
| `src/stores/settingsStore.ts` | Modify — re-init on `save()` |
| `src/components/Terminal/TerminalView.tsx` | Modify — maps, onData interception, key handler, ghost overlay |
| `src/styles/global.css` | Modify — `.terminal-ghost-text` style |

---

## Task 1: SQLite migration — add `command_history` table

**Files:**
- Modify: `src-tauri/src/database.rs:31-48`

- [ ] **Step 1: Extend `init_tables` SQL to include the new table and index**

  Replace the `execute_batch` string in `init_tables` (lines 33-46):

  ```rust
      fn init_tables(&self) -> Result<(), String> {
          let conn = self.conn.lock().map_err(|e| e.to_string())?;
          conn.execute_batch(
              "CREATE TABLE IF NOT EXISTS sessions (
                  id TEXT PRIMARY KEY,
                  data TEXT NOT NULL
              );
              CREATE TABLE IF NOT EXISTS groups (
                  name TEXT PRIMARY KEY,
                  data TEXT NOT NULL
              );
              CREATE TABLE IF NOT EXISTS app_settings (
                  key TEXT PRIMARY KEY,
                  value TEXT NOT NULL
              );
              CREATE TABLE IF NOT EXISTS command_history (
                  id      INTEGER PRIMARY KEY AUTOINCREMENT,
                  command TEXT NOT NULL,
                  ts      INTEGER NOT NULL
              );
              CREATE INDEX IF NOT EXISTS idx_cmd_ts ON command_history(ts DESC);",
          )
          .map_err(|e| e.to_string())
      }
  ```

- [ ] **Step 2: Verify Rust compiles**

  ```bash
  cd src-tauri && cargo check
  ```
  Expected: `Finished \`dev\` profile` with no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add src-tauri/src/database.rs
  git commit -m "feat(db): add command_history table and index"
  ```

---

## Task 2: Rust history module + Database wrapper methods

**Files:**
- Create: `src-tauri/src/history.rs`
- Modify: `src-tauri/src/database.rs` (add two public methods at bottom)

- [ ] **Step 1: Create `src-tauri/src/history.rs`**

  ```rust
  use rusqlite::{params, Connection};
  use std::time::{SystemTime, UNIX_EPOCH};

  /// Returns commands ordered oldest-first (caller reverses if needed).
  /// Deduplicates by keeping only the most-recent occurrence of each command.
  pub fn load_history(conn: &Connection, limit: u32) -> Vec<String> {
      let sql = "SELECT command FROM command_history \
                 GROUP BY command ORDER BY MAX(ts) DESC LIMIT ?1";
      let mut stmt = match conn.prepare(sql) {
          Ok(s) => s,
          Err(_) => return vec![],
      };
      match stmt.query_map(params![limit], |row| row.get::<_, String>(0)) {
          Ok(iter) => {
              let mut v: Vec<String> = iter.filter_map(|r| r.ok()).collect();
              v.reverse(); // newest-first from DB → oldest-first for the caller
              v
          }
          Err(_) => vec![],
      }
  }

  pub fn save_command(conn: &Connection, command: &str) {
      let ts = SystemTime::now()
          .duration_since(UNIX_EPOCH)
          .map(|d| d.as_secs() as i64)
          .unwrap_or(0);
      let _ = conn.execute(
          "INSERT INTO command_history (command, ts) VALUES (?1, ?2)",
          params![command, ts],
      );
      // Cap the table at 10 000 rows; delete the oldest surplus.
      let _ = conn.execute(
          "DELETE FROM command_history WHERE id IN (
               SELECT id FROM command_history ORDER BY ts ASC
               LIMIT MAX(0, (SELECT COUNT(*) FROM command_history) - 10000)
           )",
          [],
      );
  }
  ```

- [ ] **Step 2: Add wrapper methods to the `Database` impl in `database.rs`**

  Append just before the closing `}` of `impl Database` (after `clear_all_sessions`):

  ```rust
      // ---- Command History ----

      pub fn load_command_history(&self, limit: u32) -> Vec<String> {
          match self.conn.lock() {
              Ok(conn) => crate::history::load_history(&conn, limit),
              Err(_) => vec![],
          }
      }

      pub fn save_command_history(&self, command: &str) {
          if let Ok(conn) = self.conn.lock() {
              crate::history::save_command(&conn, command);
          }
      }
  ```

- [ ] **Step 3: Verify Rust compiles**

  ```bash
  cd src-tauri && cargo check
  ```
  Expected: `Finished \`dev\` profile` with no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add src-tauri/src/history.rs src-tauri/src/database.rs
  git commit -m "feat(history): add Rust history module and Database wrappers"
  ```

---

## Task 3: Register Tauri commands

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add `mod history;` at the top of `lib.rs`**

  Add after `mod ssh;` (line 7):

  ```rust
  mod history;
  ```

- [ ] **Step 2: Add the two command functions**

  Add after the `// ---- App Settings Commands ----` section (after `load_app_settings`, around line 589):

  ```rust
  // ---- Command History Commands ----

  #[tauri::command]
  async fn get_command_history(
      limit: u32,
      state: State<'_, Arc<AppState>>,
  ) -> Result<Vec<String>, String> {
      let state = state.inner().clone();
      tokio::task::spawn_blocking(move || Ok(state.db.load_command_history(limit)))
          .await
          .map_err(|e| format!("task join: {}", e))?
  }

  #[tauri::command]
  async fn save_command_history(
      command: String,
      state: State<'_, Arc<AppState>>,
  ) -> Result<(), String> {
      let state = state.inner().clone();
      tokio::task::spawn_blocking(move || {
          state.db.save_command_history(&command);
          Ok(())
      })
      .await
      .map_err(|e| format!("task join: {}", e))?
  }
  ```

- [ ] **Step 3: Register both commands in `invoke_handler`**

  In the `tauri::generate_handler![...]` list (around line 764), add the two new commands after `secret_storage_available,`:

  ```rust
              secret_storage_available,
              get_command_history,
              save_command_history,
  ```

- [ ] **Step 4: Verify Rust compiles**

  ```bash
  cd src-tauri && cargo check
  ```
  Expected: `Finished \`dev\` profile` with no errors.

- [ ] **Step 5: Commit**

  ```bash
  git add src-tauri/src/lib.rs
  git commit -m "feat(ipc): register get_command_history and save_command_history Tauri commands"
  ```

---

## Task 4: Frontend `commandHistory` module

**Files:**
- Create: `src/lib/commandHistory.ts`

- [ ] **Step 1: Create the module**

  ```typescript
  import { invoke } from '@tauri-apps/api/core';

  // Ordered oldest→newest. Index 0 = oldest, last = newest.
  let history: string[] = [];

  export async function init(limit: number): Promise<void> {
    try {
      // Backend returns newest-first; reverse so newest is at array end.
      const newest = await invoke<string[]>('get_command_history', { limit });
      history = [...newest].reverse();
    } catch {
      history = [];
    }
  }

  export function record(command: string): void {
    history.push(command);
    invoke('save_command_history', { command }).catch(() => {});
  }

  // Returns the suffix to append (everything after prefix) for the most recent match.
  // Returns '' when there is no match.
  export function getSuggestion(prefix: string): string {
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].startsWith(prefix) && history[i].length > prefix.length) {
        return history[i].slice(prefix.length);
      }
    }
    return '';
  }
  ```

- [ ] **Step 2: Run smoke check**

  ```bash
  npm run smoke:check
  ```
  Expected: `Result: PASS`

- [ ] **Step 3: Commit**

  ```bash
  git add src/lib/commandHistory.ts
  git commit -m "feat(history): add frontend commandHistory module"
  ```

---

## Task 5: Startup init + settings re-init

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/stores/settingsStore.ts`

- [ ] **Step 1: Add import to `App.tsx`**

  After the existing imports (around line 20), add:

  ```typescript
  import * as commandHistory from './lib/commandHistory';
  ```

- [ ] **Step 2: Add `settingsLoaded` selector and init effect in `App.tsx`**

  After `const loadSettings = useSettingsStore((s) => s.load);` (line 38), add:

  ```typescript
  const settingsLoaded = useSettingsStore((s) => s.loaded);
  const sshHistoryCmd = useSettingsStore((s) => s.settings.sshHistoryCmd);
  const sshHistoryCmdLoadCount = useSettingsStore((s) => s.settings.sshHistoryCmdLoadCount);
  ```

  After the existing `useEffect(() => { void loadSettings(); }, [loadSettings]);` block (around line 53), add:

  ```typescript
  useEffect(() => {
    if (!settingsLoaded) return;
    if (sshHistoryCmd) {
      commandHistory.init(parseInt(sshHistoryCmdLoadCount) || 100);
    }
  }, [settingsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps
  ```

- [ ] **Step 3: Add re-init to `settingsStore.save()`**

  Add import at the top of `src/stores/settingsStore.ts`:

  ```typescript
  import * as commandHistory from '../lib/commandHistory';
  ```

  In the `save` function (after `await invoke('save_app_settings', ...)`), add:

  ```typescript
    save: async (settings: AppSettings) => {
      const normalized = normalizeSettings(settings);
      set({ settings: normalized, hasSaved: true });
      await invoke('save_app_settings', { value: JSON.stringify(normalized) });
      if (normalized.sshHistoryCmd) {
        commandHistory.init(parseInt(normalized.sshHistoryCmdLoadCount) || 100);
      }
    },
  ```

- [ ] **Step 4: Run smoke check**

  ```bash
  npm run smoke:check
  ```
  Expected: `Result: PASS`

- [ ] **Step 5: Commit**

  ```bash
  git add src/App.tsx src/stores/settingsStore.ts
  git commit -m "feat(history): init command history on app startup and settings change"
  ```

---

## Task 6: TerminalView — module-level maps + cleanup

**Files:**
- Modify: `src/components/Terminal/TerminalView.tsx`

- [ ] **Step 1: Add four new module-level Maps**

  After the `const reconnectableTabs = new Set<string>();` declaration (around line 186), add:

  ```typescript
  // Command history: per-tab line buffer, ghost text state, and callbacks.
  const inputBuffers         = new Map<string, string>();
  const ghostTextState       = new Map<string, string>();
  const ghostTextSetters     = new Map<string, (text: string, x: number, y: number) => void>();
  const ghostAcceptCallbacks = new Map<string, (suffix: string) => void>();
  ```

- [ ] **Step 2: Extend `destroyTerminal` to clean up the new maps**

  In `destroyTerminal` (around line 201), add after `reconnectableTabs.delete(tabId);`:

  ```typescript
    inputBuffers.delete(tabId);
    ghostTextState.delete(tabId);
    ghostTextSetters.delete(tabId);
    ghostAcceptCallbacks.delete(tabId);
  ```

- [ ] **Step 3: Run smoke check**

  ```bash
  npm run smoke:check
  ```
  Expected: `Result: PASS`

- [ ] **Step 4: Commit**

  ```bash
  git add src/components/Terminal/TerminalView.tsx
  git commit -m "feat(history): add module-level maps and cleanup for ghost text"
  ```

---

## Task 7: TerminalView — `onData` interception for SSH tabs

**Files:**
- Modify: `src/components/Terminal/TerminalView.tsx`

- [ ] **Step 1: Add `commandHistory` import at the top of the file**

  After the existing imports (around line 14, after `terminalRegistry` import), add:

  ```typescript
  import * as commandHistory from '../../lib/commandHistory';
  ```

- [ ] **Step 2: Modify the `onData` handler inside `setupConnection`**

  The `onData` handler starts at line 839 with:
  ```typescript
  const dataDispose = instance!.terminal.onData((data) => {
    if (reconnectableTabs.has(tab.id)) {
  ```

  Replace the entire `dataDispose` block with this (preserves all original logic, adds SSH interception before the write queue):

  ```typescript
  const dataDispose = instance!.terminal.onData((data) => {
    if (reconnectableTabs.has(tab.id)) {
      reconnectableTabs.delete(tab.id);
      void reconnect();
      return;
    }

    // SSH command history: intercept keystrokes to track input and compute ghost text.
    if (tab.type === 'ssh' && useSettingsStore.getState().settings.sshHistoryCmd) {
      let buf = inputBuffers.get(tab.id) ?? '';
      const setter = ghostTextSetters.get(tab.id);
      const inst = terminalInstances.get(tab.id);
      const cursorX = inst?.terminal.buffer.active.cursorX ?? 0;
      const cursorY = inst?.terminal.buffer.active.cursorY ?? 0;

      if (data === '\r' || data === '\n') {
        const trimmed = buf.trim();
        if (trimmed.length > 0) commandHistory.record(trimmed);
        buf = '';
        ghostTextState.set(tab.id, '');
        setter?.('', 0, 0);
      } else if (data === '\x7f') {
        // Backspace
        buf = buf.slice(0, -1);
        const suffix = buf.length > 0 ? commandHistory.getSuggestion(buf) : '';
        ghostTextState.set(tab.id, suffix);
        setter?.(suffix, cursorX, cursorY);
      } else if (data === '\x15') {
        // Ctrl+U — clear line
        buf = '';
        ghostTextState.set(tab.id, '');
        setter?.('', 0, 0);
      } else if (data.startsWith('\x1b') || data === '\x01' || data === '\x05') {
        // ESC sequences (arrow keys, etc.) and Ctrl+A/E — clear ghost text only
        ghostTextState.set(tab.id, '');
        setter?.('', 0, 0);
      } else if (data.length === 1 && data.charCodeAt(0) >= 0x20) {
        // Printable ASCII
        buf += data;
        const suffix = commandHistory.getSuggestion(buf);
        ghostTextState.set(tab.id, suffix);
        setter?.(suffix, cursorX, cursorY);
      }
      inputBuffers.set(tab.id, buf);
    }

    writeQueue += data;
    if (writeQueue.length >= WRITE_CHUNK_SIZE) {
      if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
      flushWrites();
    } else {
      scheduleWriteFlush();
    }
  });

  // Register the ghost accept callback so the key handler can send completion text.
  if (tab.type === 'ssh') {
    ghostAcceptCallbacks.set(tab.id, (suffix: string) => {
      const buf = (inputBuffers.get(tab.id) ?? '') + suffix;
      inputBuffers.set(tab.id, buf);
      ghostTextState.set(tab.id, '');
      ghostTextSetters.get(tab.id)?.('', 0, 0);
      writeQueue += suffix;
      if (writeQueue.length >= WRITE_CHUNK_SIZE) {
        if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
        flushWrites();
      } else {
        scheduleWriteFlush();
      }
    });
  }
  ```

- [ ] **Step 3: Also clean up ghostAcceptCallbacks in the listener cleanup function**

  In the `tabListenerCleanups.set(tab.id, () => { ... })` block (around line 901), add at the end before `});`:

  ```typescript
    ghostAcceptCallbacks.delete(tab.id);
  ```

- [ ] **Step 4: Run smoke check**

  ```bash
  npm run smoke:check
  ```
  Expected: `Result: PASS`

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/Terminal/TerminalView.tsx
  git commit -m "feat(history): intercept SSH onData to record commands and compute ghost text"
  ```

---

## Task 8: TerminalView — Tab/→ acceptance in key handler

**Files:**
- Modify: `src/components/Terminal/TerminalView.tsx`

- [ ] **Step 1: Prepend ghost text acceptance to `attachCustomKeyEventHandler`**

  The existing `termRef.attachCustomKeyEventHandler((e) => {` call starts at line 598. Replace it with (add ghost acceptance block at the very top, before the copy/paste logic):

  ```typescript
  termRef.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown") return true;

    // Ghost text acceptance: Tab or → when SSH and ghost text is active.
    if (tab.type === 'ssh') {
      const ghost = ghostTextState.get(tab.id) ?? '';
      if (ghost && (e.key === 'Tab' || (e.key === 'ArrowRight' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey))) {
        e.preventDefault();
        ghostAcceptCallbacks.get(tab.id)?.(ghost);
        return false;
      }
    }

    if (isCopyShortcut(e)) {
      const selection = readTerminalSelection(termRef) || selectionSnapshotRef.current;
      if (selection) {
        e.preventDefault();
        void writeClipboardText(selection);
        termRef.clearSelection();
        selectionSnapshotRef.current = "";
        return false;
      }
    }

    if (isPasteShortcut(e, useSettingsStore.getState().settings.ctrlVPaste)) {
      e.preventDefault();
      doPaste();
      return false;
    }

    return true;
  });
  ```

- [ ] **Step 2: Run smoke check**

  ```bash
  npm run smoke:check
  ```
  Expected: `Result: PASS`

- [ ] **Step 3: Commit**

  ```bash
  git add src/components/Terminal/TerminalView.tsx
  git commit -m "feat(history): accept ghost text suggestion on Tab or ArrowRight"
  ```

---

## Task 9: TerminalView — ghost text React state + overlay JSX

**Files:**
- Modify: `src/components/Terminal/TerminalView.tsx`

- [ ] **Step 1: Add ghost text state variables inside `TerminalView` component**

  After `const [contextMenu, setContextMenu] = useState<TerminalContextMenu | null>(null);` (around line 321), add:

  ```typescript
  const [ghostText, setGhostText] = useState('');
  const [ghostCursor, setGhostCursor] = useState({ x: 0, y: 0 });
  ```

- [ ] **Step 2: Add reactive settings selector for `terminalCmdHint`**

  After `const theme = useAppStore((s) => s.theme);` (around line 313), add:

  ```typescript
  const terminalCmdHint = useSettingsStore((s) => s.settings.terminalCmdHint);
  const terminalFont = useSettingsStore((s) => s.settings.terminalFont);
  const terminalFontSize = useSettingsStore((s) => s.settings.terminalFontSize);
  ```

- [ ] **Step 3: Register the ghost text setter in a `useEffect`**

  Add after the `const selectionSnapshotRef = useRef("");` line (around line 317):

  ```typescript
  useEffect(() => {
    ghostTextSetters.set(tab.id, (text, x, y) => {
      setGhostText(text);
      setGhostCursor({ x, y });
    });
    return () => {
      ghostTextSetters.delete(tab.id);
    };
  }, [tab.id]);
  ```

- [ ] **Step 4: Add ghost text overlay to the JSX return**

  In the `return (` block (around line 1272), after the `<div ref={containerRef} ... />` element and before the `{contextMenu && ...}` block, add:

  ```tsx
  {ghostText && isActive && terminalCmdHint && (
    <div
      className="terminal-ghost-text"
      style={{
        left: `calc(${ghostCursor.x} * var(--cell-w))`,
        top: `calc(${ghostCursor.y} * var(--cell-h))`,
        fontFamily: terminalFont,
        fontSize: terminalFontSize,
      }}
    >
      {ghostText}
    </div>
  )}
  ```

- [ ] **Step 5: Run smoke check**

  ```bash
  npm run smoke:check
  ```
  Expected: `Result: PASS`

- [ ] **Step 6: Commit**

  ```bash
  git add src/components/Terminal/TerminalView.tsx
  git commit -m "feat(history): add ghost text React state and overlay JSX"
  ```

---

## Task 10: ResizeObserver — compute cell-size CSS variables

**Files:**
- Modify: `src/components/Terminal/TerminalView.tsx`

- [ ] **Step 1: Update cell-size CSS vars in the ResizeObserver callback**

  In the `ResizeObserver` callback (around line 1221-1229), after the `scheduleTerminalFit` / `scheduleTerminalResizeSettle` calls, add:

  ```typescript
  const observer = new ResizeObserver(() => {
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w === lastW && h === lastH) return;
    lastW = w;
    lastH = h;
    scheduleTerminalFit(tab.id);
    scheduleTerminalResizeSettle(tab.id, tab.sessionId, tab.type);
    // Update cell-size CSS variables used by the ghost text overlay.
    const inst = terminalInstances.get(tab.id);
    if (inst && w > 0 && inst.terminal.cols > 0) {
      el.style.setProperty('--cell-w', `${w / inst.terminal.cols}px`);
      el.style.setProperty('--cell-h', `${h / inst.terminal.rows}px`);
    }
  });
  ```

- [ ] **Step 2: Also set CSS vars on initial fit (inside `initTerminal`, after `safeFit`)**

  After the `safeFit(tab.id);` call (around line 695), add:

  ```typescript
  // Set initial cell-size CSS variables for ghost text overlay.
  const el2 = containerRef.current;
  const inst2 = terminalInstances.get(tab.id);
  if (el2 && inst2 && el2.clientWidth > 0 && inst2.terminal.cols > 0) {
    el2.style.setProperty('--cell-w', `${el2.clientWidth / inst2.terminal.cols}px`);
    el2.style.setProperty('--cell-h', `${el2.clientHeight / inst2.terminal.rows}px`);
  }
  ```

- [ ] **Step 3: Run smoke check**

  ```bash
  npm run smoke:check
  ```
  Expected: `Result: PASS`

- [ ] **Step 4: Commit**

  ```bash
  git add src/components/Terminal/TerminalView.tsx
  git commit -m "feat(history): compute cell-size CSS variables for ghost text positioning"
  ```

---

## Task 11: CSS — ghost text styles

**Files:**
- Modify: `src/styles/global.css`

- [ ] **Step 1: Add `.terminal-ghost-text` styles after the `.terminal-pane` block**

  Find the end of the `.terminal-pane .xterm:not(.focus)...` rule (around line 684) and add after it:

  ```css
  /* ---- Ghost text inline suggestion overlay ---- */
  .terminal-ghost-text {
    position: absolute;
    pointer-events: none;
    white-space: pre;
    z-index: 10;
    opacity: 0.45;
    line-height: inherit;
    user-select: none;
  }

  [data-theme="dark"] .terminal-ghost-text {
    color: #d4d4d8;
  }

  [data-theme="light"] .terminal-ghost-text {
    color: #1a1a2e;
  }
  ```

- [ ] **Step 2: Run smoke check**

  ```bash
  npm run smoke:check
  ```
  Expected: `Result: PASS`

- [ ] **Step 3: Commit**

  ```bash
  git add src/styles/global.css
  git commit -m "feat(history): add ghost text CSS styles"
  ```

---

## Task 12: Manual verification

- [ ] **Step 1: Start the Tauri dev server**

  ```bash
  npm run tauri dev
  ```

- [ ] **Step 2: Verify settings UI wires up correctly**

  Open Settings → Terminal tab. Confirm:
  - "SSH Command History" toggle is visible and defaults to ON.
  - "SSH历史命令-输入提示加载数量" shows `100`.
  - "Terminal Command Hint" toggle is visible.

- [ ] **Step 3: Test history recording**

  Open an SSH session. Run a few commands (e.g., `ls`, `pwd`, `echo hello`). Close and reopen the app. Open a new SSH session and verify the commands appear as ghost text suggestions.

- [ ] **Step 4: Test ghost text display**

  With "Terminal Command Hint" ON: type the first letter of a previously-run command. Confirm a dimmed suffix appears to the right. Press `→` or `Tab` to accept. Confirm the command completes and is sent.

- [ ] **Step 5: Test ghost text disabled**

  Toggle "Terminal Command Hint" to OFF. Retype. Confirm no ghost text appears (history still records).

- [ ] **Step 6: Test master toggle**

  Toggle "SSH Command History" to OFF. Confirm no ghost text and no recording. Toggle back ON and verify `init()` reloads history.

- [ ] **Step 7: Final smoke check**

  ```bash
  npm run smoke:check
  ```
  Expected: `Result: PASS`
