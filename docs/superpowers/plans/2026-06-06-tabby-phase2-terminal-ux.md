# Tabby-Merge Phase 2: Terminal UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three no-dependency terminal-UX features: multiline-paste safety confirm, Quick Connect (`user@host:port` → ephemeral session), and selectable terminal color-scheme presets.

**Architecture:** All frontend (React/TS + xterm.js + Zustand). No Rust/IPC changes. A new `terminalThemes.ts` becomes the single source of xterm color schemes (incl. the existing auto light/dark); paste-safety adds a React confirm overlay around the existing `doPaste`; Quick Connect adds a parser + a lightweight modal that registers an in-memory `_temporary` session.

**Tech Stack:** React, TypeScript, Zustand, @xterm/xterm (ITheme), i18next.

---

## Verification approach (read first)

Per `CLAUDE.md`: **no automated test framework.** Each task verifies via:
- `npx tsc --noEmit` (type gate; `npm run build` may be blocked by an environment classifier — `npx tsc --noEmit` is the reliable substitute, run `npm run build` if available).
- `npm run smoke:check` when runnable.
- Manual checks per task.

**No Rust changes in this phase** — do NOT run/need `cargo`. Commit after every task.

> **Known duplication (Phase 1 lesson):** `AppSettings` + `defaultSettings` are declared TWICE — `src/stores/settingsStore.ts` AND `src/components/Settings/SettingsModal.tsx`. Any new setting must be added to BOTH. Settings row helpers are `Row`/`Toggle`/`Sel`/`NumInput` with updater `u('key', v)`.
> **Tauri/clipboard note:** no IPC added here; clipboard read/write already wired in TerminalView.

---

## File structure

- Create `src/lib/terminalThemes.ts` — all xterm color schemes + `resolveTerminalTheme` + `TERMINAL_SCHEME_OPTIONS`.
- Create `src/lib/quickConnect.ts` — `parseQuickConnect`.
- Create `src/components/Modals/QuickConnectModal.tsx` — the quick-connect modal.
- Modify `src/components/Terminal/TerminalView.tsx` — use `resolveTerminalTheme`; paste-safety overlay.
- Modify `src/hooks/useSettingsEffects.ts` — live theme-scheme apply.
- Modify `src/stores/appStore.ts` — `showQuickConnect` + `addTemporarySession`.
- Modify `src/stores/settingsStore.ts` + `src/components/Settings/SettingsModal.tsx` — 2 new settings (both copies).
- Modify `src/components/Sidebar/IconNav.tsx` — quickconnect → modal.
- Modify `src/App.tsx` — render QuickConnectModal.
- Modify `src/i18n/locales/gwshell.{en,zh}.json` — keys.
- Modify `src/styles/global.css` — paste-confirm + quick-connect styles.

---

## Task 1: `terminalThemes.ts` (color-scheme registry)

**Files:**
- Create: `src/lib/terminalThemes.ts`

- [ ] **Step 1: Create the file with EXACTLY:**

```ts
import type { ITheme } from '@xterm/xterm';
import type { ThemeMode } from '../types';

// NOTE: these are plain objects (not annotated `: ITheme`) so excess-property
// checks don't fire on the scrollbar fields; they're returned as ITheme below,
// where assignability (not literal excess checking) applies — matching the
// previous getTerminalThemeColors pattern.

const AUTO_DARK = {
  background: '#0c0c14', foreground: '#d4d4d8', cursor: '#a0a0b0', cursorAccent: '#0c0c14',
  selectionBackground: 'rgba(160, 160, 176, 0.3)',
  black: '#1a1a28', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
  blue: '#5ac8fa', magenta: '#c084fc', cyan: '#22d3ee', white: '#d4d4d8',
  brightBlack: '#555570', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5',
  brightBlue: '#7dd6fc', brightMagenta: '#d8b4fe', brightCyan: '#67e8f9', brightWhite: '#ffffff',
  scrollbarSliderBackground: 'rgba(255, 255, 255, 0.18)',
  scrollbarSliderHoverBackground: 'rgba(255, 255, 255, 0.32)',
  scrollbarSliderActiveBackground: 'rgba(255, 255, 255, 0.46)',
};

const AUTO_LIGHT = {
  background: '#f0f0f4', foreground: '#1a1a2e', cursor: '#6e6e7a', cursorAccent: '#f0f0f4',
  selectionBackground: 'rgba(110, 110, 122, 0.25)',
  black: '#1a1a2e', red: '#dc2626', green: '#16a34a', yellow: '#ca8a04',
  blue: '#0078d4', magenta: '#9333ea', cyan: '#0891b2', white: '#d4d4d8',
  brightBlack: '#8888a0', brightRed: '#ef4444', brightGreen: '#22c55e', brightYellow: '#eab308',
  brightBlue: '#2a8de6', brightMagenta: '#a855f7', brightCyan: '#06b6d4', brightWhite: '#ffffff',
  scrollbarSliderBackground: 'rgba(0, 0, 0, 0.18)',
  scrollbarSliderHoverBackground: 'rgba(0, 0, 0, 0.30)',
  scrollbarSliderActiveBackground: 'rgba(0, 0, 0, 0.42)',
};

const DARK_SCROLLBAR = {
  scrollbarSliderBackground: 'rgba(255, 255, 255, 0.18)',
  scrollbarSliderHoverBackground: 'rgba(255, 255, 255, 0.32)',
  scrollbarSliderActiveBackground: 'rgba(255, 255, 255, 0.46)',
};
const LIGHT_SCROLLBAR = {
  scrollbarSliderBackground: 'rgba(0, 0, 0, 0.18)',
  scrollbarSliderHoverBackground: 'rgba(0, 0, 0, 0.30)',
  scrollbarSliderActiveBackground: 'rgba(0, 0, 0, 0.42)',
};

const CAMPBELL = {
  background: '#0c0c0c', foreground: '#cccccc', cursor: '#cccccc', cursorAccent: '#0c0c0c',
  selectionBackground: 'rgba(204, 204, 204, 0.3)',
  black: '#0c0c0c', red: '#c50f1f', green: '#13a10e', yellow: '#c19c00',
  blue: '#0037da', magenta: '#881798', cyan: '#3a96dd', white: '#cccccc',
  brightBlack: '#767676', brightRed: '#e74856', brightGreen: '#16c60c', brightYellow: '#f9f1a5',
  brightBlue: '#3b78ff', brightMagenta: '#b4009e', brightCyan: '#61d6d6', brightWhite: '#f2f2f2',
  ...DARK_SCROLLBAR,
};

const ONEDARK = {
  background: '#282c34', foreground: '#abb2bf', cursor: '#528bff', cursorAccent: '#282c34',
  selectionBackground: 'rgba(171, 178, 191, 0.3)',
  black: '#282c34', red: '#e06c75', green: '#98c379', yellow: '#e5c07b',
  blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
  brightBlack: '#5c6370', brightRed: '#e06c75', brightGreen: '#98c379', brightYellow: '#e5c07b',
  brightBlue: '#61afef', brightMagenta: '#c678dd', brightCyan: '#56b6c2', brightWhite: '#ffffff',
  ...DARK_SCROLLBAR,
};

const DRACULA = {
  background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2', cursorAccent: '#282a36',
  selectionBackground: 'rgba(248, 248, 242, 0.25)',
  black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
  blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
  brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5',
  brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#ffffff',
  ...DARK_SCROLLBAR,
};

const SOLARIZED_DARK = {
  background: '#002b36', foreground: '#839496', cursor: '#839496', cursorAccent: '#002b36',
  selectionBackground: 'rgba(131, 148, 150, 0.3)',
  black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
  blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
  brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83',
  brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
  ...DARK_SCROLLBAR,
};

const SOLARIZED_LIGHT = {
  background: '#fdf6e3', foreground: '#657b83', cursor: '#657b83', cursorAccent: '#fdf6e3',
  selectionBackground: 'rgba(101, 123, 131, 0.2)',
  black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
  blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
  brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83',
  brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
  ...LIGHT_SCROLLBAR,
};

const NORD = {
  background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9', cursorAccent: '#2e3440',
  selectionBackground: 'rgba(216, 222, 233, 0.25)',
  black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b',
  blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
  brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c', brightYellow: '#ebcb8b',
  brightBlue: '#81a1c1', brightMagenta: '#b48ead', brightCyan: '#8fbcbb', brightWhite: '#eceff4',
  ...DARK_SCROLLBAR,
};

// Preset registry (excludes 'auto', which follows the app light/dark theme).
export const TERMINAL_THEMES: Record<string, ITheme> = {
  campbell: CAMPBELL,
  onedark: ONEDARK,
  dracula: DRACULA,
  'solarized-dark': SOLARIZED_DARK,
  'solarized-light': SOLARIZED_LIGHT,
  nord: NORD,
};

// Order shown in the settings dropdown.
export const TERMINAL_SCHEME_OPTIONS: string[] = [
  'auto', 'campbell', 'onedark', 'dracula', 'solarized-dark', 'solarized-light', 'nord',
];

// Resolves a scheme name to an xterm ITheme. 'auto' (and unknown values) follow
// the app's light/dark theme.
export function resolveTerminalTheme(scheme: string, appTheme: ThemeMode): ITheme {
  if (scheme && scheme !== 'auto' && TERMINAL_THEMES[scheme]) {
    return TERMINAL_THEMES[scheme];
  }
  return appTheme === 'dark' ? AUTO_DARK : AUTO_LIGHT;
}
```

- [ ] **Step 2: Verify type-check**

Run: `npx tsc --noEmit`
Expected: zero errors. If tsc rejects any scrollbar field as not part of `ITheme`, remove the three `scrollbar*` keys from `DARK_SCROLLBAR`/`LIGHT_SCROLLBAR`/`AUTO_DARK`/`AUTO_LIGHT` (and the spreads) — the feature works without them. (The existing TerminalView code includes them and compiles, so they should be accepted.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/terminalThemes.ts
git commit -m "feat(theme): terminal color-scheme registry (6 presets + auto)"
```

---

## Task 2: Settings + i18n (both new settings + all Phase 2 keys)

**Files:**
- Modify: `src/stores/settingsStore.ts` (`AppSettings` + `defaultSettings`)
- Modify: `src/components/Settings/SettingsModal.tsx` (duplicate `AppSettings` + `defaultSettings` + rows)
- Modify: `src/i18n/locales/gwshell.en.json`, `gwshell.zh.json`

- [ ] **Step 1: Add fields to `settingsStore.ts`**

In `interface AppSettings`, after `sshHistoryCmdLoadCount: string;` add:
```ts
  pasteWarnMultiline: boolean;
  terminalColorScheme: string;
```
In `defaultSettings`, after `sshHistoryCmdLoadCount: '100',` add:
```ts
  pasteWarnMultiline: true,
  terminalColorScheme: 'auto',
```

- [ ] **Step 2: Add the same fields to `SettingsModal.tsx`'s duplicate declarations**

In its `export interface AppSettings`, after `sshHistoryCmdLoadCount: string;` add the same two lines:
```ts
  pasteWarnMultiline: boolean;
  terminalColorScheme: string;
```
In its local `defaultSettings`, after `sshHistoryCmdLoadCount: '100',` add:
```ts
  pasteWarnMultiline: true,
  terminalColorScheme: 'auto',
```

- [ ] **Step 3: Add the two setting rows + import in `SettingsModal.tsx`**

At the top of `SettingsModal.tsx`, add the import:
```ts
import { TERMINAL_SCHEME_OPTIONS } from '../../lib/terminalThemes';
```
In the SSH/SFTP settings section, after the existing `settings_cmd_hint_defer_remote` row (added in Phase 1), add:
```tsx
                    <Row label={t('settings_paste_warn_multiline')}><Toggle value={settings.pasteWarnMultiline} onChange={(v) => u('pasteWarnMultiline', v)} /></Row>
                    <Row label={t('settings_terminal_color_scheme')}><Sel value={settings.terminalColorScheme} options={TERMINAL_SCHEME_OPTIONS} onChange={(v) => u('terminalColorScheme', v)} /></Row>
```
> If the `Sel` component expects display labels rather than raw values, pass `TERMINAL_SCHEME_OPTIONS` directly anyway — the stored value IS the scheme key and the raw names ('auto','campbell',…) are acceptable display text for Phase 2. Confirm by reading how the adjacent `Sel` rows (e.g. `sshHistoryCmdStorage`) pass options.

- [ ] **Step 4: Add i18n keys**

In `src/i18n/locales/gwshell.en.json`, add:
```json
  "settings_paste_warn_multiline": "Confirm before pasting multiple lines",
  "settings_terminal_color_scheme": "Terminal color scheme",
  "paste_confirm_title": "Paste multiple lines?",
  "paste_confirm_lines": "This will paste {{count}} lines into the terminal.",
  "paste_confirm_paste": "Paste",
  "paste_confirm_cancel": "Cancel",
  "quickconnect_title": "Quick Connect",
  "quickconnect_placeholder": "user@host:port",
  "quickconnect_password": "Password (optional)",
  "quickconnect_connect": "Connect",
  "quickconnect_cancel": "Cancel",
  "quickconnect_invalid": "Enter a target like user@host:port",
```
In `src/i18n/locales/gwshell.zh.json`, add the SAME keys:
```json
  "settings_paste_warn_multiline": "粘贴多行前确认",
  "settings_terminal_color_scheme": "终端配色方案",
  "paste_confirm_title": "粘贴多行内容?",
  "paste_confirm_lines": "将向终端粘贴 {{count}} 行。",
  "paste_confirm_paste": "粘贴",
  "paste_confirm_cancel": "取消",
  "quickconnect_title": "快速连接",
  "quickconnect_placeholder": "user@host:port",
  "quickconnect_password": "密码(可选)",
  "quickconnect_connect": "连接",
  "quickconnect_cancel": "取消",
  "quickconnect_invalid": "请输入形如 user@host:port 的目标",
```

- [ ] **Step 5: Verify type-check + JSON validity**

Run: `npx tsc --noEmit`
Expected: zero errors (both `AppSettings` copies updated; `t('paste_confirm_lines', {count})` interpolation is valid; new keys exist in en JSON which drives `TranslationKeys`).
Both locale files must remain valid JSON (no trailing comma on the object's last key).

- [ ] **Step 6: Commit**

```bash
git add src/stores/settingsStore.ts src/components/Settings/SettingsModal.tsx src/i18n/locales/gwshell.en.json src/i18n/locales/gwshell.zh.json
git commit -m "feat(settings): paste-warn + terminal-color-scheme settings; Phase 2 i18n"
```

---

## Task 3: Apply theme presets in TerminalView + live updates

**Files:**
- Modify: `src/components/Terminal/TerminalView.tsx` (remove local `getTerminalThemeColors`; use `resolveTerminalTheme` at `:459` and `:1461`)
- Modify: `src/hooks/useSettingsEffects.ts` (add theme-scheme effect)

- [ ] **Step 1: Replace `getTerminalThemeColors` usage in TerminalView**

In `src/components/Terminal/TerminalView.tsx`, add an import near the other lib imports:
```ts
import { resolveTerminalTheme } from '../../lib/terminalThemes';
```
DELETE the local `const getTerminalThemeColors = (theme: ThemeMode) => { ... };` block (the ~55-line function near the top).

At the terminal-creation site (was `theme: getTerminalThemeColors(useAppStore.getState().theme),`), change to:
```ts
          theme: resolveTerminalTheme(useSettingsStore.getState().settings.terminalColorScheme, useAppStore.getState().theme),
```
At the app-theme-change site (was `inst.terminal.options.theme = getTerminalThemeColors(theme);`), change to:
```ts
      inst.terminal.options.theme = resolveTerminalTheme(useSettingsStore.getState().settings.terminalColorScheme, theme);
```
> Read the file first to confirm both call sites and the exact surrounding code. `useSettingsStore` and `useAppStore` are already imported in TerminalView. If `ThemeMode` import becomes unused after deleting `getTerminalThemeColors`, remove it from the import to keep tsc clean.

- [ ] **Step 2: Add a live theme-scheme effect in `useSettingsEffects.ts`**

In `src/hooks/useSettingsEffects.ts`, add the import:
```ts
import { resolveTerminalTheme } from '../lib/terminalThemes';
```
Inside `useSettingsEffects()`, after the existing font-options effect (the one depending on `terminalFont`/`terminalFontSize`/…), add:
```ts
  useEffect(() => {
    const theme = resolveTerminalTheme(settings.terminalColorScheme, settings.theme);
    terminalInstances.forEach(({ terminal }) => {
      terminal.options.theme = theme;
      requestAnimationFrame(() => {
        try { terminal.refresh(0, terminal.rows - 1); } catch {}
      });
    });
  }, [settings.terminalColorScheme, settings.theme]);
```

- [ ] **Step 3: Verify type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/Terminal/TerminalView.tsx src/hooks/useSettingsEffects.ts
git commit -m "feat(theme): apply selectable color scheme to terminals, live-update on change"
```

---

## Task 4: Paste safety (multiline confirm overlay)

**Files:**
- Modify: `src/components/Terminal/TerminalView.tsx` (`doPaste`, new state, overlay JSX, key handler)
- Modify: `src/styles/global.css`

- [ ] **Step 1: Add the confirm state**

In `src/components/Terminal/TerminalView.tsx`, near the other `useState` hooks (e.g. by `const [ghostText, setGhostText] = useState('')`), add:
```ts
  const [pasteConfirm, setPasteConfirm] = useState<string | null>(null);
```

- [ ] **Step 2: Intercept `doPaste`**

Find `doPaste` (currently):
```ts
        const doPaste = () => {
          readClipboardText().then((text) => {
            if (text) termRef.paste(text);
          }).catch(() => {});
        };
```
Replace with:
```ts
        const doPaste = () => {
          readClipboardText().then((text) => {
            if (!text) return;
            if (useSettingsStore.getState().settings.pasteWarnMultiline && text.includes('\n')) {
              setPasteConfirm(text);
            } else {
              termRef.paste(text);
            }
          }).catch(() => {});
        };
```

- [ ] **Step 3: Add Esc/Enter handling for the confirm overlay**

Near the other component-level `useEffect`s (e.g. the one registering `ghostTextSetters`), add:
```ts
  useEffect(() => {
    if (pasteConfirm === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setPasteConfirm(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        terminalInstances.get(tab.id)?.terminal.paste(pasteConfirm);
        setPasteConfirm(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pasteConfirm, tab.id]);
```

- [ ] **Step 4: Render the overlay**

In the component's returned JSX (near the ghost-text / context-menu overlays, inside the same Fragment), add:
```tsx
      {pasteConfirm !== null && isActive && (
        <div className="paste-confirm-overlay" onMouseDown={() => setPasteConfirm(null)}>
          <div className="paste-confirm-card" onMouseDown={(e) => e.stopPropagation()}>
            <div className="paste-confirm-title">{t('paste_confirm_title')}</div>
            <div className="paste-confirm-lines">
              {t('paste_confirm_lines', { count: pasteConfirm.split('\n').length })}
            </div>
            <pre className="paste-confirm-preview">
              {pasteConfirm.split('\n').slice(0, 8).join('\n')}
              {pasteConfirm.split('\n').length > 8 ? '\n…' : ''}
            </pre>
            <div className="paste-confirm-actions">
              <button className="paste-confirm-btn" onClick={() => setPasteConfirm(null)}>
                {t('paste_confirm_cancel')}
              </button>
              <button
                className="paste-confirm-btn primary"
                onClick={() => { terminalInstances.get(tab.id)?.terminal.paste(pasteConfirm); setPasteConfirm(null); }}
              >
                {t('paste_confirm_paste')}
              </button>
            </div>
          </div>
        </div>
      )}
```
> `t` (react-i18next), `isActive`, `tab`, `terminalInstances` are all already in scope in this component. Confirm `t` is destructured (`const { t } = useTranslation()` exists in the component).

- [ ] **Step 5: Add styles to `global.css`**

Append to `src/styles/global.css`:
```css
.paste-confirm-overlay {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
}
.paste-confirm-card {
  width: min(520px, 86%);
  max-height: 80%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: 8px;
  background: var(--bg-secondary, #1b1b24);
  border: 1px solid var(--border-color, #33333f);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}
.paste-confirm-title { font-weight: 600; font-size: 14px; }
.paste-confirm-lines { font-size: 12px; color: var(--text-muted, #999); }
.paste-confirm-preview {
  margin: 0;
  overflow: auto;
  max-height: 220px;
  padding: 8px;
  border-radius: 4px;
  background: var(--bg-primary, #0c0c14);
  border: 1px solid var(--border-color, #2a2a33);
  font-family: monospace;
  font-size: 12px;
  white-space: pre;
}
.paste-confirm-actions { display: flex; justify-content: flex-end; gap: 8px; }
.paste-confirm-btn {
  padding: 6px 14px;
  border-radius: 4px;
  border: 1px solid var(--border-color, #33333f);
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 13px;
}
.paste-confirm-btn:hover { background: var(--hover-bg, #2a2a33); }
.paste-confirm-btn.primary { background: var(--accent, #3b78ff); border-color: var(--accent, #3b78ff); color: #fff; }
```

- [ ] **Step 6: Verify type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 7: Manual check**

`npm run tauri dev` (if runnable): copy a multi-line block, paste via Ctrl-V / right-click → confirm overlay appears with correct line count + preview; Paste sends it, Cancel/Esc doesn't. Single-line / empty clipboard pastes directly. Toggle `pasteWarnMultiline` off → multi-line pastes directly.

- [ ] **Step 8: Commit**

```bash
git add src/components/Terminal/TerminalView.tsx src/styles/global.css
git commit -m "feat(paste): confirm before pasting multiline clipboard content"
```

---

## Task 5: Quick Connect parser

**Files:**
- Create: `src/lib/quickConnect.ts`

- [ ] **Step 1: Create the file with EXACTLY:**

```ts
export interface QuickTarget {
  username?: string;
  host: string;
  port: number;
}

// Parses `[user@]host[:port]` into a target. Returns null when there is no host.
// A trailing `:NNN` is treated as a port only when NNN is a valid 1-65535 number;
// otherwise the colon is kept as part of the host (e.g. a bare IPv6 address).
export function parseQuickConnect(input: string): QuickTarget | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let rest = trimmed;
  let username: string | undefined;
  const at = rest.lastIndexOf('@');
  if (at >= 0) {
    username = rest.slice(0, at) || undefined;
    rest = rest.slice(at + 1);
  }

  let host = rest;
  let port = 22;
  const colon = rest.lastIndexOf(':');
  if (colon >= 0) {
    const portStr = rest.slice(colon + 1);
    const p = Number(portStr);
    if (/^\d+$/.test(portStr) && p >= 1 && p <= 65535) {
      host = rest.slice(0, colon);
      port = p;
    }
  }

  host = host.trim();
  if (!host) return null;
  return { username, host, port };
}
```

- [ ] **Step 2: Verify type-check + reason through traces**

Run: `npx tsc --noEmit`
Expected: zero errors.
Confirm by reading the code:
- `parseQuickConnect('root@1.2.3.4:2222')` → `{username:'root', host:'1.2.3.4', port:2222}`
- `parseQuickConnect('example.com')` → `{host:'example.com', port:22}` (username undefined)
- `parseQuickConnect('user@host')` → `{username:'user', host:'host', port:22}`
- `parseQuickConnect('host:99999')` → `{host:'host:99999', port:22}` (invalid port kept in host)
- `parseQuickConnect('   ')` → `null`; `parseQuickConnect(':22')` → host `''` → `null`

- [ ] **Step 3: Commit**

```bash
git add src/lib/quickConnect.ts
git commit -m "feat(quickconnect): parse user@host:port targets"
```

---

## Task 6: Quick Connect store wiring

**Files:**
- Modify: `src/stores/appStore.ts` (interface + impl: `showQuickConnect`, `setShowQuickConnect`, `addTemporarySession`)

- [ ] **Step 1: Extend the store interface**

In `src/stores/appStore.ts`, in the store's TypeScript interface (where `showNewSession: boolean; setShowNewSession: (show: boolean) => void;` is declared), add nearby:
```ts
  showQuickConnect: boolean;
  setShowQuickConnect: (show: boolean) => void;
```
And where `addSession: (session: SessionConfig) => void;` is declared, add nearby:
```ts
  addTemporarySession: (session: SessionConfig) => void;
```

- [ ] **Step 2: Implement them**

In the store implementation, next to `showNewSession: false, setShowNewSession: (show) => set({ showNewSession: show }),` add:
```ts
  showQuickConnect: false,
  setShowQuickConnect: (show) => set({ showQuickConnect: show }),
```
Next to the `addSession` implementation, add (in-memory only — NO `save_session` invoke, so it isn't persisted):
```ts
  addTemporarySession: (session) =>
    set((state) => ({ sessions: [...state.sessions, session] })),
```

- [ ] **Step 3: Verify type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/stores/appStore.ts
git commit -m "feat(quickconnect): store flag + addTemporarySession (in-memory session)"
```

---

## Task 7: QuickConnect modal + nav + render wiring

**Files:**
- Create: `src/components/Modals/QuickConnectModal.tsx`
- Modify: `src/components/Sidebar/IconNav.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Create `QuickConnectModal.tsx` with EXACTLY:**

```tsx
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import { parseQuickConnect } from '../../lib/quickConnect';
import type { SessionConfig } from '../../types';

export const QuickConnectModal: React.FC = () => {
  const { t } = useTranslation();
  const { setShowQuickConnect, addTemporarySession, addTab } = useAppStore();
  const [target, setTarget] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const close = () => setShowQuickConnect(false);

  const connect = () => {
    const parsed = parseQuickConnect(target);
    if (!parsed) {
      setError(t('quickconnect_invalid'));
      return;
    }
    const id = crypto.randomUUID();
    const title = parsed.username ? `${parsed.username}@${parsed.host}` : parsed.host;
    const cfg: SessionConfig = {
      id,
      name: target.trim(),
      session_type: 'ssh',
      host: parsed.host,
      port: parsed.port,
      username: parsed.username,
      auth_method: password ? 'password' : 'agent',
      password: password || undefined,
      _temporary: true,
    };
    addTemporarySession(cfg);
    addTab({ id: crypto.randomUUID(), sessionId: id, title, type: 'ssh', connected: false });
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); connect(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };

  return (
    <div className="quick-connect-overlay" onMouseDown={close}>
      <div className="quick-connect-card" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="quick-connect-title">{t('quickconnect_title')}</div>
        <input
          className="quick-connect-input"
          autoFocus
          placeholder={t('quickconnect_placeholder')}
          value={target}
          onChange={(e) => { setTarget(e.target.value); setError(''); }}
        />
        <input
          className="quick-connect-input"
          type="password"
          placeholder={t('quickconnect_password')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="quick-connect-error">{error}</div>}
        <div className="quick-connect-actions">
          <button className="quick-connect-btn" onClick={close}>{t('quickconnect_cancel')}</button>
          <button className="quick-connect-btn primary" onClick={connect}>{t('quickconnect_connect')}</button>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Point the nav item at the modal (`IconNav.tsx`)**

In `src/components/Sidebar/IconNav.tsx`, add `setShowQuickConnect` to the `useAppStore()` destructure. Then change the `quickconnect` case in `handleNavClick`:
```ts
      case 'quickconnect':
        setShowNewSession(true);
        break;
```
to:
```ts
      case 'quickconnect':
        setShowQuickConnect(true);
        break;
```

- [ ] **Step 3: Render the modal in `App.tsx`**

In `src/App.tsx`, add a lazy import near the other modal lazy imports:
```tsx
const QuickConnectModal = lazy(() => import('./components/Modals/QuickConnectModal').then((m) => ({ default: m.QuickConnectModal })));
```
Add `showQuickConnect` to the `useAppStore()` destructure (alongside `showNewSession`, etc.). Then in the modal-render Suspense block (where `{showNewSession && <NewSessionModal />}` is), add:
```tsx
          {showQuickConnect && <QuickConnectModal />}
```

- [ ] **Step 4: Add styles to `global.css`**

Append to `src/styles/global.css`:
```css
.quick-connect-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 18vh;
  background: rgba(0, 0, 0, 0.4);
}
.quick-connect-card {
  width: min(440px, 90%);
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: 8px;
  background: var(--bg-secondary, #1b1b24);
  border: 1px solid var(--border-color, #33333f);
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.5);
}
.quick-connect-title { font-weight: 600; font-size: 15px; }
.quick-connect-input {
  padding: 8px 10px;
  border-radius: 4px;
  border: 1px solid var(--border-color, #33333f);
  background: var(--bg-primary, #0c0c14);
  color: inherit;
  font-size: 13px;
}
.quick-connect-error { color: #e06c75; font-size: 12px; }
.quick-connect-actions { display: flex; justify-content: flex-end; gap: 8px; }
.quick-connect-btn {
  padding: 6px 14px;
  border-radius: 4px;
  border: 1px solid var(--border-color, #33333f);
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 13px;
}
.quick-connect-btn:hover { background: var(--hover-bg, #2a2a33); }
.quick-connect-btn.primary { background: var(--accent, #3b78ff); border-color: var(--accent, #3b78ff); color: #fff; }
```

- [ ] **Step 5: Verify type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 6: Manual check**

`npm run tauri dev` (if runnable): click the Quick Connect nav icon → modal opens; type `user@host:port`, Enter → a terminal tab opens and connects (agent auth) / with password typed uses password; the session does NOT appear in the saved session list and is gone after restart; closing the tab removes the in-memory session. Invalid input shows the inline error.

- [ ] **Step 7: Commit**

```bash
git add src/components/Modals/QuickConnectModal.tsx src/components/Sidebar/IconNav.tsx src/App.tsx src/styles/global.css
git commit -m "feat(quickconnect): lightweight modal + nav wiring + render"
```

---

## Task 8: Final verification

- [ ] **Step 1: Build + smoke (if runnable)**

Run (retry if an environment classifier blocks; otherwise fall back to `npx tsc --noEmit`):
```bash
npm run build
npm run smoke:check
```
Expected: both pass. Report blocked vs pass/fail honestly.

- [ ] **Step 2: Manual checklist (spec §5)**

`npm run tauri dev` and verify:
1. Paste safety: multi-line paste (Ctrl-V / right-click / middle-click) → confirm; single-line/empty → direct; Esc/Cancel abort; toggle off → direct. Preview + line count correct.
2. Quick Connect: `user@host:port`, `host`, `host:port`, `user@host` all parse; invalid → inline error; connects as ephemeral (not saved, gone after restart); tab close cleans the temp session; password→password auth, blank→agent.
3. Theme presets: switching scheme recolors ALL open terminals live; Auto follows app light/dark; unknown value falls back to auto.
4. Regression: existing copy/paste shortcuts, right-click menu, split panes unaffected.

- [ ] **Step 3: Final commit (if any cleanup)**

```bash
git add -A
git commit -m "chore(phase2): final verification pass for terminal UX"
```

---

## Self-review notes (author)

- **Spec coverage:** A(paste)↔Task 2(setting)+Task 4; B(quickconnect)↔Task 5(parser)+Task 6(store)+Task 7(modal/nav/render); C(theme)↔Task 1(registry)+Task 2(setting)+Task 3(apply). All §6 files covered. No Rust (matches spec).
- **Placeholder scan:** none.
- **Type consistency:** `resolveTerminalTheme(scheme, appTheme)` / `TERMINAL_SCHEME_OPTIONS` used consistently (T1/T2/T3); `parseQuickConnect`→`QuickTarget` consumed in T7; `addTemporarySession`/`showQuickConnect`/`setShowQuickConnect` defined in T6, consumed in T7; `pasteWarnMultiline`/`terminalColorScheme` keys identical across both AppSettings copies (T2). `auth_method` value `'agent'`/`'password'` are valid `SessionConfig.auth_method` members.
- **Ordering:** T1 before T2 (Sel imports options) and T3 (uses resolveTerminalTheme); T2 before T3/T4 (settings read); T5+T6 before T7. Each task independently committable and tsc-clean.
