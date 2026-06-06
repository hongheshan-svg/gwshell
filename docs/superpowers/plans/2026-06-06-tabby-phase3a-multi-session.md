# Tabby-Merge Phase 3a: Multi-Session UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add input broadcast (type once → all connected terminals), a command/connection palette (Ctrl+Shift+F), and login-script-on-connect for SSH/serial/local (reusing the `\xNN`/`\sNNN` snippet escapes).

**Architecture:** All frontend (React/TS + Zustand + xterm.js). Reuses Phase 1's `sendInputToTab` and Phase 2's `expandSnippet`. A new `runScript` helper unifies snippet/login-script dispatch. No Rust/IPC changes — login scripts use existing `write_to_ssh`/`write_to_serial`/`write_to_pty`.

**Tech Stack:** React, TypeScript, Zustand, @xterm/xterm, i18next, lucide-react.

---

## Verification approach (read first)

Per `CLAUDE.md`: **no automated test framework.** Verify each task with `npx tsc --noEmit` (type gate; `npm run build` if the environment allows), `npm run smoke:check` when runnable, plus the per-task manual check. **No Rust changes — do not run `cargo`.** Commit after every task.

---

## File structure

- Create `src/lib/sendScript.ts` — `runScript(send, script)` (shared snippet/login-script dispatcher).
- Create `src/components/CommandPalette/CommandPalette.tsx` — the palette modal.
- Modify `src/stores/appStore.ts` — `broadcastInput`/`toggleBroadcastInput`, `showCommandPalette`/`setShowCommandPalette`.
- Modify `src/components/Terminal/TerminalView.tsx` — onData broadcast, `broadcasting` pane class, SSH/serial/local login scripts.
- Modify `src/components/Sidebar/SnippetPanel.tsx` — use `runScript` (DRY).
- Modify `src/components/StatusBar/StatusBar.tsx` — broadcast toggle.
- Modify `src/App.tsx` — global hotkeys + render palette.
- Modify `src/components/AppMenu/AppMenu.tsx` — wire "Quick Search".
- Modify `src/i18n/locales/gwshell.{en,zh}.json` — keys.
- Modify `src/styles/global.css` — broadcasting outline + palette styles.

---

## Task 1: `runScript` helper + SnippetPanel refactor

**Files:**
- Create: `src/lib/sendScript.ts`
- Modify: `src/components/Sidebar/SnippetPanel.tsx` (`send` ~32-48)

- [ ] **Step 1: Create `src/lib/sendScript.ts`**

```ts
import { expandSnippet } from './snippetExpand';

// Runs a script string (honoring \xNN control bytes, \sNNN delays, \n/\r/\t/\\)
// by dispatching its text segments through `send`, scheduling delayed segments
// at their cumulative offset via setTimeout.
export function runScript(send: (data: string) => void, script: string): void {
  let delay = 0;
  for (const seg of expandSnippet(script)) {
    if (seg.kind === 'delay') {
      delay += seg.delayMs;
    } else {
      const text = seg.text;
      if (delay === 0) send(text);
      else setTimeout(() => send(text), delay);
    }
  }
}
```

- [ ] **Step 2: Refactor `SnippetPanel.send` to use it**

In `src/components/Sidebar/SnippetPanel.tsx`, replace the `send` function (currently expands and schedules inline):
```ts
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
```
with:
```ts
  const send = (snippet: Snippet) => {
    if (!canSend || !activeTab) {
      setError(t('snippet_no_terminal'));
      return;
    }
    setError('');
    runScript((d) => sendInputToTab(activeTab.id, d), snippet.command);
  };
```
Update imports: add `import { runScript } from '../../lib/sendScript';`. The `expandSnippet` import is now unused in this file — REMOVE it from `import { expandSnippet } from '../../lib/snippetExpand';` (delete that import line) to keep tsc clean under `noUnusedLocals`.

- [ ] **Step 3: Verify type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/sendScript.ts src/components/Sidebar/SnippetPanel.tsx
git commit -m "feat(script): extract runScript dispatcher; SnippetPanel uses it"
```

---

## Task 2: appStore state (broadcast + palette)

**Files:**
- Modify: `src/stores/appStore.ts` (interface ~39-63; impl ~165-226)

- [ ] **Step 1: Extend the interface**

In `src/stores/appStore.ts`, in the `AppStore` interface, in the `// Tabs` section (after `updateTabConnected`), add:
```ts
  // Broadcast
  broadcastInput: boolean;
  toggleBroadcastInput: () => void;
```
In the `// Modals` section (after `setShowQuickConnect`), add:
```ts
  showCommandPalette: boolean;
  setShowCommandPalette: (show: boolean) => void;
```

- [ ] **Step 2: Implement them**

In the store implementation object, near the tab actions, add:
```ts
  broadcastInput: false,
  toggleBroadcastInput: () => set((s) => ({ broadcastInput: !s.broadcastInput })),
```
Near the modal flags (next to `showQuickConnect`/`setShowQuickConnect`), add:
```ts
  showCommandPalette: false,
  setShowCommandPalette: (show) => set({ showCommandPalette: show }),
```

- [ ] **Step 3: Verify type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/stores/appStore.ts
git commit -m "feat(store): broadcastInput + command palette flags"
```

---

## Task 3: Login scripts on connect (SSH/serial/local)

**Files:**
- Modify: `src/components/Terminal/TerminalView.tsx` (local `:1308`; SSH after `:1339`; serial after `:1388`)

- [ ] **Step 1: Import `runScript`**

In `src/components/Terminal/TerminalView.tsx`, add near the other `../../lib/*` imports:
```ts
import { runScript } from '../../lib/sendScript';
```

- [ ] **Step 2: Migrate the local-shell init command**

Find (in the `localshell` branch):
```ts
          if (session?.init_command) {
            const cmd = session.init_command;
            setTimeout(() => {
              invoke("write_to_pty", { sessionId: tab.sessionId, data: cmd + "\n" }).catch(() => {});
            }, 300);
          }
```
Replace with (keep the 300ms shell-ready delay; run the script with escape support):
```ts
          if (session?.init_command) {
            const cmd = session.init_command;
            setTimeout(() => {
              runScript((d) => { invoke("write_to_pty", { sessionId: tab.sessionId, data: d }).catch(() => {}); }, cmd);
            }, 300);
          }
```

- [ ] **Step 3: Add the SSH init command**

In the `ssh` branch, find `await doSshConnect(session);` followed by `connectionReady = true;`. IMMEDIATELY AFTER `connectionReady = true;` (and before the `if (session.tunnel_enabled ...)` block), add:
```ts
            if (session.init_command) {
              const cmd = session.init_command;
              setTimeout(() => {
                runScript((d) => { invoke("write_to_ssh", { sessionId: tab.sessionId, data: d }).catch(() => {}); }, cmd);
              }, 300);
            }
```

- [ ] **Step 4: Add the serial init commands**

In the `serial` branch, find the `await invoke("serial_open", {...});` call followed by `connectionReady = true;`. IMMEDIATELY AFTER that `connectionReady = true;`, add:
```ts
            if (session.serial_init_commands) {
              const cmd = session.serial_init_commands;
              setTimeout(() => {
                runScript((d) => { invoke("write_to_serial", { sessionId: tab.sessionId, data: d }).catch(() => {}); }, cmd);
              }, 300);
            }
```

- [ ] **Step 5: Verify type-check**

Run: `npx tsc --noEmit`
Expected: zero errors. (`session` is non-null in these branches — the surrounding code already dereferences `session.host`/`session.serial_port`; if tsc complains about `session` possibly-undefined, use `session?.init_command` / `session?.serial_init_commands` and capture into a local const guarded by the `if`.)

- [ ] **Step 6: Manual check**

`npm run tauri dev` (if runnable): set an SSH session's `init_command` to `whoami\s500\nls\n` → on connect, `whoami` runs, then after ~500ms `ls` runs. Serial `serial_init_commands` similarly. Local shell init still works.

- [ ] **Step 7: Commit**

```bash
git add src/components/Terminal/TerminalView.tsx
git commit -m "feat(login-script): run init_command on SSH/serial/local connect via runScript"
```

---

## Task 4: Input broadcast (onData fan-out + pane outline)

**Files:**
- Modify: `src/components/Terminal/TerminalView.tsx` (onData broadcast; pane className)

- [ ] **Step 1: Subscribe to broadcastInput for the pane class**

In `src/components/Terminal/TerminalView.tsx`, near the other `useAppStore((s) => ...)` subscriptions in the component body, add:
```ts
  const broadcastInput = useAppStore((s) => s.broadcastInput);
```

- [ ] **Step 2: Add the `broadcasting` class to the pane**

Find the returned pane element:
```tsx
      <div
        ref={containerRef}
        className="terminal-pane"
        style={{ display: isActive ? "block" : "none" }}
      />
```
Change the className to:
```tsx
        className={`terminal-pane${broadcastInput ? ' broadcasting' : ''}`}
```

- [ ] **Step 3: Fan out keystrokes in `onData`**

In the `onData` handler, find where the command-history block ends and the `writeQueue += data;` write begins. IMMEDIATELY BEFORE `writeQueue += data;`, add:
```ts
        // Input broadcast: fan this keystroke to all OTHER connected interactive
        // terminals. The focused tab still writes to itself below. No echo loop:
        // sendInputToTab feeds writeQueue/IPC, it does not trigger onData.
        {
          const app = useAppStore.getState();
          if (app.broadcastInput) {
            for (const tb of app.tabs) {
              if (
                tb.id !== tab.id && tb.connected &&
                (tb.type === 'ssh' || tb.type === 'localshell' || tb.type === 'serial' || tb.type === 'docker')
              ) {
                sendInputToTab(tb.id, data);
              }
            }
          }
        }
```

- [ ] **Step 4: Add the broadcast outline style**

Append to `src/styles/global.css`:
```css
.terminal-pane.broadcasting {
  outline: 2px solid var(--accent, #3b78ff);
  outline-offset: -2px;
}
```

- [ ] **Step 5: Verify type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/Terminal/TerminalView.tsx src/styles/global.css
git commit -m "feat(broadcast): fan keystrokes to all connected terminals when enabled"
```

---

## Task 5: StatusBar broadcast toggle

**Files:**
- Modify: `src/components/StatusBar/StatusBar.tsx`
- Modify: `src/i18n/locales/gwshell.{en,zh}.json`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Add the toggle button**

In `src/components/StatusBar/StatusBar.tsx`:
- Add `Radio` to the lucide import: `import { Wifi, Clock, Monitor, Radio } from 'lucide-react';`
- Change the destructure to include broadcast: `const { tabs, activeTabId, sessions, locale, broadcastInput, toggleBroadcastInput } = useAppStore();`
- After the existing connection/type status items (after the `</>` that closes the `activeTab && ...` block, before `<div className="status-spacer" />`), add:
```tsx
      {(() => {
        const connectedCount = tabs.filter((tb) => tb.connected && tb.type !== 'asset-list').length;
        if (connectedCount === 0) return null;
        return (
          <button
            className={`status-item status-broadcast${broadcastInput ? ' active' : ''}`}
            onClick={toggleBroadcastInput}
            title={t('status_broadcast')}
            type="button"
          >
            <Radio size={11} />
            <span>{t('status_broadcast')}{broadcastInput ? ` (${connectedCount})` : ''}</span>
          </button>
        );
      })()}
```

- [ ] **Step 2: Add i18n key**

In `src/i18n/locales/gwshell.en.json` add: `"status_broadcast": "Broadcast",`
In `src/i18n/locales/gwshell.zh.json` add: `"status_broadcast": "广播输入",`
(Place anywhere valid; keep JSON valid — no trailing comma on the object's last key.)

- [ ] **Step 3: Add styles**

Append to `src/styles/global.css`:
```css
.status-broadcast {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  font: inherit;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.status-broadcast.active {
  color: #fff;
  background: var(--accent, #3b78ff);
  border-radius: 3px;
  padding: 0 6px;
}
```

- [ ] **Step 4: Verify type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/StatusBar/StatusBar.tsx src/i18n/locales/gwshell.en.json src/i18n/locales/gwshell.zh.json src/styles/global.css
git commit -m "feat(broadcast): status bar toggle"
```

---

## Task 6: Command palette component

**Files:**
- Create: `src/components/CommandPalette/CommandPalette.tsx`
- Modify: `src/i18n/locales/gwshell.{en,zh}.json`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Create `CommandPalette.tsx` with EXACTLY:**

```tsx
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import type { SessionConfig, TabInfo } from '../../types';

type Item =
  | { kind: 'session'; session: SessionConfig; label: string; sub: string }
  | { kind: 'tab'; tab: TabInfo; label: string; sub: string };

export const CommandPalette: React.FC = () => {
  const { t } = useTranslation();
  const { sessions, tabs, addTab, setActiveTab, setShowCommandPalette } = useAppStore();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);

  const items = useMemo<Item[]>(() => {
    const sessionItems: Item[] = sessions
      .filter((s) => !s._temporary)
      .map((s) => ({ kind: 'session' as const, session: s, label: s.name, sub: s.host ?? s.session_type }));
    const tabItems: Item[] = tabs
      .filter((tb) => tb.type !== 'asset-list')
      .map((tb) => ({ kind: 'tab' as const, tab: tb, label: tb.title, sub: tb.type }));
    const all = [...sessionItems, ...tabItems];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((it) => it.label.toLowerCase().includes(q) || it.sub.toLowerCase().includes(q));
  }, [query, sessions, tabs]);

  const close = () => setShowCommandPalette(false);

  const activate = (it: Item | undefined) => {
    if (!it) return;
    if (it.kind === 'session') {
      const existing = tabs.find((tb) => tb.sessionId === it.session.id);
      if (existing) setActiveTab(existing.id);
      else addTab({ id: crypto.randomUUID(), sessionId: it.session.id, title: it.session.name, type: it.session.session_type, connected: false });
    } else {
      setActiveTab(it.tab.id);
    }
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); activate(items[index]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };

  return (
    <div className="command-palette-overlay" onMouseDown={close}>
      <div className="command-palette-card" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <input
          className="command-palette-input"
          autoFocus
          placeholder={t('palette_placeholder')}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
        />
        <div className="command-palette-list">
          {items.length === 0 && <div className="command-palette-empty">{t('palette_no_results')}</div>}
          {items.map((it, i) => (
            <div
              key={it.kind === 'session' ? `s-${it.session.id}` : `t-${it.tab.id}`}
              className={`command-palette-item${i === index ? ' active' : ''}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => activate(it)}
            >
              <span className="command-palette-item-label">{it.label}</span>
              <span className="command-palette-item-sub">{it.kind === 'tab' ? '↹ ' : ''}{it.sub}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Add i18n keys**

In `gwshell.en.json` add:
```json
  "palette_placeholder": "Search sessions and tabs…",
  "palette_no_results": "No matches",
```
In `gwshell.zh.json` add:
```json
  "palette_placeholder": "搜索会话和标签…",
  "palette_no_results": "无匹配",
```

- [ ] **Step 3: Add styles**

Append to `src/styles/global.css`:
```css
.command-palette-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 14vh;
  background: rgba(0, 0, 0, 0.4);
}
.command-palette-card {
  width: min(560px, 92%);
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  border-radius: 8px;
  background: var(--bg-secondary, #1b1b24);
  border: 1px solid var(--border-color, #33333f);
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}
.command-palette-input {
  padding: 12px 14px;
  border: none;
  border-bottom: 1px solid var(--border-color, #33333f);
  background: transparent;
  color: inherit;
  font-size: 14px;
  outline: none;
}
.command-palette-list { overflow-y: auto; }
.command-palette-empty { padding: 16px 14px; color: var(--text-muted, #888); font-size: 13px; }
.command-palette-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 14px;
  cursor: pointer;
}
.command-palette-item.active { background: var(--accent, #3b78ff); color: #fff; }
.command-palette-item-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.command-palette-item-sub { font-size: 12px; color: var(--text-muted, #999); white-space: nowrap; }
.command-palette-item.active .command-palette-item-sub { color: rgba(255, 255, 255, 0.8); }
```

- [ ] **Step 4: Verify type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/CommandPalette/CommandPalette.tsx src/i18n/locales/gwshell.en.json src/i18n/locales/gwshell.zh.json src/styles/global.css
git commit -m "feat(palette): command/connection palette component"
```

---

## Task 7: Global hotkeys + render palette + wire AppMenu

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/AppMenu/AppMenu.tsx`

- [ ] **Step 1: App.tsx — lazy import + destructure + render**

In `src/App.tsx`:
- Add a lazy import near the other modal lazy imports:
```tsx
const CommandPalette = lazy(() => import('./components/CommandPalette/CommandPalette').then((m) => ({ default: m.CommandPalette })));
```
- Add `showCommandPalette` to the `useAppStore()` destructure (alongside `showNewSession`, etc.).
- In the Suspense modal-render block (where `{showQuickConnect && <QuickConnectModal />}` is), add:
```tsx
          {showCommandPalette && <CommandPalette />}
```

- [ ] **Step 2: App.tsx — global hotkeys effect**

In `App()`, add these store selectors near the other hooks:
```tsx
  const toggleBroadcastInput = useAppStore((s) => s.toggleBroadcastInput);
  const setShowCommandPalette = useAppStore((s) => s.setShowCommandPalette);
```
Then add an effect (alongside the other `useEffect`s):
```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); toggleBroadcastInput(); }
      else if (k === 'f') { e.preventDefault(); setShowCommandPalette(true); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [toggleBroadcastInput, setShowCommandPalette]);
```

- [ ] **Step 3: AppMenu.tsx — wire "Quick Search"**

In `src/components/AppMenu/AppMenu.tsx`:
- Add `setShowCommandPalette` to the `useAppStore()` destructure (confirm `setShowAppMenu` is already destructured — it is, used by other items).
- Change the Quick Search item (currently `<div className="app-menu-item"><Search .../><span>{t('menu_quick_search')}</span><span className="app-menu-shortcut">Ctrl+Shift+F</span></div>`) to add an onClick:
```tsx
        <div className="app-menu-item" onClick={() => { setShowAppMenu(false); setShowCommandPalette(true); }}>
          <Search size={14} />
          <span>{t('menu_quick_search')}</span>
          <span className="app-menu-shortcut">Ctrl+Shift+F</span>
        </div>
```

- [ ] **Step 4: Verify type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Manual check**

`npm run tauri dev` (if runnable): `Ctrl+Shift+F` opens the palette; typing filters sessions+tabs; ↑↓ + Enter connects a session (or focuses an existing tab) / switches to a tab; Esc closes. The AppMenu "Quick Search" item also opens it. `Ctrl+Shift+B` toggles broadcast (status bar reflects it).

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/AppMenu/AppMenu.tsx
git commit -m "feat(palette): global Ctrl+Shift+F / Ctrl+Shift+B hotkeys; wire Quick Search menu"
```

---

## Task 8: Final verification

- [ ] **Step 1: Build + smoke (retry if env-blocked; fall back to `npx tsc --noEmit`)**

```bash
npm run build
npm run smoke:check
```
Report PASS/FAIL/BLOCKED per gate.

- [ ] **Step 2: Manual checklist (spec §5)**

`npm run tauri dev`:
1. Broadcast: open 2+ connected terminals; status bar toggle + `Ctrl+Shift+B`; type in one → all connected receive; disconnected tabs don't; broadcasting outline shows.
2. Palette: `Ctrl+Shift+F` + menu Quick Search; filter; Enter connects session / focuses existing / switches tab; Esc closes; no-results placeholder.
3. Login scripts: SSH `init_command` with `\sNNN` runs in order on connect; serial `serial_init_commands` likewise; local shell still works.
4. Regression: snippet panel send (now via runScript) still works; copy/paste/autocomplete unaffected.

- [ ] **Step 3: Final commit (if any cleanup)**

```bash
git add -A
git commit -m "chore(phase3a): final verification pass"
```

---

## Self-review notes (author)

- **Spec coverage:** A(broadcast)↔Task 2(state)+Task 4(fan-out)+Task 5(toggle); B(palette)↔Task 2(state)+Task 6(component)+Task 7(hotkey/render/menu); C(login scripts)↔Task 1(runScript)+Task 3(3 sites)+Task 1(SnippetPanel DRY). All §6 files covered. No Rust (matches spec).
- **Placeholder scan:** none.
- **Type consistency:** `runScript(send, script)` defined T1, used T1/T3; `broadcastInput`/`toggleBroadcastInput`/`showCommandPalette`/`setShowCommandPalette` defined T2, used T4/T5/T6/T7; `sendInputToTab` (Phase 1) used T4; `Item` type internal to CommandPalette; `addTab`/`setActiveTab` signatures match appStore. `session.init_command`/`serial_init_commands` are real `SessionConfig` fields.
- **Ordering:** T1 before T3 (runScript); T2 before T4/T5/T6/T7 (state); T6 before T7 (renders palette). Each task independently committable + tsc-clean.
