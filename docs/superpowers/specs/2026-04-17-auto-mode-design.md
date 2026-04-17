# Auto Mode — Design Spec

**Date:** 2026-04-17
**Status:** Draft for review
**Owner:** @gw-link

## 1. Summary

Auto Mode is a per-terminal feature that detects confirmation prompts emitted by
AI coding CLIs (Claude Code, Codex, Gemini CLI) running inside a GWShell
terminal, and automatically injects the "approve" response so the user is not
interrupted. Detection is content-driven (heuristics + user-extensible regex
rules), runs entirely in the frontend against the xterm.js rendered buffer,
and is gated by strict conditions to minimize false positives. A cooldown
killswitch, status bar indicator, and log panel provide visibility and
safety.

## 2. Goals & Non-Goals

### Goals

- Remove y/n confirmation friction when developing with Claude Code, Codex,
  Gemini CLI inside GWShell terminals.
- Work in both local shell (`localshell`) and SSH terminals (`ssh`).
- Default **off** at install; explicit per-terminal opt-in.
- Prefer the strongest approve option when a menu offers multiple (e.g.
  Claude Code's "Yes, and don't ask again this session" is preferred over
  plain "Yes").
- Provide visibility (status bar + log panel) and safety (cooldown killswitch).
- Extensible: users can add custom regex rules for CLIs we don't know about.

### Non-Goals

- Docker terminal support (future work).
- Backend (Rust) participation in detection — detection is pure frontend.
- Persisting logs to SQLite — logs are in-memory, session-scoped.
- Per-session rule scoping — rules are global.
- Special-casing other TUIs (vim, tmux, htop) — if auto mode misbehaves on a
  given tab, the user disables it on that tab.
- LLM-driven detection.
- Automatic recovery from cooldown — user must manually re-enable.

## 3. User Experience

### 3.1 Enabling

- Settings → Auto Mode → **"新终端默认开启 Auto Mode"** checkbox (default
  off). Governs whether newly opened `localshell` / `ssh` tabs start with
  auto mode on.
- Each terminal tab has a ⚡ toggle icon next to the close button.
  - Dim gray = off. Yellow + subtle pulse = on.
  - Hover tooltip: `"Auto Mode: 开启 ({count} 自动确认)"` /
    `"Auto Mode: 关闭 (点击开启)"`.
  - The toggle only renders for `ssh` and `localshell` tabs. It does not
    render for `asset-list`, `serial`, `docker`, or `sftp` tabs.
- The status bar (bottom-right) shows `⚡ Auto · N` when the active tab has
  auto mode on. `N` = cumulative auto-confirmations in the current session.
  Clicking `[v]` next to it toggles the log panel.

### 3.2 When Auto Mode Fires

- A 300ms yellow flash on the status bar indicator.
- A log entry appended to the tab's in-memory log.
- **No inline write to the terminal.** The TUI in alt-screen mode owns the
  screen; writing to it would be destroyed by the next TUI repaint. Instead,
  when the watcher observes the terminal leaving alt-screen (e.g. the CLI
  exits), it writes a single summary line to the normal scrollback:
  ```
  [Auto Mode] Confirmed 12 times during this session. See log panel.
  ```

### 3.3 Log Panel

Bottom drawer above status bar, opened on demand:

```
┌─────────────────────────────────────────────────────────┐
│ Auto Mode 日志 — server-01 tab                       ×  │
├─────────────────────────────────────────────────────────┤
│ 13:42:05  ✓  Yes, don't ask again     Claude Code 3-opt │
│ 13:41:58  ✓  y                         Generic y/N      │
│ 13:40:12  ⚠  Cooldown tripped         —                 │
│ ...                                                     │
├─────────────────────────────────────────────────────────┤
│ [清空本 tab 日志]  [导出 JSON]                          │
└─────────────────────────────────────────────────────────┘
```

- Columns: time, status icon, label, matched rule name.
- In-memory only; cleared on app restart.
- Export JSON downloads the current tab's log entries to a local file.

### 3.4 Cooldown

If a tab triggers more than `autoModeCooldownCount` (default **20**)
auto-confirmations within `autoModeCooldownWindowMs` (default **5 minutes**),
auto mode for that tab is **forcibly disabled** and a toast is shown:

> Auto Mode 暂停：5 分钟内触发 >20 次。请手动重新开启。

The user must click the ⚡ toggle to re-enable. There is no automatic
recovery — the friction is intentional.

## 4. Architecture

Auto mode lives entirely in the frontend. A plain-TypeScript `AutoModeWatcher`
class is instantiated per tab alongside the existing xterm.js instance, and
disposed when the tab closes.

```
┌───────────────────────────────────────────────────┐
│  TerminalView (existing)                          │
│    ↓ writes PTY/SSH output to xterm.js            │
│  xterm.js Terminal instance                       │
│    ├── buffer.active (rendered screen text) ─────►│  AutoModeWatcher
│    ├── onWriteParsed                              │    │
│    └── onData (user keypress)                     │    ├─ detect: L2 heuristics
│                                                   │    ├─ decide: response char
│                                                   │    └─ inject: invoke(write_to_pty|ssh)
│  Auto Mode UI (new)                               │    │
│    ├── toolbar toggle per-tab                     │◄───┤ log events
│    ├── status bar indicator                       │    │
│    └── expandable log panel                       │    │
└───────────────────────────────────────────────────┘
                                                    │
          settingsStore (existing)                  │
            ├── autoModeDefaultEnabled   ◄──────────┤
            ├── autoModeCooldownCount    ◄──────────┤
            ├── autoModeCooldownWindowMs ◄──────────┤
            └── autoModeCustomRules (L4) ◄──────────┘
```

Key decisions:

1. **One watcher per tab**, lifecycle bound to the xterm instance (not React
   component). Follows existing `terminalInstances` Map pattern.
2. **Read the rendered buffer** via `terminal.buffer.active` rather than
   parsing the raw PTY stream. xterm.js has already done ANSI parsing;
   consuming the post-render text is stable and simple.
3. **Event-driven + idle window**: listen to `onWriteParsed`, debounce
   200ms, then run detection. Suppress for 800ms after `onData`
   (user keypress).
4. **Inject via `invoke("write_to_pty" | "write_to_ssh", ...)`** — same
   IPC path `TerminalView.onData` uses. No new backend command.
5. **No backend changes.** `pty.rs` / `ssh.rs` untouched.

## 5. Components & Files

### 5.1 New files

| File | Responsibility |
|---|---|
| `src/components/Terminal/AutoModeWatcher.ts` | Core watcher class (plain TS, not React). One instance per tab. Subscribes to xterm events, runs heuristics, injects responses. |
| `src/components/Terminal/autoModeRules.ts` | Built-in heuristic rule library for Claude Code, Codex, Gemini, and a generic y/N fallback. |
| `src/components/Terminal/AutoModeToggle.tsx` | ⚡ toggle button rendered in tab bar. |
| `src/components/Terminal/AutoModeLogPanel.tsx` | Collapsible drawer showing per-tab log entries. |
| `src/components/StatusBar/AutoModeIndicator.tsx` | Status bar element: `⚡ Auto · N` with flash animation. |
| `src/stores/autoModeStore.ts` | Zustand runtime store (in-memory): per-tab enabled flag, counters, logs, cooldown state. |
| `scripts/mock-ai-cli.mjs` | Small Node script emitting mock Claude Code 3-option prompt for manual testing. |

### 5.2 Modified files

| File | Change |
|---|---|
| `src/components/Terminal/TerminalView.tsx` | After xterm initialization, construct `AutoModeWatcher`. In `destroyTerminal`, dispose it. |
| `src/App.tsx` | Mount `AutoModeLogPanel` at root level (same pattern as existing modals); rendered conditionally by `autoModeStore.logPanelOpen`. |
| `src/components/TabBar/TabBar.tsx` | Render `AutoModeToggle` inline in each tab's control area (for `ssh` / `localshell` tabs only). |
| `src/components/StatusBar/StatusBar.tsx` | Render `AutoModeIndicator` in the right-hand section. |
| `src/stores/settingsStore.ts` | Add `autoModeDefaultEnabled`, `autoModeCooldownCount`, `autoModeCooldownWindowMs`, `autoModeCustomRules` to `AppSettings` and `defaultSettings`. |
| `src/types/index.ts` | Add `AutoModeRule`, `AutoModeCustomRule`, `AutoModeLogEntry`, `AutoModeMatchResult`, `AutoModeDetectionContext`. |
| `src/components/Settings/SettingsModal.tsx` | Add "Auto Mode" section with toggle, cooldown inputs, custom rule editor. |
| `src/i18n/locales/gwshell.en.json` | Add translation keys listed in §9. |
| `src/i18n/locales/gwshell.zh.json` | Same keys in Chinese. |

## 6. Detection Algorithm

### 6.1 Event loop

```
xterm.onWriteParsed ──► reset debounce(200ms)
                              │
                              ▼ (no more writes for 200ms)
                        fire detection
                              │
  xterm.onData (user keypress) ──► lastUserInputAt = now
                                    (suppresses detection within 800ms)
```

### 6.2 Detection context

```ts
interface AutoModeDetectionContext {
  visibleLines: string[];   // rendered text lines from buffer.active, top to bottom
  cursorRow: number;
  cursorCol: number;
  inAltScreen: boolean;     // terminal.buffer.active.type === 'alternate'
  idleMs: number;           // ms since last onWriteParsed
  lastUserInputAt: number;  // ms timestamp
  now: number;
}
```

`visibleLines` built by iterating `buffer.active.getLine(i).translateToString(true)`
for `i` in `[viewportY, viewportY + rows)`. `translateToString(true)` trims
trailing whitespace but retains content.

### 6.3 Gate (all must be true)

1. `autoModeStore.enabled[tabId] === true`
2. `ctx.inAltScreen === true`  ← hard gate against plain-shell false positives
3. `ctx.now - ctx.lastUserInputAt > 800`
4. Tab is not in cooldown state
5. `ctx.now - lastInjectionAt[tabId] > 500` (anti-double-fire)

If any fails, abort without invoking rules.

### 6.4 Rule interface

```ts
interface AutoModeRule {
  id: string;
  name: string;
  priority: number;
  match: (ctx: AutoModeDetectionContext) => AutoModeMatchResult | null;
}

interface AutoModeMatchResult {
  response: string;   // raw bytes to send, e.g. "2\r", "y\r", "\r"
  label: string;      // for log: "Yes, and don't ask again"
  ruleName: string;
}
```

Rules are tried in descending `priority`. **First non-null match wins.**
Rule `match` callbacks must be pure and should not throw; the watcher wraps
each call in try/catch and demotes thrown rules to a `⚠ Rule X: error` log
entry.

### 6.5 Built-in rule library (initial set)

Priorities are suggestions; exact values can be tuned at implementation time.

| Priority | Rule name | Match summary | Response |
|---|---|---|---|
| 100 | `Claude Code 3-option` | Visible text contains `❯? 1. Yes` AND a line matching `/2\.\s*Yes,?\s*and\s*don'?t\s*ask\s*again/i` AND `/3\.\s*No/`. | `"2\r"` |
| 90 | `Claude Code 2-option` | Contains `❯? 1. Yes` AND `/2\.\s*No/`, no "don't ask again" option. | `"1\r"` |
| 50 | `Generic y/N` | Last non-empty visible line ends with one of: `[y/N]`, `[Y/n]`, `(y/n)`, `(Y/n)` (case-insensitive). | `"y\r"` |

The initial rule set ships with the two Claude Code rules and the generic
y/N fallback. Codex and Gemini CLI prompts are covered by the generic
fallback on day one; specific rules for their exact prompt formats
(including any menu-style multi-option prompts they use) are added as a
dedicated follow-up once a developer has captured live prompt output from
each CLI. Users who need specialized handling before that land can add
custom rules via the settings UI (see §6.6). This is tracked in §14.

### 6.6 Custom rules (L4)

Users add entries in Settings → Auto Mode → 自定义规则:

```ts
interface AutoModeCustomRule {
  id: string;        // uuid
  enabled: boolean;
  priority: number;  // suggested ≥ 200 so they outrank built-in rules
  pattern: string;   // regex source string
  flags: string;     // regex flags (e.g. "im")
  response: string;  // raw bytes, backslash-escapes decoded: "\\r" → "\r"
  label: string;     // log label
}
```

At load time the watcher converts each to an `AutoModeRule` whose `match`
runs the regex against `ctx.visibleLines.join("\n")`. Invalid regex → rule
skipped, warning logged once.

Response string parsing: the editor accepts the literal string
(e.g. `y\r` or `2\r`). On save we decode `\r`, `\n`, `\t`, `\x1b` escapes.
No shell metacharacter interpretation.

### 6.7 Injection path

On match:

```ts
autoModeStore.pushLog(tabId, { time, label, ruleName, response, kind: "info" });
autoModeStore.incrementCounter(tabId);
lastInjectionAt[tabId] = Date.now();
recordTrigger(tabId);  // for cooldown
invoke(writeCmd, { sessionId, data: matchResult.response }).catch(err => {
  autoModeStore.pushLog(tabId, { ... kind: "error", label: `send failed: ${err}` });
});
```

`writeCmd` is resolved from `tab.type`: `ssh → "write_to_ssh"`, everything
else → `"write_to_pty"`. Matches the convention in `TerminalView`.

### 6.8 Cooldown

Each tab has a ring buffer `recentTriggers[tabId]: number[]` of timestamps.

```ts
recordTrigger(tabId) {
  const now = Date.now();
  const win = settings.autoModeCooldownWindowMs;
  const cap = settings.autoModeCooldownCount;
  const arr = recentTriggers[tabId];
  arr.push(now);
  while (arr.length && arr[0] < now - win) arr.shift();
  if (arr.length > cap) {
    autoModeStore.setEnabled(tabId, false);
    autoModeStore.pushLog(tabId, {
      kind: "warning",
      label: "Cooldown tripped, auto mode disabled",
      time: now,
    });
    showToast(i18n.t("auto_mode_cooldown_toast"));
    recentTriggers[tabId] = [];
  }
}
```

## 7. State & Persistence

### 7.1 settingsStore (persisted to disk via existing `save_app_settings`)

Add to `AppSettings`:

```ts
autoModeDefaultEnabled: boolean;       // default: false
autoModeCooldownCount: number;         // default: 20
autoModeCooldownWindowMs: number;      // default: 300000  // 5 min
autoModeCustomRules: AutoModeCustomRule[];  // default: []
```

Add matching entries to `defaultSettings`. The existing `normalizeSettings`
spread pattern (`{ ...defaultSettings, ...saved }`) auto-backfills old configs.

### 7.2 autoModeStore (runtime, in-memory, Zustand)

```ts
interface AutoModeStore {
  enabled: Record<string, boolean>;          // per tabId
  counters: Record<string, number>;          // cumulative triggers this session
  logs: Record<string, AutoModeLogEntry[]>;  // bounded 500/tab
  logPanelOpen: boolean;
  logPanelTabId: string | null;              // which tab's log is shown

  setEnabled(tabId: string, value: boolean): void;
  incrementCounter(tabId: string): void;
  pushLog(tabId: string, entry: Omit<AutoModeLogEntry, 'id'>): void;
  clearLog(tabId: string): void;
  cleanup(tabId: string): void;              // called from destroyTerminal
  toggleLogPanel(tabId?: string): void;
}

interface AutoModeLogEntry {
  id: string;
  time: number;
  kind: "info" | "warning" | "error";
  label: string;
  ruleName?: string;
  response?: string;
}
```

`pushLog` enforces a 500-entry cap per tab by dropping the oldest.

### 7.3 Default state for a new tab

On tab creation (existing `addTab` in `appStore`):
- If the tab type is `ssh` or `localshell`: read `settings.autoModeDefaultEnabled`
  and initialize `autoModeStore.enabled[tabId]` accordingly.
- Otherwise: leave undefined (watcher is never instantiated for non-terminal
  tabs).

Initialization hook lives in `AutoModeWatcher` construction, not `addTab`,
to keep `appStore` free of feature-specific logic.

## 8. UI Details

### 8.1 Tab ⚡ toggle

A new `AutoModeToggle.tsx` component rendered inline in the tab strip,
before the existing close `×` button, for `ssh` and `localshell` tabs only.
CSS: 14px icon, 4px margin-left, matching existing tab control styling.
`onClick` calls `autoModeStore.setEnabled(tabId, !current)`.

### 8.2 Status bar `AutoModeIndicator.tsx`

Shows only when `autoModeStore.enabled[activeTabId] === true`. Renders as
`⚡ Auto · {counter}`. On counter increment, applies a CSS class
`auto-flash` for 300ms (keyframe: background yellow → transparent).
Click → `autoModeStore.toggleLogPanel(activeTabId)`.

### 8.3 `AutoModeLogPanel.tsx`

A fixed-position drawer above the status bar, full width, 240px tall,
with slide-in transition. Mounted at root (like existing modals in
`App.tsx`). Virtualized list not necessary at 500-entry cap.

- Each log row: `HH:MM:SS  [icon]  label  · ruleName`.
- Kind colors: info = dim green, warning = yellow, error = red.
- Bottom bar: "清空本 tab 日志" (calls `clearLog`), "导出 JSON"
  (downloads `gwshell-automode-${tabId}-${timestamp}.json`).

### 8.4 Settings → Auto Mode section

Inserted as a new sidebar item in the existing settings modal. Layout:

```
新终端默认开启 Auto Mode        [ ] (checkbox)

Cooldown 阈值
  [ 20 ] 次 / [ 5 ] 分钟       (number inputs)

─ 自定义规则 ─

| 优先级 | 匹配正则        | 响应 | 标签    | 操作   |
| 250    | ^Proceed\?      | y\r  | Proceed | ✎ ✗   |
| 210    | Continue\? \[Y… | \r   | Enter   | ✎ ✗   |
[+ 添加规则]
```

"添加规则" opens a small modal with fields: priority, pattern, flags,
response, label. On save, the regex is validated with `new RegExp(pattern, flags)`;
failure shows inline error and blocks save.

## 9. i18n Keys (new)

Add to both `gwshell.en.json` and `gwshell.zh.json`:

```
auto_mode_toggle_tooltip_on        "Auto Mode: 开启 ({{count}} 自动确认)"
auto_mode_toggle_tooltip_off       "Auto Mode: 关闭 (点击开启)"
auto_mode_status_badge             "⚡ Auto · {{count}}"
auto_mode_log_title                "Auto Mode 日志 — {{tabTitle}}"
auto_mode_log_empty                "尚无记录"
auto_mode_log_clear                "清空本 tab 日志"
auto_mode_log_export               "导出 JSON"
auto_mode_log_cooldown_tripped     "Cooldown 触发，Auto Mode 已关闭"
auto_mode_log_send_failed          "发送失败: {{error}}"
auto_mode_cooldown_toast           "Auto Mode 暂停：{{window}} 分钟内触发 >{{count}} 次"
auto_mode_settings_title           "Auto Mode"
auto_mode_settings_default         "新终端默认开启 Auto Mode"
auto_mode_settings_cooldown        "Cooldown 阈值"
auto_mode_settings_cooldown_hint   "超过后自动关闭该终端的 Auto Mode"
auto_mode_settings_customrules     "自定义规则"
auto_mode_settings_addrule         "添加规则"
auto_mode_settings_rule_priority   "优先级"
auto_mode_settings_rule_pattern    "匹配正则"
auto_mode_settings_rule_response   "响应"
auto_mode_settings_rule_label      "标签"
auto_mode_settings_rule_invalid    "正则表达式无效"
auto_mode_session_summary          "[Auto Mode] 本次 session 共自动确认 {{count}} 次。详情见日志面板。"
```

(English copy chosen at implementation time; literal Chinese above is
placeholder showing intent.)

## 10. Edge Cases

| Case | Handling |
|---|---|
| Split-pane with same session in multiple tabs | Each tab has its own xterm instance, thus its own watcher and counter. Independent. |
| Non-active tab | Watcher keeps running. User may be working elsewhere while Claude runs in background. |
| Tab close | `destroyTerminal(tabId)` calls `watcher.dispose()` which clears timers, unsubscribes events, and calls `autoModeStore.cleanup(tabId)`. |
| Settings change (rule edit, cooldown change) | Watcher reads from `settingsStore.getState()` at each detection — no caching, instant effect. |
| User types during idle window | `onData` sets `lastUserInputAt`; gate 3 rejects detection for 800ms. |
| CLI exits / session disconnects | `onWriteParsed` stops firing naturally. Watcher remains idle until tab closes. On alt-screen exit, watcher writes one-line summary to scrollback. |
| Ambiguous prompts (two rules could match) | Priority order, first non-null wins. |
| Invalid custom regex | Caught in watcher, rule skipped, one-time warning logged. |
| Log unbounded growth | Ring buffer cap 500 per tab. |
| `invoke` send failure | Caught, logged as `error` kind, no retry. |
| Non-AI alt-screen TUIs (tmux `confirm-before [y/N]`, some installers) | Known risk. Generic y/N rule may fire. Mitigations: (a) gate 3 suppresses while user is typing, (b) log panel gives immediate visibility, (c) user can disable auto mode for that tab. Documented limitation. |

## 11. Error Handling Principles

1. All watcher code runs in a top-level try/catch; exceptions never crash
   `TerminalView`.
2. Exceptions are logged to the tab's log panel with `kind: "error"`.
3. Cooldown triggers disable auto mode and require manual re-enable — no
   automatic recovery.
4. Custom rule regex validation happens at save time in settings UI; invalid
   regex cannot be persisted.

## 12. Testing Strategy

The project has no automated tests (per `CLAUDE.md`). Validation is manual,
supplemented by `npm run smoke:check`.

### 12.1 Acceptance matrix

1. **Baseline trigger** — In a `localshell` tab with auto mode on, run
   `node scripts/mock-ai-cli.mjs` (or real `claude`). Verify response `"2\r"`
   is sent when the 3-option prompt appears.
2. **Toggle off** — Disable ⚡, repeat; verify no injection.
3. **Cooldown** — Run the mock script in a loop that emits 25 prompts in
   30s. Verify the 21st triggers the cooldown toast and the ⚡ turns off.
4. **SSH** — Same as (1) but inside an `ssh` tab connected to a remote host
   where the CLI runs.
5. **Split-pane independence** — Open two panes, enable auto on left only.
   Run the mock on both. Verify only left auto-responds.
6. **User-typed key wins** — With auto on, manually press `3` (No) at the
   moment the prompt appears. Verify the 800ms user-input suppression
   window prevents auto from injecting.
7. **Custom rule** — Add rule `pattern: Proceed\?`, `response: \r`. Trigger
   from mock. Verify match and log entry.
8. **Non-AI TUI** — With auto on, run `vim`, `htop`, `less`. Verify no
   injection. Run `tmux kill-session` to hit a `confirm-before [y/N]`
   prompt; document the expected-false-positive behavior.
9. **Log export** — Export JSON, confirm valid JSON with expected fields.
10. **Restart persistence** — Restart GWShell, confirm settings (default
    enabled, cooldown count, custom rules) survived; confirm logs are gone.

### 12.2 Mock CLI script

`scripts/mock-ai-cli.mjs`:
- Node script, enters alt-screen (`\x1b[?1049h`).
- Prints a Claude-Code-styled prompt:
  ```
  Do you want to proceed?
  ❯ 1. Yes
    2. Yes, and don't ask again this session
    3. No, and tell Claude what to do differently
  ```
- On stdin input, logs received byte, prints "next prompt in 1s", loops.
- Exits cleanly on SIGINT, restoring the normal screen.

## 13. Rollout

- Feature ships **off by default**. Users opt in via settings or per-tab ⚡.
- No feature flag beyond settings — the settings gate is sufficient.
- Release note should explicitly warn: "Auto Mode injects keystrokes into
  your terminal. Review the log panel to audit. Disable immediately on
  unexpected behavior."

## 14. Follow-up Work (explicitly out of scope)

- Capture real Codex and Gemini CLI prompt formats; replace the placeholder
  rules in §6.5 with specific patterns.
- Docker terminal support (would need backend intercept, since docker PTY
  behaves differently).
- Per-session rule scoping if demand emerges.
- Optional SQLite log persistence for audit use cases.
