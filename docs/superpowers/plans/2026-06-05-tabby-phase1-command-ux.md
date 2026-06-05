# Tabby-Merge Phase 1: Command UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish gwshell's command-history autocomplete (ranking, multi-candidate, OSC 133 hybrid capture, all session types, host/cwd scoping) and add a quick-command snippet library.

**Architecture:** Backend extends the existing `command_history` SQLite table with scoping columns and adds a `snippets` table, exposed via Tauri IPC. Frontend ranks suggestions in-memory (no per-keystroke IPC), generalizes the xterm `onData` capture beyond SSH, registers OSC 133/OSC 7 handlers for authoritative command/cwd capture, and adds a sidebar snippet panel that injects expanded text through the existing per-tab `writeQueue`.

**Tech Stack:** Rust (rusqlite, tauri 2, serde), TypeScript/React, Zustand, @xterm/xterm, i18next.

---

## Verification approach (read first)

Per `CLAUDE.md`: **there are no automated tests in this project.** Do NOT create a test framework. Each task verifies via:
- Frontend: `npm run build` (runs `tsc` type-check + Vite build) — must pass with no errors.
- Backend: `cd src-tauri && cargo check` — must compile with no errors.
- Static: `npm run smoke:check` — must report no new issues.
- Manual: the per-task "Manual check" runs `npm run tauri dev` and exercises the behavior.

Commit after every task.

---

## File structure

**Backend (`src-tauri/src/`)**
- `history.rs` — MODIFY: `HistoryEntry` struct + multi-field `load_history`/`save_command`.
- `database.rs` — MODIFY: schema migration (ALTER columns), `snippets` table, wrapper methods.
- `lib.rs` — MODIFY: extend history IPC; add 3 snippet IPC commands; register all in `invoke_handler!`.

**Frontend (`src/`)**
- `lib/commandHistory.ts` — MODIFY: structured entries, ranked `getSuggestions`, `getSuggestion` shim.
- `lib/snippetExpand.ts` — CREATE: `\xNN`/`\sNNN`/`\n`/`\r`/`\t`/`\\` expansion into send segments.
- `stores/snippetStore.ts` — CREATE: Zustand snippet CRUD + IPC side effects.
- `stores/settingsStore.ts` — MODIFY: 4 new flags in `AppSettings` + `defaultSettings`.
- `components/Settings/SettingsModal.tsx` — MODIFY: 4 new flags in its **duplicate** `AppSettings`/`defaultSettings` + toggle rows.
- `components/Terminal/TerminalView.tsx` — MODIFY: generalize capture, scope/cwd, OSC handlers, hardened editing, candidate cycling, `tabInputSenders`.
- `components/Sidebar/SnippetPanel.tsx` — CREATE: snippet management + send UI.
- `components/Sidebar/IconNav.tsx` — MODIFY: add `snippets` nav item.
- `App.tsx` — MODIFY: render `SnippetPanel`.
- `types/index.ts` — MODIFY: add `Snippet`.
- `i18n/locales/gwshell.en.json` / `gwshell.zh.json` — MODIFY: add keys.
- `styles/global.css` (or existing terminal CSS file) — MODIFY: snippet panel styles.

> **Known duplication to keep in sync:** `AppSettings` and `defaultSettings` are declared **twice** — in `stores/settingsStore.ts` AND in `components/Settings/SettingsModal.tsx`. Any new setting must be added to BOTH or the build fails / the modal desyncs.

---

## Part A — Autocomplete polish

### Task A1: Backend — multi-field history store

**Files:**
- Modify: `src-tauri/src/history.rs` (whole file)
- Modify: `src-tauri/src/database.rs` (`init_tables` ~31-54; `load_command_history`/`save_command_history` ~213-224)

- [ ] **Step 1: Rewrite `history.rs` with structured entries**

Replace the entire contents of `src-tauri/src/history.rs` with:

```rust
use rusqlite::{params, Connection};
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};

/// One distinct command, aggregated by (command, scope, cwd).
#[derive(Serialize)]
pub struct HistoryEntry {
    pub command: String,
    pub cwd: String,
    pub scope: String,
    pub session_type: String,
    pub count: i64,     // number of executions in this (scope, cwd)
    pub last_used: i64, // latest unix-seconds timestamp
}

/// Returns aggregated history entries, newest-first, capped at `limit`.
pub fn load_history(conn: &Connection, limit: u32) -> Vec<HistoryEntry> {
    let sql = "SELECT command, cwd, scope, session_type, COUNT(*) AS cnt, MAX(ts) AS last_used \
               FROM command_history \
               GROUP BY command, scope, cwd \
               ORDER BY last_used DESC LIMIT ?1";
    let mut stmt = match conn.prepare(sql) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    let rows = stmt.query_map(params![limit], |row| {
        Ok(HistoryEntry {
            command: row.get(0)?,
            cwd: row.get(1)?,
            scope: row.get(2)?,
            session_type: row.get(3)?,
            count: row.get(4)?,
            last_used: row.get(5)?,
        })
    });
    match rows {
        Ok(iter) => iter.filter_map(|r| r.ok()).collect(),
        Err(_) => vec![],
    }
}

pub fn save_command(conn: &Connection, command: &str, cwd: &str, scope: &str, session_type: &str) {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let _ = conn.execute(
        "INSERT INTO command_history (command, ts, cwd, scope, session_type) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![command, ts, cwd, scope, session_type],
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

- [ ] **Step 2: Add idempotent column migration in `database.rs`**

In `init_tables` (`src-tauri/src/database.rs`), after the existing `conn.execute_batch(...)` call that creates the tables (ends ~line 53 with `.map_err(|e| e.to_string())`), change it so the batch result is stored and the migration runs before returning. Replace:

```rust
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS sessions (
```
...through the closing...
```rust
            CREATE INDEX IF NOT EXISTS idx_cmd_ts ON command_history(ts DESC);",
        )
        .map_err(|e| e.to_string())
    }
```

with (note: add the `snippets` table to the batch, capture the result, then run ALTERs):

```rust
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
            CREATE INDEX IF NOT EXISTS idx_cmd_ts ON command_history(ts DESC);
            CREATE TABLE IF NOT EXISTS snippets (
                id   TEXT PRIMARY KEY,
                data TEXT NOT NULL
            );",
        )
        .map_err(|e| e.to_string())?;

        // Idempotent migration: add scoping columns to command_history if absent.
        // ALTER errors with "duplicate column name" on later runs — ignored.
        for col in ["cwd", "scope", "session_type"] {
            let _ = conn.execute(
                &format!(
                    "ALTER TABLE command_history ADD COLUMN {} TEXT NOT NULL DEFAULT ''",
                    col
                ),
                [],
            );
        }
        Ok(())
    }
```

- [ ] **Step 3: Update the `database.rs` history wrappers**

In `src-tauri/src/database.rs`, replace the `load_command_history`/`save_command_history` methods (~213-224) with:

```rust
    pub fn load_command_history(&self, limit: u32) -> Vec<crate::history::HistoryEntry> {
        match self.conn.lock() {
            Ok(conn) => crate::history::load_history(&conn, limit),
            Err(_) => vec![],
        }
    }

    pub fn save_command_history(&self, command: &str, cwd: &str, scope: &str, session_type: &str) {
        if let Ok(conn) = self.conn.lock() {
            crate::history::save_command(&conn, command, cwd, scope, session_type);
        }
    }
```

- [ ] **Step 4: Verify compile**

Run: `cd src-tauri && cargo check`
Expected: compiles (will warn that the new `save_command_history` arity is unused until A2 updates lib.rs — that's fine; if lib.rs already calls the old signature it will ERROR, which A2 fixes. If cargo errors only in `lib.rs` on `save_command_history`/`load_command_history`, proceed to A2 and re-check there.)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/history.rs src-tauri/src/database.rs
git commit -m "feat(history): scope command history by cwd/host/type; add snippets table"
```

---

### Task A2: Backend — history IPC signature

**Files:**
- Modify: `src-tauri/src/lib.rs` (`get_command_history`/`save_command_history` ~594-617)

- [ ] **Step 1: Replace the two history commands**

In `src-tauri/src/lib.rs`, replace lines ~594-617 (the `get_command_history` and `save_command_history` commands) with:

```rust
#[tauri::command]
async fn get_command_history(
    limit: u32,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<crate::history::HistoryEntry>, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || Ok(state.db.load_command_history(limit)))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn save_command_history(
    command: String,
    cwd: Option<String>,
    scope: Option<String>,
    session_type: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    let cwd = cwd.unwrap_or_default();
    let scope = scope.unwrap_or_default();
    let session_type = session_type.unwrap_or_default();
    tokio::task::spawn_blocking(move || {
        state.db.save_command_history(&command, &cwd, &scope, &session_type);
        Ok(())
    })
    .await
    .map_err(|e| format!("task join: {}", e))?
}
```

> Note: `Option<_>` params make `cwd`/`scope`/`session_type` optional in the JS call (Tauri auto camelCase↔snake_case: JS sends `sessionType`).

- [ ] **Step 2: Verify compile**

Run: `cd src-tauri && cargo check`
Expected: compiles cleanly.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(history): extend save_command_history IPC with cwd/scope/type"
```

---

### Task B1+B2: Backend — snippet persistence + IPC

**Files:**
- Modify: `src-tauri/src/database.rs` (add methods near other CRUD, after `clear_all_sessions` ~209)
- Modify: `src-tauri/src/lib.rs` (add 3 commands; register in `invoke_handler!` ~792-843)

> The `snippets` table was already created in Task A1 Step 2.

- [ ] **Step 1: Add snippet methods to `database.rs`**

In `src-tauri/src/database.rs`, after the `// ---- Command History ----` section's methods (after `save_command_history`, before the final closing `}` of `impl Database`), add:

```rust
    // ---- Snippets ----

    pub fn save_snippet(&self, id: &str, data: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO snippets (id, data) VALUES (?1, ?2)",
            params![id, data],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_snippets(&self) -> Result<Vec<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT data FROM snippets")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn delete_snippet(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM snippets WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
```

- [ ] **Step 2: Add the 3 IPC commands to `lib.rs`**

In `src-tauri/src/lib.rs`, after the `save_command_history` command (from A2), add:

```rust
// ---- Snippet Commands ----

#[tauri::command]
async fn save_snippet(
    id: String,
    data: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || state.db.save_snippet(&id, &data))
        .await
        .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn get_snippets(state: State<'_, Arc<AppState>>) -> Result<Vec<String>, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || state.db.get_snippets())
        .await
        .map_err(|e| format!("task join: {}", e))?
}

#[tauri::command]
async fn delete_snippet(id: String, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || state.db.delete_snippet(&id))
        .await
        .map_err(|e| format!("task join: {}", e))?
}
```

- [ ] **Step 3: Register the commands in `invoke_handler!`**

In `src-tauri/src/lib.rs`, in the `tauri::generate_handler![...]` list (~792-843), after the `save_command_history,` line add:

```rust
            save_snippet,
            get_snippets,
            delete_snippet,
```

- [ ] **Step 4: Verify compile**

Run: `cd src-tauri && cargo check`
Expected: compiles cleanly.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/database.rs src-tauri/src/lib.rs
git commit -m "feat(snippets): backend CRUD + IPC commands"
```

---

### Task A3: Frontend — ranked suggestions

**Files:**
- Modify: `src/lib/commandHistory.ts` (whole file)

- [ ] **Step 1: Rewrite `commandHistory.ts`**

Replace the entire contents of `src/lib/commandHistory.ts` with:

```ts
import { invoke } from '@tauri-apps/api/core';

export interface HistoryEntry {
  command: string;
  cwd: string;
  scope: string;
  session_type: string;
  count: number;
  last_used: number; // unix seconds
}

export interface SuggestCtx {
  scope?: string;
  cwd?: string;
  sessionType?: string;
}

// Aggregated entries loaded from the backend, plus in-session appends.
let entries: HistoryEntry[] = [];

export async function init(limit: number): Promise<void> {
  try {
    entries = await invoke<HistoryEntry[]>('get_command_history', { limit });
  } catch {
    entries = [];
  }
}

export function record(command: string, ctx: SuggestCtx = {}): void {
  const now = Math.floor(Date.now() / 1000);
  entries.push({
    command,
    cwd: ctx.cwd ?? '',
    scope: ctx.scope ?? '',
    session_type: ctx.sessionType ?? '',
    count: 1,
    last_used: now,
  });
  invoke('save_command_history', {
    command,
    cwd: ctx.cwd ?? '',
    scope: ctx.scope ?? '',
    sessionType: ctx.sessionType ?? '',
  }).catch(() => {});
}

const DAY = 86400;
// 1.0 right now, ~0.5 after a week, asymptotes toward 0.
function recencyDecay(ageSec: number): number {
  return 1 / (1 + Math.max(0, ageSec) / (7 * DAY));
}

// Returns ranked full-command candidates (highest score first), max 8.
export function getSuggestions(prefix: string, ctx: SuggestCtx = {}): string[] {
  if (!prefix) return [];
  const now = Math.floor(Date.now() / 1000);
  const best = new Map<string, number>(); // command -> best score
  for (const e of entries) {
    if (!e.command.startsWith(prefix) || e.command.length <= prefix.length) continue;
    let score = Math.log2(e.count + 1) * recencyDecay(now - e.last_used);
    if (ctx.scope && e.scope === ctx.scope) score += 2;
    if (ctx.cwd && e.cwd === ctx.cwd) score += 1;
    const prev = best.get(e.command);
    if (prev === undefined || score > prev) best.set(e.command, score);
  }
  return [...best.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([cmd]) => cmd);
}

// Back-compat single-suffix helper.
export function getSuggestion(prefix: string, ctx: SuggestCtx = {}): string {
  const best = getSuggestions(prefix, ctx)[0];
  return best ? best.slice(prefix.length) : '';
}
```

> In-session frequency isn't summed (each `record` adds a `count:1` row); ranking falls back to recency until the next `init()` re-aggregates from SQLite. Acceptable for Phase 1.

- [ ] **Step 2: Verify type-check**

Run: `npm run build`
Expected: passes. (Callers in `App.tsx`/`settingsStore.ts` use `init`/`record` with compatible signatures; `record(cmd)` still type-checks since `ctx` is optional.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/commandHistory.ts
git commit -m "feat(history): ranked multi-candidate suggestions with scope/cwd boost"
```

---

### Task A8: Settings — new flags + rows + i18n

**Files:**
- Modify: `src/stores/settingsStore.ts` (`AppSettings` ~8-73; `defaultSettings` ~75-140)
- Modify: `src/components/Settings/SettingsModal.tsx` (duplicate `AppSettings` ~33-95; duplicate `defaultSettings` ~136-165; SSH/SFTP rows ~434-437)
- Modify: `src/i18n/locales/gwshell.en.json`, `gwshell.zh.json`

- [ ] **Step 1: Add flags to `settingsStore.ts`**

In `src/stores/settingsStore.ts`, in `interface AppSettings`, after `sshHistoryCmdLoadCount: string;` (line ~41) add:

```ts
  cmdHintAllSessions: boolean;
  cmdHintShellIntegration: boolean;
  cmdHintDeferToRemote: boolean;
  cmdHintScopeByHost: boolean;
```

In `defaultSettings`, after `sshHistoryCmdLoadCount: '100',` (line ~108) add:

```ts
  cmdHintAllSessions: true,
  cmdHintShellIntegration: false,
  cmdHintDeferToRemote: false,
  cmdHintScopeByHost: true,
```

- [ ] **Step 2: Add the same flags to `SettingsModal.tsx`'s duplicate declarations**

In `src/components/Settings/SettingsModal.tsx`, in its `export interface AppSettings`, after `sshHistoryCmdLoadCount: string;` (line ~67) add the identical 4 lines:

```ts
  cmdHintAllSessions: boolean;
  cmdHintShellIntegration: boolean;
  cmdHintDeferToRemote: boolean;
  cmdHintScopeByHost: boolean;
```

In its local `defaultSettings`, after `sshHistoryCmdLoadCount: '100',` (line ~139) add:

```ts
  cmdHintAllSessions: true,
  cmdHintShellIntegration: false,
  cmdHintDeferToRemote: false,
  cmdHintScopeByHost: true,
```

- [ ] **Step 3: Add toggle rows to the SSH/SFTP settings section**

In `src/components/Settings/SettingsModal.tsx`, immediately after line ~437 (`<Row label={t('settings_ssh_history_count')}>...`) add:

```tsx
                    <Row label={t('settings_cmd_hint_all_sessions')}><Toggle value={settings.cmdHintAllSessions} onChange={(v) => u('cmdHintAllSessions', v)} /></Row>
                    <Row label={t('settings_cmd_hint_scope_host')}><Toggle value={settings.cmdHintScopeByHost} onChange={(v) => u('cmdHintScopeByHost', v)} /></Row>
                    <Row label={t('settings_cmd_hint_shell_integration')}><Toggle value={settings.cmdHintShellIntegration} onChange={(v) => u('cmdHintShellIntegration', v)} /></Row>
                    <Row label={t('settings_cmd_hint_defer_remote')}><Toggle value={settings.cmdHintDeferToRemote} onChange={(v) => u('cmdHintDeferToRemote', v)} /></Row>
```

- [ ] **Step 4: Add i18n keys**

In `src/i18n/locales/gwshell.en.json`, add (anywhere in the object, e.g. after the existing `settings_ssh_history_count` key):

```json
  "settings_cmd_hint_all_sessions": "Command hints in all session types",
  "settings_cmd_hint_scope_host": "Rank hints by current host / directory",
  "settings_cmd_hint_shell_integration": "Inject shell integration (local shells)",
  "settings_cmd_hint_defer_remote": "Defer to remote shell suggestions when detected",
  "nav_snippets": "Snippets",
  "snippet_title": "Quick Commands",
  "snippet_add": "New snippet",
  "snippet_name": "Name",
  "snippet_command": "Command",
  "snippet_group": "Group",
  "snippet_send": "Send to terminal",
  "snippet_edit": "Edit",
  "snippet_delete": "Delete",
  "snippet_save": "Save",
  "snippet_cancel": "Cancel",
  "snippet_empty": "No snippets yet. Add one to get started.",
  "snippet_no_terminal": "No active terminal to send to",
```

In `src/i18n/locales/gwshell.zh.json`, add the same keys with Chinese values:

```json
  "settings_cmd_hint_all_sessions": "在所有会话类型显示命令提示",
  "settings_cmd_hint_scope_host": "按当前主机/目录排序提示",
  "settings_cmd_hint_shell_integration": "注入 shell 集成(本地终端)",
  "settings_cmd_hint_defer_remote": "检测到远程 shell 补全时让位",
  "nav_snippets": "快捷命令",
  "snippet_title": "快捷命令",
  "snippet_add": "新建片段",
  "snippet_name": "名称",
  "snippet_command": "命令",
  "snippet_group": "分组",
  "snippet_send": "发送到终端",
  "snippet_edit": "编辑",
  "snippet_delete": "删除",
  "snippet_save": "保存",
  "snippet_cancel": "取消",
  "snippet_empty": "还没有片段,新建一个开始吧。",
  "snippet_no_terminal": "没有可发送的活动终端",
```

> The snippet keys are added now (they're used in Task B6) to keep all i18n edits in one place.

- [ ] **Step 5: Verify type-check**

Run: `npm run build`
Expected: passes. (`TranslationKeys` is derived from the en JSON; new keys become valid `t()` args.)

- [ ] **Step 6: Commit**

```bash
git add src/stores/settingsStore.ts src/components/Settings/SettingsModal.tsx src/i18n/locales/gwshell.en.json src/i18n/locales/gwshell.zh.json
git commit -m "feat(settings): command-hint scope/integration flags + snippet i18n keys"
```

---

### Task A4: TerminalView — generalize capture, scope/cwd, hardened editing

**Files:**
- Modify: `src/components/Terminal/TerminalView.tsx` (module maps ~187-193; `destroyTerminal` ~208-226; `onData` history block ~892-930; overlay gate ~1391; cleanup ~1004-1016)

- [ ] **Step 1: Add module-level maps + helpers**

In `src/components/Terminal/TerminalView.tsx`, after the existing `const ghostAcceptCallbacks = new Map<...>();` (line ~193) add:

```ts
const tabCwd            = new Map<string, string>();
const tabHasOsc133      = new Map<string, boolean>();
const tabCandidates     = new Map<string, string[]>();
const candidateIndex    = new Map<string, number>();
const tabInputSenders   = new Map<string, (data: string) => void>();
const bracketedPaste    = new Map<string, boolean>();

function isInteractiveTerminal(type: string): boolean {
  return type === 'ssh' || type === 'localshell' || type === 'serial' || type === 'docker';
}

// Per-tab scope key for history ranking.
function tabScope(
  type: string,
  session: { host?: string; serial_port?: string; name?: string } | undefined,
): string {
  if (type === 'ssh') return session?.host ?? '';
  if (type === 'localshell') return 'local';
  if (type === 'serial') return session?.serial_port ?? 'serial';
  if (type === 'docker') return session?.name ?? 'docker';
  return '';
}
```

- [ ] **Step 2: Extend `destroyTerminal` cleanup**

In `destroyTerminal` (~208-226), after `ghostAcceptCallbacks.delete(tabId);` add:

```ts
  tabCwd.delete(tabId);
  tabHasOsc133.delete(tabId);
  tabCandidates.delete(tabId);
  candidateIndex.delete(tabId);
  tabInputSenders.delete(tabId);
  bracketedPaste.delete(tabId);
```

- [ ] **Step 3: Replace the `onData` history block**

In `src/components/Terminal/TerminalView.tsx`, replace the whole history block inside `onData` — from `// SSH command history: intercept keystrokes...` (line ~892) through `inputBuffers.set(tab.id, buf);` and its closing `}` (line ~930) — with:

```ts
        // Command history: track input line and compute ghost text.
        // Generalized beyond SSH; gated by sshHistoryCmd (capture) + cmdHintAllSessions.
        {
          const st = useSettingsStore.getState().settings;
          const captureOn =
            st.sshHistoryCmd &&
            isInteractiveTerminal(tab.type) &&
            (tab.type === 'ssh' || st.cmdHintAllSessions);
          if (captureOn) {
            const sess = sessionsRef.current.find((s) => s.id === tab.sessionId);
            const scope = st.cmdHintScopeByHost ? tabScope(tab.type, sess) : '';
            const cwd = st.cmdHintScopeByHost ? (tabCwd.get(tab.id) ?? '') : '';
            const sessionType = tab.type;

            let buf = inputBuffers.get(tab.id) ?? '';
            const setter = ghostTextSetters.get(tab.id);
            const inst = terminalInstances.get(tab.id);
            const cursorX = inst?.terminal.buffer.active.cursorX ?? 0;
            const cursorY = inst?.terminal.buffer.active.cursorY ?? 0;

            const showGhost = () => {
              const cands = commandHistory.getSuggestions(buf, { scope, cwd, sessionType });
              tabCandidates.set(tab.id, cands);
              candidateIndex.set(tab.id, 0);
              const suffix = cands[0] ? cands[0].slice(buf.length) : '';
              ghostTextState.set(tab.id, suffix);
              setter?.(suffix, cursorX, cursorY);
            };
            const clearGhost = () => {
              tabCandidates.set(tab.id, []);
              candidateIndex.set(tab.id, 0);
              ghostTextState.set(tab.id, '');
              setter?.('', 0, 0);
            };

            // Bracketed paste: buffer the pasted content into the line, no ghost.
            if (data.includes('\x1b[200~')) bracketedPaste.set(tab.id, true);
            if (bracketedPaste.get(tab.id)) {
              const end = data.indexOf('\x1b[201~');
              const chunk = (end >= 0 ? data.slice(0, end) : data)
                .replace('\x1b[200~', '');
              buf += chunk;
              if (end >= 0) bracketedPaste.set(tab.id, false);
              clearGhost();
            } else if (data === '\r' || data === '\n') {
              const trimmed = buf.trim();
              if (trimmed.length > 0) commandHistory.record(trimmed, { scope, cwd, sessionType });
              buf = '';
              clearGhost();
            } else if (data === '\x7f' || data === '\b') {
              // Backspace
              buf = buf.slice(0, -1);
              if (buf.length > 0) showGhost();
              else clearGhost();
            } else if (data === '\x17') {
              // Ctrl+W — delete the previous word
              buf = buf.replace(/\s*\S+\s*$/, '');
              if (buf.length > 0) showGhost();
              else clearGhost();
            } else if (data === '\x15' || data === '\x0b' || data === '\x0c') {
              // Ctrl+U / Ctrl+K / Ctrl+L — clear line / kill / clear screen
              if (data === '\x15') buf = '';
              clearGhost();
            } else if (
              data === '\x1b[A' || data === '\x1b[B' || data === '\x1b[C' || data === '\x1b[D' ||
              data === '\x1b[H' || data === '\x1b[F' || data === '\x01' || data === '\x05'
            ) {
              // Arrows / Home / End / Ctrl-A / Ctrl-E — cursor moves: clear ghost only.
              clearGhost();
            } else if (data.startsWith('\x1b')) {
              // Other escape sequences — clear ghost only.
              clearGhost();
            } else if (data.length >= 1 && data.charCodeAt(0) >= 0x20) {
              // Printable text (single char or multi-char without bracketed markers).
              buf += data;
              showGhost();
            }
            inputBuffers.set(tab.id, buf);
          }
        }
```

- [ ] **Step 4: Generalize the ghost-accept callback registration**

In `src/components/Terminal/TerminalView.tsx`, change the guard `if (tab.type === 'ssh') {` that wraps `ghostAcceptCallbacks.set(...)` (line ~945) to:

```ts
      if (isInteractiveTerminal(tab.type)) {
```

- [ ] **Step 5: Generalize the overlay render gate**

In the JSX (~1391), change:

```tsx
      {ghostText && isActive && terminalCmdHint && (
```

to (also require an interactive tab):

```tsx
      {ghostText && isActive && terminalCmdHint && isInteractiveTerminal(tab.type) && (
```

- [ ] **Step 6: Extend the listener cleanup**

In the `tabListenerCleanups.set(tab.id, () => { ... })` body (~1004-1016), after `ghostAcceptCallbacks.delete(tab.id);` add:

```ts
        tabCandidates.delete(tab.id);
        candidateIndex.delete(tab.id);
        bracketedPaste.delete(tab.id);
```

> Do NOT delete `tabCwd`/`tabHasOsc133` here — those are reset by OSC handlers and fully cleared in `destroyTerminal`.

- [ ] **Step 7: Verify type-check**

Run: `npm run build`
Expected: passes. (`tabInputSenders` is declared-but-unused until Task B5 — TS won't error on an unused module-level `const`. If a no-unused-vars lint fails, it is added/used in B5; proceed.)

- [ ] **Step 8: Manual check**

Run: `npm run tauri dev`. Open Settings → SSH/SFTP, enable "命令提示"/`terminalCmdHint`. In an SSH session type a previously-used command's prefix → ghost appears; `Tab`/`→` accepts. Open a **local shell** tab, confirm the ghost also appears (generalization). Paste a command → no stale ghost.

- [ ] **Step 9: Commit**

```bash
git add src/components/Terminal/TerminalView.tsx
git commit -m "feat(history): generalize capture to all sessions; scope/cwd; hardened line editing"
```

---

### Task A5: TerminalView — OSC 133 / OSC 7 hybrid capture

**Files:**
- Modify: `src/components/Terminal/TerminalView.tsx` (terminal creation / listener setup region; cleanup)

- [ ] **Step 1: Register OSC handlers after the terminal instance exists**

In `src/components/Terminal/TerminalView.tsx`, locate where `dataDispose` is created (the `instance!.terminal.onData(...)` at ~883). Immediately **before** that line, add OSC handler registration:

```ts
      // Hybrid capture: OSC 7 (cwd) + OSC 133 (prompt/command boundaries).
      // When present, OSC 133 gives authoritative command capture; we still keep
      // the heuristic onData buffer as the universal fallback.
      const term133 = instance!.terminal;
      const osc7Dispose = term133.parser.registerOscHandler(7, (payload) => {
        // payload like file://host/abs/path
        const m = /^file:\/\/[^/]*(\/.*)$/.exec(payload);
        if (m) tabCwd.set(tab.id, decodeURIComponent(m[1]));
        return false; // let other handlers run
      });
      const osc133Dispose = term133.parser.registerOscHandler(133, (payload) => {
        // FinalTerm/iTerm2: A=prompt-start, B=command-start, C=pre-exec, D=done
        const kind = payload.charAt(0);
        tabHasOsc133.set(tab.id, true);
        if (kind === 'A' || kind === 'B') {
          // New prompt / command start — reset the heuristic buffer & ghost.
          inputBuffers.set(tab.id, '');
          tabCandidates.set(tab.id, []);
          candidateIndex.set(tab.id, 0);
          ghostTextState.set(tab.id, '');
          ghostTextSetters.get(tab.id)?.('', 0, 0);
        } else if (kind === 'C') {
          // Command submitted: record the authoritative line (heuristic buffer).
          const sess = sessionsRef.current.find((s) => s.id === tab.sessionId);
          const st = useSettingsStore.getState().settings;
          const scope = st.cmdHintScopeByHost ? tabScope(tab.type, sess) : '';
          const cwd = st.cmdHintScopeByHost ? (tabCwd.get(tab.id) ?? '') : '';
          const line = (inputBuffers.get(tab.id) ?? '').trim();
          if (st.sshHistoryCmd && line.length > 0) {
            commandHistory.record(line, { scope, cwd, sessionType: tab.type });
          }
          inputBuffers.set(tab.id, '');
        }
        return false;
      });
```

> Note: with OSC 133 present, both the heuristic `\r` path (Task A4) and the OSC-`C` path could record the same command. To avoid double-recording, see Step 2.

- [ ] **Step 2: Suppress heuristic record when OSC 133 is driving**

In the `onData` history block from Task A4, change the Enter branch:

```ts
            } else if (data === '\r' || data === '\n') {
              const trimmed = buf.trim();
              if (trimmed.length > 0) commandHistory.record(trimmed, { scope, cwd, sessionType });
              buf = '';
              clearGhost();
```

to (skip recording if OSC 133 already records on `C`):

```ts
            } else if (data === '\r' || data === '\n') {
              const trimmed = buf.trim();
              if (trimmed.length > 0 && !tabHasOsc133.get(tab.id)) {
                commandHistory.record(trimmed, { scope, cwd, sessionType });
              }
              buf = '';
              clearGhost();
```

- [ ] **Step 3: Apply the double-ghost defer setting**

In the same block's `showGhost` (Task A4), gate on the defer setting:

```ts
            const showGhost = () => {
              if (st.cmdHintDeferToRemote && tabHasOsc133.get(tab.id)) {
                clearGhost();
                return;
              }
              const cands = commandHistory.getSuggestions(buf, { scope, cwd, sessionType });
              tabCandidates.set(tab.id, cands);
              candidateIndex.set(tab.id, 0);
              const suffix = cands[0] ? cands[0].slice(buf.length) : '';
              ghostTextState.set(tab.id, suffix);
              setter?.(suffix, cursorX, cursorY);
            };
```

- [ ] **Step 4: Dispose OSC handlers in cleanup**

In the `tabListenerCleanups.set(tab.id, () => { ... })` body, after the `try { resizeDispose?.dispose(); } catch {}` line, add:

```ts
        try { osc7Dispose.dispose(); } catch {}
        try { osc133Dispose.dispose(); } catch {}
```

- [ ] **Step 5: Verify type-check**

Run: `npm run build`
Expected: passes.

- [ ] **Step 6: Manual check**

Run: `npm run tauri dev`. In a local shell with shell integration (e.g. a zsh/bash that emits OSC 133 — or temporarily `printf '\e]133;C\a'`), confirm commands are still recorded and the cwd reflects in scope. Without OSC 133 (plain shell), the heuristic path still records (no regression).

- [ ] **Step 7: Commit**

```bash
git add src/components/Terminal/TerminalView.tsx
git commit -m "feat(history): OSC 133/OSC 7 hybrid capture with cwd + double-ghost defer"
```

---

### Task A6: TerminalView — multi-candidate cycling

**Files:**
- Modify: `src/components/Terminal/TerminalView.tsx` (`attachCustomKeyEventHandler` ghost block ~627-635)

- [ ] **Step 1: Replace the ghost-acceptance key block with accept + cycle**

In `src/components/Terminal/TerminalView.tsx`, replace this block (~627-635):

```ts
          // Ghost text acceptance: Tab or → when SSH and ghost text is active.
          if (tab.type === 'ssh') {
            const ghost = ghostTextState.get(tab.id) ?? '';
            if (ghost && (e.key === 'Tab' || (e.key === 'ArrowRight' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey))) {
              e.preventDefault();
              ghostAcceptCallbacks.get(tab.id)?.(ghost);
              return false;
            }
          }
```

with:

```ts
          // Ghost text: accept (Tab / →) or cycle candidates (↓ Ctrl-N / ↑ Ctrl-P).
          if (isInteractiveTerminal(tab.type)) {
            const ghost = ghostTextState.get(tab.id) ?? '';
            const cands = tabCandidates.get(tab.id) ?? [];
            const plainArrow = !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;

            if (ghost && (e.key === 'Tab' || (e.key === 'ArrowRight' && plainArrow))) {
              e.preventDefault();
              ghostAcceptCallbacks.get(tab.id)?.(ghost);
              return false;
            }

            const cycleNext =
              (e.key === 'ArrowDown' && plainArrow) || (e.key === 'n' && e.ctrlKey);
            const cyclePrev =
              (e.key === 'ArrowUp' && plainArrow) || (e.key === 'p' && e.ctrlKey);
            if ((cycleNext || cyclePrev) && cands.length > 1) {
              e.preventDefault();
              const buf = inputBuffers.get(tab.id) ?? '';
              let idx = candidateIndex.get(tab.id) ?? 0;
              idx = cycleNext
                ? (idx + 1) % cands.length
                : (idx - 1 + cands.length) % cands.length;
              candidateIndex.set(tab.id, idx);
              const suffix = cands[idx].slice(buf.length);
              ghostTextState.set(tab.id, suffix);
              const inst = terminalInstances.get(tab.id);
              const cx = inst?.terminal.buffer.active.cursorX ?? 0;
              const cy = inst?.terminal.buffer.active.cursorY ?? 0;
              ghostTextSetters.get(tab.id)?.(suffix, cx, cy);
              return false;
            }
          }
```

- [ ] **Step 2: Verify type-check**

Run: `npm run build`
Expected: passes.

- [ ] **Step 3: Manual check**

Run: `npm run tauri dev`. Build history with several commands sharing a prefix (e.g. `git status`, `git stash`, `git switch`). Type `git ` → ghost shows best; press `↓` (or `Ctrl-N`) to cycle to the next candidate; `Tab` accepts the shown one.

- [ ] **Step 4: Commit**

```bash
git add src/components/Terminal/TerminalView.tsx
git commit -m "feat(history): cycle multiple candidates with arrows / Ctrl-N/P"
```

---

## Part B — Snippet library

### Task B3: types + snippet store

**Files:**
- Modify: `src/types/index.ts` (add `Snippet`)
- Create: `src/stores/snippetStore.ts`

- [ ] **Step 1: Add `Snippet` type**

In `src/types/index.ts`, after the `TabInfo` interface (line ~78) add:

```ts
export interface Snippet {
  id: string;
  name: string;
  command: string;
  group?: string;
  createdAt: number;
}
```

- [ ] **Step 2: Create `snippetStore.ts`**

Create `src/stores/snippetStore.ts`:

```ts
import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Snippet } from '../types';

interface SnippetStore {
  snippets: Snippet[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (s: Omit<Snippet, 'id' | 'createdAt'>) => Promise<void>;
  update: (s: Snippet) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useSnippetStore = create<SnippetStore>((set, get) => ({
  snippets: [],
  loaded: false,

  load: async () => {
    try {
      const rows = await invoke<string[]>('get_snippets');
      const snippets = rows
        .map((r) => {
          try {
            return JSON.parse(r) as Snippet;
          } catch {
            return null;
          }
        })
        .filter((s): s is Snippet => s !== null)
        .sort((a, b) => a.createdAt - b.createdAt);
      set({ snippets, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  add: async (input) => {
    const snippet: Snippet = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      ...input,
    };
    set({ snippets: [...get().snippets, snippet] });
    await invoke('save_snippet', { id: snippet.id, data: JSON.stringify(snippet) }).catch(() => {});
  },

  update: async (snippet) => {
    set({ snippets: get().snippets.map((s) => (s.id === snippet.id ? snippet : s)) });
    await invoke('save_snippet', { id: snippet.id, data: JSON.stringify(snippet) }).catch(() => {});
  },

  remove: async (id) => {
    set({ snippets: get().snippets.filter((s) => s.id !== id) });
    await invoke('delete_snippet', { id }).catch(() => {});
  },
}));
```

- [ ] **Step 3: Verify type-check**

Run: `npm run build`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/stores/snippetStore.ts
git commit -m "feat(snippets): Snippet type + Zustand store with IPC persistence"
```

---

### Task B4: snippet escape expansion

**Files:**
- Create: `src/lib/snippetExpand.ts`

- [ ] **Step 1: Create `snippetExpand.ts`**

Create `src/lib/snippetExpand.ts`:

```ts
// A send plan is an ordered list of segments. `delayMs` segments pause the
// sender; `text` segments are written to the terminal.
export type SendSegment =
  | { kind: 'text'; text: string }
  | { kind: 'delay'; delayMs: number };

// Expands snippet escapes into a send plan:
//   \xNN  -> control byte from two hex digits (e.g. \x03 = Ctrl-C)
//   \sNNN -> delay NNN milliseconds (1-4 digits)
//   \n \r \t \\ -> newline / carriage-return / tab / literal backslash
export function expandSnippet(raw: string): SendSegment[] {
  const segments: SendSegment[] = [];
  let buf = '';
  const flush = () => {
    if (buf) {
      segments.push({ kind: 'text', text: buf });
      buf = '';
    }
  };

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== '\\') {
      buf += ch;
      continue;
    }
    const next = raw[i + 1];
    if (next === 'x') {
      const hex = raw.slice(i + 2, i + 4);
      if (/^[0-9a-fA-F]{2}$/.test(hex)) {
        buf += String.fromCharCode(parseInt(hex, 16));
        i += 3;
        continue;
      }
    } else if (next === 's') {
      const m = /^(\d{1,4})/.exec(raw.slice(i + 2));
      if (m) {
        flush();
        segments.push({ kind: 'delay', delayMs: parseInt(m[1], 10) });
        i += 1 + m[1].length;
        continue;
      }
    } else if (next === 'n') {
      buf += '\n'; i += 1; continue;
    } else if (next === 'r') {
      buf += '\r'; i += 1; continue;
    } else if (next === 't') {
      buf += '\t'; i += 1; continue;
    } else if (next === '\\') {
      buf += '\\'; i += 1; continue;
    }
    // Unknown escape — keep the backslash literally.
    buf += ch;
  }
  flush();
  return segments;
}
```

- [ ] **Step 2: Verify type-check**

Run: `npm run build`
Expected: passes.

- [ ] **Step 3: Manual reasoning check (no test framework)**

Confirm by inspection: `expandSnippet('ls\\n')` → `[{text:'ls\n'}]`; `expandSnippet('a\\s500b')` → `[{text:'a'},{delay:500},{text:'b'}]`; `expandSnippet('\\x03')` → `[{text:''}]`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/snippetExpand.ts
git commit -m "feat(snippets): escape expansion (\\xNN, \\sNNN, \\n/\\r/\\t/\\\\)"
```

---

### Task B5: TerminalView — per-tab input sender

**Files:**
- Modify: `src/components/Terminal/TerminalView.tsx` (register `tabInputSenders` next to `ghostAcceptCallbacks` ~944-960; cleanup ~1004-1016)

- [ ] **Step 1: Register a sender for the active tab's write path**

In `src/components/Terminal/TerminalView.tsx`, right after the `ghostAcceptCallbacks.set(...)` block closes (the `}` ending the `if (isInteractiveTerminal(tab.type)) { ghostAcceptCallbacks.set(... ) }` from Task A4 Step 4, ~line 960), add:

```ts
      // Generic external input injection (used by the snippet panel). Reuses the
      // same writeQueue/flush path as keystrokes, so backpressure & retry apply.
      tabInputSenders.set(tab.id, (payload: string) => {
        if (writeDisposed || !payload) return;
        writeQueue += payload;
        if (writeQueue.length >= WRITE_CHUNK_SIZE) {
          if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
          flushWrites();
        } else {
          scheduleWriteFlush();
        }
      });
```

- [ ] **Step 2: Clean up the sender on listener teardown**

In the `tabListenerCleanups.set(tab.id, () => { ... })` body, after `ghostAcceptCallbacks.delete(tab.id);` add:

```ts
        tabInputSenders.delete(tab.id);
```

- [ ] **Step 3: Export a helper to send to a tab**

At the bottom of `src/components/Terminal/TerminalView.tsx` (near `export function destroyTerminal`), add:

```ts
// Returns true if input could be queued for the given tab.
export function sendInputToTab(tabId: string, data: string): boolean {
  const sender = tabInputSenders.get(tabId);
  if (!sender) return false;
  sender(data);
  return true;
}
```

- [ ] **Step 4: Verify type-check**

Run: `npm run build`
Expected: passes (now `tabInputSenders` is used; any earlier unused-var concern is resolved).

- [ ] **Step 5: Commit**

```bash
git add src/components/Terminal/TerminalView.tsx
git commit -m "feat(snippets): per-tab input sender reusing the writeQueue path"
```

---

### Task B6: Snippet sidebar panel + nav + render

**Files:**
- Create: `src/components/Sidebar/SnippetPanel.tsx`
- Modify: `src/components/Sidebar/IconNav.tsx` (nav item + handler)
- Modify: `src/App.tsx` (render panel; load snippets)
- Modify: `src/styles/global.css` (panel styles)

- [ ] **Step 1: Add the nav item to `IconNav.tsx`**

In `src/components/Sidebar/IconNav.tsx`, add `Code` to the lucide import list (line ~3-18), e.g. add `Code,` after `Box,`. Then in `navItems` (~22-31), add after the `terminal` entry:

```ts
  { id: 'snippets', icon: Code, labelKey: 'nav_snippets' },
```

In `handleNavClick`'s `switch` (~56), add a case (toggles the sidebar panel selection like `sessions`):

```ts
      case 'snippets':
        // activeNavItem is already set above; App renders SnippetPanel for it.
        if (sidebarCollapsed) toggleSidebar();
        break;
```

- [ ] **Step 2: Create `SnippetPanel.tsx`**

Create `src/components/Sidebar/SnippetPanel.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Play, Edit, Trash2, Check, X } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useSnippetStore } from '../../stores/snippetStore';
import { expandSnippet } from '../../lib/snippetExpand';
import { sendInputToTab } from '../Terminal/TerminalView';
import type { Snippet } from '../../types';

export const SnippetPanel: React.FC = () => {
  const { t } = useTranslation();
  const { snippets, loaded, load, add, update, remove } = useSnippetStore();
  const { sidebarCollapsed, activeTabId, tabs } = useAppStore();
  const [editing, setEditing] = useState<Snippet | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftCmd, setDraftCmd] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  if (sidebarCollapsed) return null;

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const canSend =
    !!activeTab &&
    activeTab.connected &&
    activeTab.type !== 'asset-list';

  const send = (snippet: Snippet) => {
    if (!canSend || !activeTab) {
      setError(t('snippet_no_terminal'));
      return;
    }
    setError('');
    let delay = 0;
    for (const seg of expandSnippet(snippet.command)) {
      if (seg.kind === 'delay') {
        delay += seg.delayMs;
      } else {
        const text = seg.text;
        if (delay === 0) sendInputToTab(activeTab.id, text);
        else setTimeout(() => sendInputToTab(activeTab.id, text), delay);
      }
    }
  };

  const startCreate = () => {
    setCreating(true);
    setEditing(null);
    setDraftName('');
    setDraftCmd('');
  };
  const startEdit = (s: Snippet) => {
    setEditing(s);
    setCreating(false);
    setDraftName(s.name);
    setDraftCmd(s.command);
  };
  const cancel = () => {
    setCreating(false);
    setEditing(null);
  };
  const submit = async () => {
    const name = draftName.trim() || draftCmd.trim().slice(0, 24);
    const command = draftCmd;
    if (!command.trim()) return;
    if (editing) await update({ ...editing, name, command });
    else await add({ name, command });
    cancel();
  };

  return (
    <div className="snippet-panel">
      <div className="snippet-panel-header">
        <span>{t('snippet_title')}</span>
        <button className="snippet-icon-btn" onClick={startCreate} title={t('snippet_add')}>
          <Plus size={16} />
        </button>
      </div>

      {error && <div className="snippet-error">{error}</div>}

      {(creating || editing) && (
        <div className="snippet-form">
          <input
            className="snippet-input"
            placeholder={t('snippet_name')}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
          />
          <textarea
            className="snippet-input snippet-textarea"
            placeholder={t('snippet_command')}
            value={draftCmd}
            onChange={(e) => setDraftCmd(e.target.value)}
            rows={3}
          />
          <div className="snippet-form-actions">
            <button className="snippet-icon-btn" onClick={submit} title={t('snippet_save')}>
              <Check size={16} />
            </button>
            <button className="snippet-icon-btn" onClick={cancel} title={t('snippet_cancel')}>
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      <div className="snippet-list">
        {snippets.length === 0 && !creating && (
          <div className="snippet-empty">{t('snippet_empty')}</div>
        )}
        {snippets.map((s) => (
          <div className="snippet-item" key={s.id}>
            <div className="snippet-item-main" title={s.command}>
              <div className="snippet-item-name">{s.name}</div>
              <div className="snippet-item-cmd">{s.command}</div>
            </div>
            <div className="snippet-item-actions">
              <button
                className="snippet-icon-btn"
                onClick={() => send(s)}
                disabled={!canSend}
                title={t('snippet_send')}
              >
                <Play size={14} />
              </button>
              <button className="snippet-icon-btn" onClick={() => startEdit(s)} title={t('snippet_edit')}>
                <Edit size={14} />
              </button>
              <button className="snippet-icon-btn" onClick={() => void remove(s.id)} title={t('snippet_delete')}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
```

- [ ] **Step 3: Render the panel in `App.tsx`**

In `src/App.tsx`, add the import near the other sidebar imports (~line 6):

```tsx
import { SnippetPanel } from './components/Sidebar/SnippetPanel';
```

Add `activeNavItem` to the destructured `useAppStore()` call (~line 36-38). Then in the layout, replace:

```tsx
          <Sidebar />
          <SessionPanel />
```

with:

```tsx
          <Sidebar />
          {activeNavItem === 'snippets' ? <SnippetPanel /> : <SessionPanel />}
```

- [ ] **Step 4: Load snippets at boot**

In `src/App.tsx`, add an effect after the sessions-load effect (~line 103). First add the import:

```tsx
import { useSnippetStore } from './stores/snippetStore';
```

Then inside `App()` add:

```tsx
  const loadSnippets = useSnippetStore((s) => s.load);
  useEffect(() => {
    void loadSnippets();
  }, [loadSnippets]);
```

- [ ] **Step 5: Add panel styles**

In `src/styles/global.css`, append:

```css
.snippet-panel {
  display: flex;
  flex-direction: column;
  width: 240px;
  min-width: 240px;
  height: 100%;
  border-right: 1px solid var(--border-color, #2a2a2a);
  background: var(--panel-bg, #1a1a1a);
  overflow: hidden;
}
.snippet-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  font-weight: 600;
  font-size: 13px;
  border-bottom: 1px solid var(--border-color, #2a2a2a);
}
.snippet-error { padding: 6px 12px; color: #e06c75; font-size: 12px; }
.snippet-form { display: flex; flex-direction: column; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--border-color, #2a2a2a); }
.snippet-input { background: var(--input-bg, #111); border: 1px solid var(--border-color, #333); color: inherit; border-radius: 4px; padding: 6px 8px; font-size: 12px; font-family: inherit; }
.snippet-textarea { resize: vertical; }
.snippet-form-actions { display: flex; gap: 6px; justify-content: flex-end; }
.snippet-list { flex: 1; overflow-y: auto; }
.snippet-empty { padding: 16px 12px; color: var(--text-muted, #888); font-size: 12px; }
.snippet-item { display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-bottom: 1px solid var(--border-color, #232323); }
.snippet-item:hover { background: var(--hover-bg, #232323); }
.snippet-item-main { flex: 1; min-width: 0; }
.snippet-item-name { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.snippet-item-cmd { font-size: 11px; color: var(--text-muted, #888); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: monospace; }
.snippet-item-actions { display: flex; gap: 2px; }
.snippet-icon-btn { background: none; border: none; color: var(--text-muted, #aaa); cursor: pointer; padding: 4px; border-radius: 4px; display: inline-flex; }
.snippet-icon-btn:hover:not(:disabled) { background: var(--hover-bg, #333); color: inherit; }
.snippet-icon-btn:disabled { opacity: 0.4; cursor: default; }
```

> If the project uses CSS variables under different names, the fallbacks after the commas keep this readable regardless. Adjust variable names to match the existing theme tokens if obvious from `global.css`.

- [ ] **Step 6: Verify type-check + smoke**

Run: `npm run build && npm run smoke:check`
Expected: both pass.

- [ ] **Step 7: Manual check**

Run: `npm run tauri dev`. Click the new Snippets nav icon → panel shows. Add a snippet `name: list, command: ls -la\n` → it appears and persists (restart app, still there). Open a connected terminal, click ▶ → `ls -la` runs. Add `command: \x03` and send while a process runs → it interrupts (Ctrl-C). With no connected terminal, ▶ is disabled and the error hint shows.

- [ ] **Step 8: Commit**

```bash
git add src/components/Sidebar/SnippetPanel.tsx src/components/Sidebar/IconNav.tsx src/App.tsx src/styles/global.css
git commit -m "feat(snippets): sidebar panel with CRUD + send-to-terminal"
```

---

## Final task: Full verification pass

- [ ] **Step 1: Full build + checks**

Run:
```bash
npm run build
npm run smoke:check
cd src-tauri && cargo check && cd ..
```
Expected: all pass with no errors.

- [ ] **Step 2: Run the manual test checklist (spec §5)**

Run `npm run tauri dev` and verify:
1. SSH: ranked ghost (frequent/recent first); `↓` cycles; `Tab`/`→` accepts.
2. Local shell / serial: capture + hint also work.
3. Scope: commands from host A rank below host B's own history on host B (with `cmdHintScopeByHost` on).
4. OSC 133: complex pasted command captured without desync (shell-integration shell).
5. Clearing: paste / arrow keys / Enter clear ghost — no residue.
6. Snippets: add/edit/delete persist across restart; send injects to active terminal; `\x03`, `\s500`, `\n` behave; disabled with no active terminal.
7. Regression: `sshHistoryCmd` off → no capture; split panes (2/4/6/8) → listeners stay unique, no double injection.

- [ ] **Step 3: Final commit (if any doc/cleanup changes)**

```bash
git add -A
git commit -m "chore(phase1): final verification pass for command UX"
```

---

## Self-review notes (author)

- **Spec coverage:** A1↔§A1, A2↔IPC, A3↔§A2, A4↔§A3a/A4, A5↔§A3b/A5(defer), A6↔§A5(cycle), B1/B2↔§B1, B3↔§B1, B4↔§B3, B5↔§B3, B6↔§B2. §A3c (shell-integration injection) is represented only as the `cmdHintShellIntegration` setting flag (A8) — the actual local-shell injection logic is **deferred within Phase 1** (spec marks it opt-in/default-off and "搭好开关 + 骨架"); the flag + `tabHasOsc133` plumbing exist, injection wiring is a follow-up. Flagged so it isn't mistaken as fully done.
- **Placeholder scan:** none.
- **Type consistency:** `HistoryEntry` (Rust serde snake_case `session_type`, `last_used`) matches the TS interface field names; `getSuggestions`/`getSuggestion` signatures consistent across A3/A4/A5/A6; `sendInputToTab`/`tabInputSenders` consistent across B5/B6; settings keys identical in both `AppSettings` copies (A8).
