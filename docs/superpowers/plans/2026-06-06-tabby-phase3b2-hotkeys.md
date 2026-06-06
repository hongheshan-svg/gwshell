# Phase 3b-2: Configurable Hotkeys Implementation Plan

> REQUIRED SUB-SKILL: subagent-driven-development. Steps use `- [ ]`.

**Goal:** Make global app shortcuts (broadcast, palette, tab next/prev/close, settings) rebindable via a keymap registry + editable settings UI, replacing the hardcoded App.tsx listener. Terminal keys stay non-rebindable.

**Architecture:** New `src/keymap/{actions,match,dispatch}.ts` (greenfield: registry, key matcher with chord support, window-capture dispatcher). Bindings persist as `keymapOverrides` on AppSettings. Settings UI gets an editable shortcut section. No Rust.

**Tech Stack:** React, TS, Zustand, i18next.

## Verification: `npx tsc --noEmit`, `npm run smoke:check`, `npm run build`. No cargo. Commit per task.

---

### Task 1: keymap core (`src/keymap/`)

- [ ] **Step 1: Create `src/keymap/match.ts`**
```ts
export interface Step { ctrl: boolean; shift: boolean; alt: boolean; meta: boolean; key: string }
export type Chord = Step[];

function normKey(k: string): string {
  const m: Record<string, string> = {
    ',': 'Comma', comma: 'Comma', ' ': 'Space', space: 'Space',
    esc: 'Escape', escape: 'Escape', del: 'Delete', delete: 'Delete',
    ins: 'Insert', insert: 'Insert', return: 'Enter', enter: 'Enter',
    tab: 'Tab', backspace: 'Backspace',
  };
  const lower = k.toLowerCase();
  if (m[lower]) return m[lower];
  if (/^[a-z]$/.test(lower)) return lower.toUpperCase();
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return 'F' + lower.slice(1);
  return k.length === 1 ? k.toUpperCase() : k;
}

export function parseBinding(binding: string): Chord | null {
  const steps = binding.trim().split(/\s+/).filter(Boolean);
  if (steps.length === 0) return null;
  const chord: Chord = [];
  for (const step of steps) {
    const parts = step.split('+').map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return null;
    const s: Step = { ctrl: false, shift: false, alt: false, meta: false, key: '' };
    for (const p of parts) {
      const lp = p.toLowerCase();
      if (lp === 'ctrl' || lp === 'control') s.ctrl = true;
      else if (lp === 'shift') s.shift = true;
      else if (lp === 'alt' || lp === 'option') s.alt = true;
      else if (lp === 'meta' || lp === 'cmd' || lp === 'command' || lp === 'win' || lp === 'super') s.meta = true;
      else s.key = normKey(p);
    }
    if (!s.key) return null;
    chord.push(s);
  }
  return chord;
}

function eventKey(e: KeyboardEvent): string {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
  if (/^Digit[0-9]$/.test(e.code)) return e.code.slice(5);
  if (e.code === 'Comma') return 'Comma';
  if (e.code === 'Space') return 'Space';
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.code)) return e.code;
  return normKey(e.key);
}

export function matchStep(e: KeyboardEvent, st: Step): boolean {
  return e.ctrlKey === st.ctrl && e.shiftKey === st.shift && e.altKey === st.alt && e.metaKey === st.meta
    && eventKey(e).toLowerCase() === st.key.toLowerCase();
}

export function eventToStep(e: KeyboardEvent): Step | null {
  if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta') return null;
  return { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey, key: eventKey(e) };
}

export function formatStep(st: Step): string {
  const mods: string[] = [];
  if (st.ctrl) mods.push('Ctrl');
  if (st.shift) mods.push('Shift');
  if (st.alt) mods.push('Alt');
  if (st.meta) mods.push('Meta');
  return [...mods, st.key].join('+');
}

export function stepToBinding(st: Step): string { return formatStep(st); }
```

- [ ] **Step 2: Create `src/keymap/actions.ts`**
```ts
import type { TranslationKeys } from '../i18n';
import { useAppStore } from '../stores/appStore';

export interface KeyAction { id: string; labelKey: TranslationKeys; defaultBinding: string; run: () => void }

function cycleTab(dir: 1 | -1): void {
  const { tabs, activeTabId, setActiveTab } = useAppStore.getState();
  const term = tabs.filter((t) => t.type !== 'asset-list');
  if (term.length === 0) return;
  const cur = term.findIndex((t) => t.id === activeTabId);
  const next = cur < 0 ? 0 : (cur + dir + term.length) % term.length;
  setActiveTab(term[next].id);
}

export const KEY_ACTIONS: KeyAction[] = [
  { id: 'broadcast.toggle', labelKey: 'action_broadcast_toggle', defaultBinding: 'Ctrl+Shift+B', run: () => useAppStore.getState().toggleBroadcastInput() },
  { id: 'palette.open', labelKey: 'action_palette_open', defaultBinding: 'Ctrl+Shift+F', run: () => useAppStore.getState().setShowCommandPalette(true) },
  { id: 'tab.next', labelKey: 'action_tab_next', defaultBinding: 'Ctrl+Tab', run: () => cycleTab(1) },
  { id: 'tab.prev', labelKey: 'action_tab_prev', defaultBinding: 'Ctrl+Shift+Tab', run: () => cycleTab(-1) },
  { id: 'tab.close', labelKey: 'action_tab_close', defaultBinding: 'Ctrl+W', run: () => { const { activeTabId, removeTab } = useAppStore.getState(); if (activeTabId) removeTab(activeTabId); } },
  { id: 'settings.open', labelKey: 'action_settings_open', defaultBinding: 'Ctrl+Comma', run: () => useAppStore.getState().setShowSettings(true) },
];

export const ACTION_BY_ID = new Map(KEY_ACTIONS.map((a) => [a.id, a]));
```
> Confirm appStore exposes `toggleBroadcastInput`, `setShowCommandPalette`, `setActiveTab`, `removeTab`, `setShowSettings`, `tabs`, `activeTabId` (all exist). i18n keys `action_*` are added in Task 3.

- [ ] **Step 3: Create `src/keymap/dispatch.ts`**
```ts
import { ACTION_BY_ID, KEY_ACTIONS } from './actions';
import { parseBinding, matchStep, type Chord } from './match';

export interface ResolvedBinding { actionId: string; chord: Chord }

export function resolveBindings(overrides: Record<string, string | null>): ResolvedBinding[] {
  const out: ResolvedBinding[] = [];
  for (const action of KEY_ACTIONS) {
    const ov = overrides[action.id];
    const binding = ov === undefined ? action.defaultBinding : ov;
    if (binding === null) continue;
    const chord = parseBinding(binding);
    if (chord) out.push({ actionId: action.id, chord });
  }
  return out;
}

const CHORD_TIMEOUT_MS = 1000;

export function createKeymapHandler(getOverrides: () => Record<string, string | null>): (e: KeyboardEvent) => void {
  let pending: { binding: ResolvedBinding; stepIndex: number; timer: ReturnType<typeof setTimeout> } | null = null;
  const clearPending = () => { if (pending) { clearTimeout(pending.timer); pending = null; } };

  return (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta') return;
    const bindings = resolveBindings(getOverrides());

    if (pending) {
      const next = pending.binding.chord[pending.stepIndex];
      if (next && matchStep(e, next)) {
        e.preventDefault(); e.stopPropagation();
        if (pending.stepIndex + 1 >= pending.binding.chord.length) {
          const id = pending.binding.actionId; clearPending(); ACTION_BY_ID.get(id)?.run();
        } else {
          pending.stepIndex += 1; clearTimeout(pending.timer); pending.timer = setTimeout(clearPending, CHORD_TIMEOUT_MS);
        }
        return;
      }
      clearPending();
    }

    for (const b of bindings) {
      if (matchStep(e, b.chord[0])) {
        e.preventDefault(); e.stopPropagation();
        if (b.chord.length === 1) ACTION_BY_ID.get(b.actionId)?.run();
        else pending = { binding: b, stepIndex: 1, timer: setTimeout(clearPending, CHORD_TIMEOUT_MS) };
        return;
      }
    }
  };
}
```

- [ ] **Step 4:** `npx tsc --noEmit` (will fail only on the missing `action_*` i18n keys used as `TranslationKeys` — those are added in Task 3; if it errors ONLY on those, proceed to Task 3 then re-check). Commit:
```bash
git add src/keymap/match.ts src/keymap/actions.ts src/keymap/dispatch.ts
git commit -m "feat(keymap): registry + key matcher (chord) + dispatcher"
```

---

### Task 2: settings persistence (`keymapOverrides`)

- [ ] **Step 1:** In `src/stores/settingsStore.ts` `interface AppSettings` add `keymapOverrides: Record<string, string | null>;`; in `defaultSettings` add `keymapOverrides: {},`. In `SettingsModal.tsx`'s DUPLICATE `AppSettings` + `defaultSettings`, add the same.
- [ ] **Step 2:** In `normalizeSettings` (settingsStore.ts), before `return settings;`, add validation:
```ts
  if (settings.keymapOverrides && typeof settings.keymapOverrides === 'object') {
    const valid: Record<string, string | null> = {};
    for (const [id, binding] of Object.entries(settings.keymapOverrides)) {
      if (!ACTION_IDS.has(id)) continue;
      if (binding === null) { valid[id] = null; continue; }
      if (typeof binding === 'string' && parseBinding(binding)) valid[id] = binding;
    }
    settings.keymapOverrides = valid;
  } else {
    settings.keymapOverrides = {};
  }
```
Add imports at top of settingsStore.ts:
```ts
import { parseBinding } from '../keymap/match';
import { KEY_ACTIONS } from '../keymap/actions';
const ACTION_IDS = new Set(KEY_ACTIONS.map((a) => a.id));
```
- [ ] **Step 2b:** `npx tsc --noEmit` zero errors. Commit:
```bash
git add src/stores/settingsStore.ts src/components/Settings/SettingsModal.tsx
git commit -m "feat(keymap): persist + normalize keymapOverrides on AppSettings"
```

---

### Task 3: App.tsx integration + i18n

- [ ] **Step 1:** In `src/App.tsx`, REMOVE the Phase-3a hotkey effect (the `useEffect` with `window.addEventListener('keydown', onKey, true)` that handles Ctrl+Shift+B → toggleBroadcastInput / Ctrl+Shift+F → setShowCommandPalette). Also remove the now-unused `const toggleBroadcastInput = useAppStore((s) => s.toggleBroadcastInput);` and `const setShowCommandPalette = useAppStore((s) => s.setShowCommandPalette);` selectors IF they become unused after removal (grep the file — `setShowCommandPalette` may still be used elsewhere; remove only if unused).
- [ ] **Step 2:** Add the keymap import + effect:
```tsx
import { createKeymapHandler } from './keymap/dispatch';
```
```tsx
  const keymapOverrides = useSettingsStore((s) => s.settings.keymapOverrides);
  useEffect(() => {
    const handler = createKeymapHandler(() => useSettingsStore.getState().settings.keymapOverrides);
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [keymapOverrides]);
```
- [ ] **Step 3:** i18n — add to BOTH `gwshell.en.json` and `gwshell.zh.json`:
en: `action_broadcast_toggle`:"Toggle input broadcast", `action_palette_open`:"Open command palette", `action_tab_next`:"Next tab", `action_tab_prev`:"Previous tab", `action_tab_close`:"Close tab", `action_settings_open`:"Open settings", `shortcut_press_key`:"Press a key…", `shortcut_conflict`:"Already bound to another action", `shortcut_reset`:"Reset", `shortcut_unbind`:"Unbind", `settings_shortcut_editable`:"Customizable shortcuts".
zh: 对应:"切换输入广播","打开命令面板","下一个标签","上一个标签","关闭标签","打开设置","按下按键…","已绑定到其它动作","恢复默认","解绑","可自定义快捷键".
- [ ] **Step 4:** `npx tsc --noEmit` zero errors; both JSON valid. Commit:
```bash
git add src/App.tsx src/i18n/locales/gwshell.en.json src/i18n/locales/gwshell.zh.json
git commit -m "feat(keymap): drive global shortcuts via configurable keymap; i18n"
```

---

### Task 4: Editable shortcut UI

**Files:** Create `src/components/Settings/ShortcutEditor.tsx`; Modify `SettingsModal.tsx`; `global.css`.

- [ ] **Step 1: Create `src/components/Settings/ShortcutEditor.tsx`**
```tsx
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settingsStore';
import { KEY_ACTIONS } from '../../keymap/actions';
import { eventToStep, stepToBinding, parseBinding } from '../../keymap/match';

export const ShortcutEditor: React.FC = () => {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const save = useSettingsStore((s) => s.save);
  const [capturing, setCapturing] = useState<string | null>(null);
  const [error, setError] = useState('');

  const overrides = settings.keymapOverrides || {};
  const currentBinding = (id: string): string | null => {
    const ov = overrides[id];
    if (ov !== undefined) return ov; // string or null
    return KEY_ACTIONS.find((a) => a.id === id)?.defaultBinding ?? null;
  };

  const setOverride = (id: string, value: string | null) => {
    void save({ ...settings, keymapOverrides: { ...overrides, [id]: value } });
  };
  const resetOverride = (id: string) => {
    const next = { ...overrides };
    delete next[id];
    void save({ ...settings, keymapOverrides: next });
  };

  const onCaptureKey = (id: string, e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { setCapturing(null); setError(''); return; }
    const step = eventToStep(e.nativeEvent);
    if (!step) return; // pure modifier — keep waiting
    const binding = stepToBinding(step);
    if (!parseBinding(binding)) { setError(t('shortcut_conflict')); return; }
    // conflict check within the rebindable set
    const clash = KEY_ACTIONS.find((a) => a.id !== id && currentBinding(a.id) === binding);
    if (clash) { setError(t('shortcut_conflict')); return; }
    setOverride(id, binding);
    setCapturing(null);
    setError('');
  };

  return (
    <div className="shortcut-editor">
      {KEY_ACTIONS.map((a) => {
        const b = currentBinding(a.id);
        return (
          <div className="shortcut-row" key={a.id}>
            <span className="shortcut-row-label">{t(a.labelKey)}</span>
            <div className="shortcut-row-keys">
              {capturing === a.id ? (
                <input
                  className="shortcut-capture"
                  autoFocus
                  readOnly
                  value={t('shortcut_press_key')}
                  onKeyDown={(e) => onCaptureKey(a.id, e)}
                  onBlur={() => { setCapturing(null); setError(''); }}
                />
              ) : (
                <button className="shortcut-chip" onClick={() => { setCapturing(a.id); setError(''); }}>
                  {b ? b.split(' ').map((s, i) => <kbd key={i}>{s}</kbd>) : <span className="shortcut-unbound">—</span>}
                </button>
              )}
              <button className="shortcut-mini" onClick={() => setOverride(a.id, null)} title={t('shortcut_unbind')}>⊘</button>
              <button className="shortcut-mini" onClick={() => resetOverride(a.id)} title={t('shortcut_reset')}>↺</button>
            </div>
          </div>
        );
      })}
      {error && <div className="shortcut-error">{error}</div>}
    </div>
  );
};
```

- [ ] **Step 2:** In `SettingsModal.tsx`, render `<ShortcutEditor />` at the top of the `shortcut-basic` settings section (find where the static `ShortcutTable` for basic shortcuts renders; add the editor above it with a heading `t('settings_shortcut_editable')`). Import `ShortcutEditor`.

- [ ] **Step 3:** Append `global.css`:
```css
.shortcut-editor { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.shortcut-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.shortcut-row-label { font-size: 13px; }
.shortcut-row-keys { display: flex; align-items: center; gap: 6px; }
.shortcut-chip { background: var(--input-bg, #111); border: 1px solid var(--border-color, #333); border-radius: 4px; padding: 4px 8px; cursor: pointer; color: inherit; display: inline-flex; gap: 4px; }
.shortcut-chip kbd { background: var(--bg-secondary, #222); border-radius: 3px; padding: 0 4px; font-size: 11px; }
.shortcut-unbound { color: var(--text-muted, #888); }
.shortcut-capture { width: 120px; background: var(--accent, #3b78ff); color: #fff; border: none; border-radius: 4px; padding: 4px 8px; text-align: center; }
.shortcut-mini { background: none; border: none; color: var(--text-muted, #aaa); cursor: pointer; }
.shortcut-mini:hover { color: inherit; }
.shortcut-error { color: #e06c75; font-size: 12px; }
```

- [ ] **Step 4:** `npx tsc --noEmit` zero errors. Commit:
```bash
git add src/components/Settings/ShortcutEditor.tsx src/components/Settings/SettingsModal.tsx src/styles/global.css
git commit -m "feat(keymap): editable shortcut UI in settings"
```

---

### Task 5: Final verification
- [ ] `npm run build`, `npm run smoke:check` (retry/fallback to tsc if blocked). Manual: rebind broadcast → Ctrl+Shift+B old binding stops, new works; persists across restart; unbind disables; reset restores; conflict rejected; terminal copy/paste/ghost/broadcast/palette unaffected.
- [ ] Commit any cleanup.

## Self-review
- Spec coverage: A(actions)↔T1; B(match)↔T1; C(dispatch)↔T1; D(persist)↔T2; E(App)↔T3; F(UI)↔T4. No Rust. No terminal changes.
- Types: `parseBinding`/`matchStep`/`eventToStep`/`stepToBinding`/`Step`/`Chord` (T1) used T2/T4; `createKeymapHandler`/`resolveBindings` (T1) used T3; `KEY_ACTIONS`/`ACTION_BY_ID`/`KeyAction` (T1) used T2/T3/T4; `keymapOverrides` key consistent (T2/T3/T4).
- Risk: terminal untouched; dispatcher window-capture + defaultPrevented bail + preventDefault/stopPropagation; capture-mode stops propagation.
