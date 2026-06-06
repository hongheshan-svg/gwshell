# In-terminal Search — Spec + Plan (final Tabby merge)

> REQUIRED SUB-SKILL: subagent-driven-development. Frontend-only, no Rust.

**Goal:** Search the active terminal's scrollback via `@xterm/addon-search`: a search bar (find next/prev, match count, highlight) opened by a rebindable hotkey, integrated with the Phase-3b-2 keymap.

**Architecture:** Load `SearchAddon` into each xterm instance (stored in the terminal registry). A `terminal.search` keymap action opens a `TerminalSearchBar` that drives the active tab's SearchAddon. Default off path unchanged.

## Verification: `npx tsc --noEmit`, `npm run build`, `npm run smoke:check`. No cargo. Commit per task.

---

### Task 1: dep + registry + load addon

**Files:** `package.json`; `src/components/Terminal/terminalRegistry.ts`; `src/components/Terminal/TerminalView.tsx`.

- [ ] `npm i @xterm/addon-search` (retry on classifier windows; `run_in_background` for the install if needed). Confirm it lands in package.json + package-lock.
- [ ] `terminalRegistry.ts`: add `searchAddon: SearchAddon` to the registered-instance type. Import `import type { SearchAddon } from '@xterm/addon-search';`.
- [ ] `TerminalView.tsx`: near where `FitAddon` is created/loaded (`const fitAddon = new FitAddon(); terminal.loadAddon(fitAddon);`), add:
```ts
import { SearchAddon } from '@xterm/addon-search';
// ...
const searchAddon = new SearchAddon();
terminal.loadAddon(searchAddon);
```
and include `searchAddon` in the object stored into `terminalInstances`/registry (alongside `terminal`, `fitAddon`). The addon is disposed with the terminal (no extra cleanup needed). READ the file to match the exact registry-store shape.
- [ ] `npx tsc --noEmit` clean. Commit `feat(search): load xterm SearchAddon per terminal`.

---

### Task 2: store flag + keymap action + i18n

**Files:** `src/stores/appStore.ts`; `src/keymap/actions.ts`; i18n.

- [ ] `appStore.ts`: interface + impl — `showTerminalSearch: boolean` (default false) + `setShowTerminalSearch: (b: boolean) => void`.
- [ ] `src/keymap/actions.ts`: add to `KEY_ACTIONS` (after the existing entries):
```ts
  { id: 'terminal.search', labelKey: 'action_terminal_search', defaultBinding: 'Ctrl+Shift+H', run: () => useAppStore.getState().setShowTerminalSearch(true) },
```
- [ ] i18n: `action_terminal_search` ("Search terminal" / "搜索终端"), `search_placeholder` ("Find…" / "查找…"), `search_no_results` ("No results" / "无结果") in BOTH locales.
- [ ] `npx tsc --noEmit` clean. Commit `feat(search): terminal.search keymap action + store flag`.

---

### Task 3: TerminalSearchBar + render

**Files:** Create `src/components/Terminal/TerminalSearchBar.tsx`; modify `src/App.tsx`; `src/styles/global.css`.

- [ ] Create `TerminalSearchBar.tsx`:
```tsx
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronUp, ChevronDown, X } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { terminalInstances } from './terminalRegistry';

export const TerminalSearchBar: React.FC = () => {
  const { t } = useTranslation();
  const { activeTabId, setShowTerminalSearch } = useAppStore();
  const [query, setQuery] = useState('');
  const [count, setCount] = useState<{ idx: number; total: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addon = () => (activeTabId ? terminalInstances.get(activeTabId)?.searchAddon : undefined);

  useEffect(() => {
    inputRef.current?.focus();
    const a = addon();
    if (!a) return;
    // match-count reporting (addon-search exposes onDidChangeResults)
    const sub = a.onDidChangeResults?.(({ resultIndex, resultCount }: { resultIndex: number; resultCount: number }) => {
      setCount(resultCount >= 0 ? { idx: resultIndex + 1, total: resultCount } : null);
    });
    return () => { try { sub?.dispose?.(); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId]);

  const opts = { decorations: { matchBackground: '#5a4500', activeMatchBackground: '#b58900' } };
  const findNext = () => { if (query) addon()?.findNext(query, opts); };
  const findPrev = () => { if (query) addon()?.findPrevious(query, opts); };
  const close = () => { try { addon()?.clearDecorations?.(); } catch {} setShowTerminalSearch(false); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) findPrev(); else findNext(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };

  return (
    <div className="terminal-search-bar" onKeyDown={onKeyDown}>
      <input
        ref={inputRef}
        className="terminal-search-input"
        placeholder={t('search_placeholder')}
        value={query}
        onChange={(e) => { setQuery(e.target.value); const a = addon(); if (a && e.target.value) a.findNext(e.target.value, { ...opts, incremental: true }); }}
      />
      <span className="terminal-search-count">{count ? `${count.idx}/${count.total}` : (query ? t('search_no_results') : '')}</span>
      <button className="terminal-search-btn" onClick={findPrev} title="Prev"><ChevronUp size={14} /></button>
      <button className="terminal-search-btn" onClick={findNext} title="Next"><ChevronDown size={14} /></button>
      <button className="terminal-search-btn" onClick={close} title="Close"><X size={14} /></button>
    </div>
  );
};
```
> If tsc objects to `onDidChangeResults`/`findNext` option shapes for the installed `@xterm/addon-search` version, adapt to the actual type signatures (read the package's `.d.ts`). The `decorations` option requires colors; if the version lacks it, call `findNext(query)` without options. Keep the feature working; match-count is best-effort (guard with `?.`).
- [ ] `App.tsx`: render `{showTerminalSearch && <TerminalSearchBar />}` near the terminal area (inside `.main-content`, above the terminal, or as an overlay). Add `showTerminalSearch` to the `useAppStore()` destructure. Import the component.
- [ ] `global.css`:
```css
.terminal-search-bar {
  position: absolute; top: 6px; right: 16px; z-index: 25;
  display: flex; align-items: center; gap: 4px;
  padding: 4px 6px; border-radius: 6px;
  background: var(--bg-secondary, #1b1b24); border: 1px solid var(--border-color, #33333f);
  box-shadow: 0 4px 12px rgba(0,0,0,0.4);
}
.terminal-search-input { background: var(--bg-primary, #0c0c14); border: 1px solid var(--border-color, #333); color: inherit; border-radius: 4px; padding: 3px 8px; font-size: 12px; width: 180px; }
.terminal-search-count { font-size: 11px; color: var(--text-muted, #999); min-width: 42px; text-align: center; }
.terminal-search-btn { background: none; border: none; color: var(--text-muted, #aaa); cursor: pointer; padding: 2px; display: inline-flex; }
.terminal-search-btn:hover { color: inherit; }
```
(Position it relative to the terminal container; ensure `.main-content`/terminal wrapper is `position: relative` — confirm and add if needed.)
- [ ] `npx tsc --noEmit` clean; `npm run build`; `npm run smoke:check`. Commit `feat(search): in-terminal search bar (find next/prev, count, highlight)`.

---

### Task 4: verify
- [ ] build + smoke. Manual: press the search hotkey (default Ctrl+Shift+H) in a terminal → bar appears; type → highlights + jumps; Enter/Shift+Enter next/prev; count shown; Esc closes + clears highlight. Rebindable via Settings (3b-2 keymap). Default (bar closed) terminal behavior unchanged.

## Self-review
- Addon loaded per terminal (registry); search acts on the ACTIVE tab's addon. Opt-in bar; default path unchanged. Keymap-integrated (rebindable). Types: `searchAddon` (T1) consumed T3; `showTerminalSearch`/`setShowTerminalSearch` (T2) used T2/T3; `terminal.search` action (T2). Best-effort match-count + decorations guarded for addon-version differences.
