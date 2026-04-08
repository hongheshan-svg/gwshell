# Stage 0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up dependencies, scoped tailwind, full i18next migration, AI namespace skeleton, and a smoke-test card — without any visual or behavioural regression to existing gwshell screens.

**Architecture:** Add cc-switch's UI dependencies (tailwind + Radix slot/label + i18next + lucide alias) but isolate them via `important: '.ai-scope'` so styles only affect the new `src/components/ai/` subtree. Replace gwshell's hand-rolled `getT()` with a single i18next instance exposing two namespaces (`gwshell` for existing code, `ai` for cc-switch resources). Add a smoke-test card under Settings → AI tab to validate the full chain (Radix + tailwind + i18next + lucide alias + theme sync).

**Tech Stack:** React 19 · Vite · Tauri 2 · Zustand · tailwindcss 3.4 · i18next 25 · react-i18next 16 · lucide-react (dual: 1.7 main + 0.542 alias)

**Spec reference:** `docs/superpowers/specs/2026-04-08-stage-0-foundation-spec.md`

**No-test-framework note:** gwshell has no automated tests (per CLAUDE.md). Each task's "verify" step uses `npm run dev`, `npm run build`, or manual UI inspection. Commit after each task.

---

## File Structure

**Created:**
- `tailwind.config.cjs` — scoped tailwind config (root)
- `postcss.config.cjs` — postcss with tailwind+autoprefixer (root)
- `src/components/ai/AiSection.tsx` — top-level AI region container
- `src/components/ai/styles/ai.css` — tailwind entry + theme vars
- `src/components/ai/lib/utils.ts` — `cn()` helper
- `src/components/ai/ui/button.tsx` — shadcn Button (copied from cc-switch)
- `src/components/ai/_smoke/SmokeCard.tsx` — smoke-test card
- `src/components/ai/i18n/index.ts` — i18next instance (gwshell + ai namespaces)
- `src/components/ai/i18n/detect.ts` — `detectLocale()` (moved from old src/i18n)
- `src/components/ai/i18n/locales/gwshell.zh.json` — converted from src/i18n/zh.ts
- `src/components/ai/i18n/locales/gwshell.en.json` — converted from src/i18n/en.ts
- `src/components/ai/i18n/locales/ai.zh.json` — copied from cc-switch zh.json
- `src/components/ai/i18n/locales/ai.en.json` — copied from cc-switch en.json
- `src-tauri/src/ai/mod.rs` — empty backend module placeholder
- `vite-env.d.ts` patch — JSON module declaration (if needed)

**Modified:**
- `package.json` — add deps
- `src/i18n/index.ts` — re-export from new ai/i18n; drop old `getT`
- `src/stores/appStore.ts` — `t` field driven by i18next; `setLocale` calls `i18n.changeLanguage`
- `src/App.tsx` — wrap with `<I18nextProvider>`
- `src/components/Settings/SettingsModal.tsx` — replace `<ProviderEditor t={t} />` at line 511 with lazy `<AiSection />`
- `src-tauri/src/lib.rs` — add `mod ai;`

**Deleted:**
- `src/i18n/zh.ts` — content moved to JSON resource
- `src/i18n/en.ts` — content moved to JSON resource

---

## Pre-flight

- [ ] **Step 0.1: Verify clean working tree**

Run: `cd D:/toolsource/gwshell && git status --short`
Expected: empty output (clean)

- [ ] **Step 0.2: Verify baseline still builds**

Run: `cd D:/toolsource/gwshell && npm run build`
Expected: exit code 0; no TypeScript errors

- [ ] **Step 0.3: Capture baseline UI screenshots (manual)**

Manually start `npm run tauri dev`, then take screenshots of:
- TitleBar, Sidebar (collapsed + expanded), TabBar, StatusBar
- AssetTable (asset-list main view)
- Each Sidebar nav item's main view
- Each modal: NewSession (SSH/SFTP/Local/Docker/Serial subforms), DockerModal, SettingsModal (each nav: basic, ssh-sftp, database, ai, mcp, prompts, usage, shortcut-basic, shortcut-ssh, shortcut-database, docker, storage, referral)

Save screenshots locally. We'll compare against these at end of plan.

Stop the dev server when done.

---

## Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1.1: Edit package.json — add new dependencies**

Use Edit tool to modify `package.json`. Replace the `"dependencies"` block with:

```json
"dependencies": {
    "@radix-ui/react-label": "^2.1.7",
    "@radix-ui/react-slot": "^1.2.3",
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-deep-link": "^2.4.8",
    "@tauri-apps/plugin-dialog": "^2.7.0",
    "@tauri-apps/plugin-opener": "^2",
    "@tauri-apps/plugin-updater": "^2.10.1",
    "@xterm/addon-fit": "^0.11.0",
    "@xterm/addon-web-links": "^0.12.0",
    "@xterm/xterm": "^6.0.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "i18next": "^25.5.2",
    "lucide-ai": "npm:lucide-react@^0.542.0",
    "lucide-react": "^1.7.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "react-i18next": "^16.0.0",
    "tailwind-merge": "^3.3.1",
    "zustand": "^5.0.12"
  }
```

And replace `"devDependencies"` with:

```json
"devDependencies": {
    "@tauri-apps/cli": "^2",
    "@types/react": "^19.1.8",
    "@types/react-dom": "^19.1.6",
    "@vitejs/plugin-react": "^4.6.0",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.17",
    "typescript": "~5.8.3",
    "vite": "^7.0.4"
  }
```

- [ ] **Step 1.2: Install**

Run: `cd D:/toolsource/gwshell && npm install`
Expected: install completes with no errors. May see peer-dep warnings — those are OK as long as `npm install` exits 0.

- [ ] **Step 1.3: Verify lucide alias resolved**

Run (Bash tool): `ls D:/toolsource/gwshell/node_modules/lucide-ai/dist/esm/icons/bot.js 2>&1`
Expected: file exists (alias correctly resolved to lucide-react@0.542)

- [ ] **Step 1.4: Verify build still passes**

Run: `cd D:/toolsource/gwshell && npm run build`
Expected: exit code 0

- [ ] **Step 1.5: Commit**

```bash
cd D:/toolsource/gwshell && git add package.json package-lock.json && git commit -m "stage 0 task 1: add tailwind/i18next/radix/lucide-ai deps"
```

---

## Task 2: Create tailwind & postcss config (scoped)

**Files:**
- Create: `tailwind.config.cjs`
- Create: `postcss.config.cjs`

- [ ] **Step 2.1: Create `tailwind.config.cjs`**

Write file `D:/toolsource/gwshell/tailwind.config.cjs` with EXACT content:

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  // Only scan AI subtree; gwshell legacy files are untouched.
  content: ['./src/components/ai/**/*.{ts,tsx}'],
  // All utilities are gated to .ai-scope subtree.
  important: '.ai-scope',
  // Disable global CSS reset (preflight) — gwshell legacy CSS owns base styles.
  corePlugins: { preflight: false },
  // Dark mode = .ai-scope.dark class on the AI root, independent of gwshell data-theme.
  darkMode: ['class', '.ai-scope.dark'],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        blue: { 400: '#409CFF', 500: '#0A84FF', 600: '#0060DF' },
        gray: {
          50: '#fafafa', 100: '#f4f4f5', 200: '#e4e4e7', 300: '#d4d4d8',
          400: '#a1a1aa', 500: '#71717a', 600: '#636366', 700: '#48484A',
          800: '#3A3A3C', 900: '#2C2C2E', 950: '#1C1C1E',
        },
        green: { 100: '#d1fae5', 500: '#10b981' },
        red: { 100: '#fee2e2', 500: '#ef4444' },
        amber: { 100: '#fef3c7', 500: '#f59e0b' },
        emerald: { 500: '#10b981', 600: '#059669', 700: '#047857' },
      },
      borderRadius: {
        sm: '0.375rem',
        md: '0.5rem',
        lg: '0.75rem',
        xl: '0.875rem',
      },
      fontFamily: {
        sans: ['-apple-system','BlinkMacSystemFont','"Segoe UI"','Roboto','"Helvetica Neue"','Arial','sans-serif'],
        mono: ['ui-monospace','SFMono-Regular','"SF Mono"','Consolas','"Liberation Mono"','Menlo','monospace'],
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 2.2: Create `postcss.config.cjs`**

Write file `D:/toolsource/gwshell/postcss.config.cjs` with EXACT content:

```js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 2.3: Verify build still passes (no AI code yet, so tailwind won't actually compile anything)**

Run: `cd D:/toolsource/gwshell && npm run build`
Expected: exit code 0. (Tailwind has nothing to compile because `content` glob matches no files yet — that's fine.)

- [ ] **Step 2.4: Commit**

```bash
cd D:/toolsource/gwshell && git add tailwind.config.cjs postcss.config.cjs && git commit -m "stage 0 task 2: add scoped tailwind + postcss config"
```

---

## Task 3: Create AI directory skeleton + ai.css

**Files:**
- Create: `src/components/ai/styles/ai.css`
- Create: `src/components/ai/lib/utils.ts`
- Create: `src-tauri/src/ai/mod.rs`

- [ ] **Step 3.1: Create `src/components/ai/styles/ai.css`**

Write file `D:/toolsource/gwshell/src/components/ai/styles/ai.css` with EXACT content:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* AI region scoped CSS variables — independent of gwshell data-theme. */
.ai-scope {
  --background: 0 0% 100%;
  --foreground: 240 10% 3.9%;
  --card: 0 0% 100%;
  --card-foreground: 240 10% 3.9%;
  --popover: 0 0% 100%;
  --popover-foreground: 240 10% 3.9%;
  --primary: 210 100% 56%;
  --primary-foreground: 0 0% 100%;
  --secondary: 240 4.8% 95.9%;
  --secondary-foreground: 240 5.9% 10%;
  --muted: 240 4.8% 95.9%;
  --muted-foreground: 240 3.8% 46.1%;
  --accent: 240 4.8% 95.9%;
  --accent-foreground: 240 5.9% 10%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 0 0% 98%;
  --border: 240 5.9% 90%;
  --input: 240 5.9% 90%;
  --ring: 210 100% 56%;
  --radius: 0.5rem;

  background-color: hsl(var(--background));
  color: hsl(var(--foreground));
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}

.ai-scope.dark {
  --background: 240 5% 12%;
  --foreground: 0 0% 98%;
  --card: 240 5% 16%;
  --card-foreground: 0 0% 98%;
  --popover: 240 5% 16%;
  --popover-foreground: 0 0% 98%;
  --primary: 210 100% 54%;
  --primary-foreground: 0 0% 100%;
  --secondary: 240 5% 18%;
  --secondary-foreground: 0 0% 98%;
  --muted: 240 5% 18%;
  --muted-foreground: 240 5% 64.9%;
  --accent: 240 5% 18%;
  --accent-foreground: 0 0% 98%;
  --destructive: 0 62.8% 30.6%;
  --destructive-foreground: 0 0% 98%;
  --border: 240 5% 24%;
  --input: 240 5% 24%;
  --ring: 210 100% 54%;
}
```

- [ ] **Step 3.2: Create `src/components/ai/lib/utils.ts`**

Write file `D:/toolsource/gwshell/src/components/ai/lib/utils.ts` with EXACT content:

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 3.3: Create `src-tauri/src/ai/mod.rs`**

Write file `D:/toolsource/gwshell/src-tauri/src/ai/mod.rs` with EXACT content:

```rust
//! AI namespace placeholder. Filled in starting Stage 1.
```

- [ ] **Step 3.4: Add `mod ai;` to lib.rs**

Read `D:/toolsource/gwshell/src-tauri/src/lib.rs` lines 1–20, find the existing `mod` declarations near the top, then Edit to add `mod ai;` after the first module declaration. Use Edit tool with the existing line as `old_string` and `existing_line\nmod ai;` as `new_string` to ensure uniqueness.

- [ ] **Step 3.5: Verify build**

Run: `cd D:/toolsource/gwshell && npm run build`
Expected: exit code 0

Run: `cd D:/toolsource/gwshell/src-tauri && cargo build 2>&1 | tail -20`
Expected: build success (or "Finished" line)

- [ ] **Step 3.6: Commit**

```bash
cd D:/toolsource/gwshell && git add src/components/ai/ src-tauri/src/ai/ src-tauri/src/lib.rs && git commit -m "stage 0 task 3: add ai/ skeleton (ai.css, utils, empty rust module)"
```

---

## Task 4: Convert gwshell zh.ts/en.ts to JSON resources

**Files:**
- Create: `src/components/ai/i18n/locales/gwshell.zh.json`
- Create: `src/components/ai/i18n/locales/gwshell.en.json`
- Create: `src/components/ai/i18n/locales/ai.zh.json`
- Create: `src/components/ai/i18n/locales/ai.en.json`

- [ ] **Step 4.1: Read current `src/i18n/zh.ts` fully**

Read `D:/toolsource/gwshell/src/i18n/zh.ts` (full file, ~722 lines). Note its shape: `const zh = { key1: 'value', key2: 'value', ... }; export default zh; export type TranslationKeys = keyof typeof zh;`

- [ ] **Step 4.2: Read current `src/i18n/en.ts` fully**

Read `D:/toolsource/gwshell/src/i18n/en.ts` (full file). Same shape.

- [ ] **Step 4.3: Write `src/components/ai/i18n/locales/gwshell.zh.json`**

Convert the `zh` object literal to a JSON file. Rules:
- Strip the `const zh = ` prefix and `export default zh; export type TranslationKeys = keyof typeof zh;` suffix
- Replace single-quote string delimiters with double-quote
- Escape any embedded `"` as `\"`
- Remove all `// comment` lines
- Wrap in valid JSON object braces
- **DO NOT** rename keys; **DO NOT** change `{{var}}` placeholders (i18next supports them natively)
- Output is one flat JSON object with all original keys

Write the result to `D:/toolsource/gwshell/src/components/ai/i18n/locales/gwshell.zh.json`. Use Write tool.

- [ ] **Step 4.4: Write `src/components/ai/i18n/locales/gwshell.en.json`**

Same conversion procedure, applied to `src/i18n/en.ts`. Write to `D:/toolsource/gwshell/src/components/ai/i18n/locales/gwshell.en.json`.

- [ ] **Step 4.5: Validate JSON parses**

Run: `cd D:/toolsource/gwshell && node -e "JSON.parse(require('fs').readFileSync('src/components/ai/i18n/locales/gwshell.zh.json','utf8'));console.log('zh ok')"`
Expected: prints `zh ok`. If it fails, fix JSON syntax errors and retry.

Run: `cd D:/toolsource/gwshell && node -e "JSON.parse(require('fs').readFileSync('src/components/ai/i18n/locales/gwshell.en.json','utf8'));console.log('en ok')"`
Expected: prints `en ok`.

- [ ] **Step 4.6: Verify key parity**

Run: `cd D:/toolsource/gwshell && node -e "const z=Object.keys(JSON.parse(require('fs').readFileSync('src/components/ai/i18n/locales/gwshell.zh.json','utf8')));const e=Object.keys(JSON.parse(require('fs').readFileSync('src/components/ai/i18n/locales/gwshell.en.json','utf8')));const dz=z.filter(k=>!e.includes(k));const de=e.filter(k=>!z.includes(k));console.log('zh-only:',dz.length,'en-only:',de.length);if(dz.length||de.length){console.log('zh-only keys:',dz);console.log('en-only keys:',de);process.exit(1)}else console.log('parity ok')"`
Expected: `parity ok`. If mismatch, the conversion missed a key — re-read source files and fix.

- [ ] **Step 4.7: Copy cc-switch ai resources**

Run (Bash tool):
```bash
cp "D:/toolsource/cc-switch/src/i18n/locales/zh.json" "D:/toolsource/gwshell/src/components/ai/i18n/locales/ai.zh.json"
cp "D:/toolsource/cc-switch/src/i18n/locales/en.json" "D:/toolsource/gwshell/src/components/ai/i18n/locales/ai.en.json"
```
Expected: no errors

- [ ] **Step 4.8: Commit**

```bash
cd D:/toolsource/gwshell && git add src/components/ai/i18n/locales/ && git commit -m "stage 0 task 4: convert gwshell i18n to json + copy cc-switch ai resources"
```

---

## Task 5: Create i18next instance

**Files:**
- Create: `src/components/ai/i18n/index.ts`
- Create: `src/components/ai/i18n/detect.ts`

- [ ] **Step 5.1: Create `detect.ts`**

Write file `D:/toolsource/gwshell/src/components/ai/i18n/detect.ts` with EXACT content:

```ts
export type Locale = 'zh' | 'en';

const STORAGE_KEY = 'gwshell.locale';

/** Detect locale: stored preference > browser > 'en'. */
export function detectLocale(): Locale {
  if (typeof window !== 'undefined') {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'zh' || stored === 'en') return stored;
    } catch {
      /* ignore */
    }
  }
  const lang =
    (typeof navigator !== 'undefined' && (navigator.language || (navigator as any).userLanguage)) || 'en';
  return lang.startsWith('zh') ? 'zh' : 'en';
}

export function persistLocale(loc: Locale): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, loc);
    } catch {
      /* ignore */
    }
  }
}
```

**NOTE:** Re-check what storage key the existing gwshell `appStore.locale` persistence uses before finalising `STORAGE_KEY`. Run `cd D:/toolsource/gwshell && grep -rn "localStorage" src/stores/appStore.ts src/i18n/`. If a different key is in use, update `STORAGE_KEY` here to match — preserving the user's existing preference is REQUIRED.

- [ ] **Step 5.2: Create `index.ts`**

Write file `D:/toolsource/gwshell/src/components/ai/i18n/index.ts` with EXACT content:

```ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import gwshellZh from './locales/gwshell.zh.json';
import gwshellEn from './locales/gwshell.en.json';
import aiZh from './locales/ai.zh.json';
import aiEn from './locales/ai.en.json';

import { detectLocale, persistLocale, type Locale } from './detect';

const initialLng = detectLocale();

void i18n.use(initReactI18next).init({
  resources: {
    zh: { gwshell: gwshellZh, ai: aiZh },
    en: { gwshell: gwshellEn, ai: aiEn },
  },
  lng: initialLng,
  fallbackLng: 'en',
  defaultNS: 'gwshell',
  ns: ['gwshell', 'ai'],
  // Both gwshell and cc-switch resources use {{var}} (i18next default).
  // Do NOT override interpolation prefix/suffix.
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

i18n.on('languageChanged', (lng) => {
  if (lng === 'zh' || lng === 'en') persistLocale(lng);
});

export default i18n;
export { detectLocale, persistLocale };
export type { Locale };

// Backwards-compatible TranslationKeys type, derived from the gwshell namespace JSON.
export type TranslationKeys = keyof typeof gwshellZh;
```

- [ ] **Step 5.3: Enable JSON imports in TypeScript (only if not already enabled)**

Read `D:/toolsource/gwshell/tsconfig.json`. If `compilerOptions.resolveJsonModule` is missing or false, Edit the file to add `"resolveJsonModule": true` inside `compilerOptions`. If already true, skip this step.

- [ ] **Step 5.4: Verify build**

Run: `cd D:/toolsource/gwshell && npm run build`
Expected: exit code 0. If TS errors about JSON modules, ensure step 5.3 was applied.

- [ ] **Step 5.5: Commit**

```bash
cd D:/toolsource/gwshell && git add src/components/ai/i18n/ tsconfig.json && git commit -m "stage 0 task 5: create i18next instance with gwshell+ai namespaces"
```

---

## Task 6: Refactor src/i18n/index.ts to re-export

**Files:**
- Modify: `src/i18n/index.ts`
- Delete: `src/i18n/zh.ts`
- Delete: `src/i18n/en.ts`

- [ ] **Step 6.1: Replace `src/i18n/index.ts` content**

Use Write tool to overwrite `D:/toolsource/gwshell/src/i18n/index.ts` with EXACT content:

```ts
// gwshell i18n is implemented as an i18next instance under src/components/ai/i18n.
// This module re-exports it for legacy import paths.
import i18n from '../components/ai/i18n';

export { detectLocale } from '../components/ai/i18n';
export type { Locale, TranslationKeys } from '../components/ai/i18n';

/**
 * Backwards-compatible getT(locale) that returns a translation function with
 * the same signature as the old hand-rolled implementation.
 *
 * Old shape: (key: TranslationKeys, params?: Record<string, string|number>) => string
 * Routed to i18next's getFixedT(lng, 'gwshell').
 */
import type { TranslationKeys } from '../components/ai/i18n';
export function getT(locale: 'zh' | 'en') {
  const fn = i18n.getFixedT(locale, 'gwshell');
  return function t(key: TranslationKeys, params?: Record<string, string | number>): string {
    return fn(key as string, params as any);
  };
}

export default i18n;
```

- [ ] **Step 6.2: Delete old zh.ts / en.ts**

Run (Bash tool): `rm "D:/toolsource/gwshell/src/i18n/zh.ts" "D:/toolsource/gwshell/src/i18n/en.ts"`
Expected: no errors

- [ ] **Step 6.3: Verify build**

Run: `cd D:/toolsource/gwshell && npm run build`
Expected: exit code 0. If TS complains about missing imports of `./zh` or `./en`, find them via `grep` and fix — there shouldn't be any (only `i18n/index.ts` imported them).

- [ ] **Step 6.4: Commit**

```bash
cd D:/toolsource/gwshell && git add src/i18n/ && git commit -m "stage 0 task 6: replace getT() with i18next re-export; delete zh.ts/en.ts"
```

---

## Task 7: Update appStore to drive `t` from i18next

**Files:**
- Modify: `src/stores/appStore.ts`

- [ ] **Step 7.1: Read current appStore locale section**

Read `D:/toolsource/gwshell/src/stores/appStore.ts` lines 1–50 to identify the existing `t` initialization, the `setLocale` implementation, and any persistence logic.

- [ ] **Step 7.2: Update imports**

In `src/stores/appStore.ts`, find `import { detectLocale, getT, type Locale, type TranslationKeys } from '../i18n';` and Edit to:

```ts
import i18n, { detectLocale, type Locale, type TranslationKeys } from '../i18n';
```

- [ ] **Step 7.3: Update store initialization for `t`**

Find the existing initial `t:` field in the store (look for `t: getT(...)`). Edit to:

```ts
t: i18n.getFixedT(detectLocale(), 'gwshell') as (key: TranslationKeys, params?: Record<string, string | number>) => string,
```

- [ ] **Step 7.4: Update `setLocale`**

Find the existing `setLocale:` implementation. Edit to:

```ts
setLocale: (locale) => {
  void i18n.changeLanguage(locale);
  set({
    locale,
    t: i18n.getFixedT(locale, 'gwshell') as (key: TranslationKeys, params?: Record<string, string | number>) => string,
  });
},
```

- [ ] **Step 7.5: Subscribe to external language changes (optional safety net)**

After the `create<AppStore>()(...)` call, append (at the bottom of `appStore.ts`):

```ts
// Keep store in sync if i18next.changeLanguage is called from outside the store.
i18n.on('languageChanged', (lng) => {
  if (lng === 'zh' || lng === 'en') {
    const cur = useAppStore.getState();
    if (cur.locale !== lng) {
      useAppStore.setState({
        locale: lng,
        t: i18n.getFixedT(lng, 'gwshell') as typeof cur.t,
      });
    }
  }
});
```

- [ ] **Step 7.6: Verify build**

Run: `cd D:/toolsource/gwshell && npm run build`
Expected: exit code 0

- [ ] **Step 7.7: Commit**

```bash
cd D:/toolsource/gwshell && git add src/stores/appStore.ts && git commit -m "stage 0 task 7: drive appStore.t from i18next"
```

---

## Task 8: Wrap App in I18nextProvider

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 8.1: Add I18nextProvider import**

In `src/App.tsx`, add at the top of the import block:

```ts
import { I18nextProvider } from 'react-i18next';
import i18n from './i18n';
```

- [ ] **Step 8.2: Wrap the top-level returned JSX**

Find the `return (` of the `App` component. Wrap the entire returned tree with `<I18nextProvider i18n={i18n}>...</I18nextProvider>`. Use Edit with enough surrounding context to make the match unique (the existing top-level `<>` or root `<div>`).

- [ ] **Step 8.3: Verify build**

Run: `cd D:/toolsource/gwshell && npm run build`
Expected: exit code 0

- [ ] **Step 8.4: Commit**

```bash
cd D:/toolsource/gwshell && git add src/App.tsx && git commit -m "stage 0 task 8: wrap App with I18nextProvider"
```

---

## Task 9: Manual regression smoke test (gwshell core)

**Files:** none

- [ ] **Step 9.1: Run dev**

Run (in a separate terminal): `cd D:/toolsource/gwshell && npm run tauri dev`

- [ ] **Step 9.2: Compare against baseline screenshots from Step 0.3**

Visit each screen in order and confirm visual + textual parity:
- TitleBar (minimize/maximize/close labels in tooltips)
- Sidebar (all nav items, both collapsed and expanded)
- TabBar
- StatusBar
- AssetTable
- NewSessionModal — every sub-form (SSH, SFTP, Local, Docker, Serial). Pay attention to placeholders with `{{var}}` substitution (port, host, etc.)
- DockerModal
- LocalTerminalModal
- SerialPortModal
- SettingsModal — every nav item: basic, ssh-sftp, database, ai, mcp, prompts, usage, shortcut-basic, shortcut-ssh, shortcut-database, docker, storage, referral
- TerminalView placeholder text: connect to a session, observe `term_connecting`, `term_via_jump`, etc. (Skip if no real SSH host available — at minimum check the strings render with proper substitution in any reachable code path.)

- [ ] **Step 9.3: Toggle language**

In SettingsModal, toggle the language between 中文 and English. Visit the same screens. Confirm every label flips correctly.

- [ ] **Step 9.4: Toggle theme**

Toggle light/dark theme. Confirm gwshell legacy screens look identical to baseline.

- [ ] **Step 9.5: Stop dev server**

Stop `npm run tauri dev` (Ctrl+C in its terminal).

- [ ] **Step 9.6: Record findings**

If anything regressed, fix inline before continuing. Common issues:
- A consumer of `t()` passes positional arguments other than `(key, params)` — search via `grep -rn "t(" src/components` for unusual call shapes
- A `useAppStore.getState().t(...)` call inside a non-React module bypasses store subscription updates — for Stage 0 we don't refactor those, just confirm they still render

If everything checks out, no commit (no code changed).

---

## Task 10: Add shadcn Button + smoke card

**Files:**
- Create: `src/components/ai/ui/button.tsx`
- Create: `src/components/ai/_smoke/SmokeCard.tsx`
- Create: `src/components/ai/AiSection.tsx`

- [ ] **Step 10.1: Copy `button.tsx` from cc-switch**

Write file `D:/toolsource/gwshell/src/components/ai/ui/button.tsx` with EXACT content (copied verbatim from cc-switch, with import path adjusted from `@/lib/utils` to relative):

```tsx
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-blue-500 text-white hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-700',
        destructive: 'bg-red-500 text-white hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-700',
        outline:
          'border bg-background text-muted-foreground hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-gray-100',
        secondary:
          'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200',
        ghost:
          'text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-800',
        link: 'text-blue-500 underline-offset-4 hover:underline dark:text-blue-400',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-8',
        icon: 'h-9 w-9 p-1.5',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
```

- [ ] **Step 10.2: Create `SmokeCard.tsx`**

Write file `D:/toolsource/gwshell/src/components/ai/_smoke/SmokeCard.tsx` with EXACT content:

```tsx
import { Bot } from 'lucide-ai';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';

export function SmokeCard() {
  const { t } = useTranslation('ai');
  return (
    <div className="p-6">
      <div className="bg-card text-card-foreground rounded-lg shadow-md p-4 max-w-md border" style={{ borderColor: 'hsl(var(--border))' }}>
        <div className="flex items-center gap-3 mb-3">
          <Bot className="w-6 h-6 text-blue-500" />
          <div>
            <h3 className="text-base font-semibold">{t('app.title', 'CC Switch')}</h3>
            <p className="text-xs text-muted-foreground">{t('app.description', '')}</p>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <Button variant="default" size="sm">{t('common.add', 'Add')}</Button>
          <Button variant="outline" size="sm">{t('common.edit', 'Edit')}</Button>
          <Button variant="destructive" size="sm">{t('common.delete', 'Delete')}</Button>
          <Button variant="ghost" size="sm">{t('common.cancel', 'Cancel')}</Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 10.3: Create `AiSection.tsx`**

Write file `D:/toolsource/gwshell/src/components/ai/AiSection.tsx` with EXACT content:

```tsx
import { useEffect, useRef } from 'react';
import './styles/ai.css';
import { useAppStore } from '../../stores/appStore';
import { SmokeCard } from './_smoke/SmokeCard';

export function AiSection() {
  const theme = useAppStore((s) => s.theme);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    el.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  return (
    <div ref={rootRef} className={`ai-scope ${theme === 'dark' ? 'dark' : ''}`}>
      <SmokeCard />
    </div>
  );
}

export default AiSection;
```

- [ ] **Step 10.4: Verify build**

Run: `cd D:/toolsource/gwshell && npm run build`
Expected: exit code 0. Tailwind should now compile because the `content` glob matches files. Look for any `Module not found: lucide-ai` or unresolved imports — fix if so.

- [ ] **Step 10.5: Commit**

```bash
cd D:/toolsource/gwshell && git add src/components/ai/ && git commit -m "stage 0 task 10: add Button shadcn + SmokeCard + AiSection"
```

---

## Task 11: Wire AiSection into SettingsModal

**Files:**
- Modify: `src/components/Settings/SettingsModal.tsx`

- [ ] **Step 11.1: Add lazy import**

In `src/components/Settings/SettingsModal.tsx`, after the existing static imports (around line 6, after `import { UsageDashboard } from './UsageDashboard';`), add:

```ts
import { lazy, Suspense } from 'react';
const AiSection = lazy(() => import('../ai/AiSection').then((m) => ({ default: m.AiSection })));
```

If `lazy` and `Suspense` are already imported from React in the existing import line, only add the `AiSection` lazy const and ensure `lazy`/`Suspense` are present in the React import.

- [ ] **Step 11.2: Replace ProviderEditor render at line 511**

Spec line 511 currently reads `{activeNav === 'ai' && <ProviderEditor t={t} />}`. Use Edit tool with this exact `old_string` and `new_string`:

```tsx
{activeNav === 'ai' && (
              <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
                <AiSection />
              </Suspense>
            )}
```

(Indentation: match the surrounding JSX. Confirm by reading lines 505–520 first.)

- [ ] **Step 11.3: Check the second `activeNav === 'ai'` site at line ~603**

Read lines 595–615 of `SettingsModal.tsx`. The second match `) : activeNav === 'ai' ? (` is in a different rendering branch. Determine which branch is the active code path; if both are reachable, replace the second branch's content the same way (Suspense + AiSection). If one branch is dead code, leave it but add a comment.

- [ ] **Step 11.4: Verify build**

Run: `cd D:/toolsource/gwshell && npm run build`
Expected: exit code 0

- [ ] **Step 11.5: Commit**

```bash
cd D:/toolsource/gwshell && git add src/components/Settings/SettingsModal.tsx && git commit -m "stage 0 task 11: mount AiSection in Settings AI tab"
```

---

## Task 12: Final smoke test + acceptance

**Files:** none

- [ ] **Step 12.1: Run dev**

Run: `cd D:/toolsource/gwshell && npm run tauri dev`

- [ ] **Step 12.2: Open Settings → AI**

Confirm the SmokeCard renders:
- Has a card background that matches the AI theme variables (NOT gwshell's data-theme)
- "CC Switch" title visible (from `ai` namespace)
- 4 buttons: Add (blue), Edit (outlined), Delete (red), Cancel (ghost)
- A `Bot` icon rendered from `lucide-ai`

- [ ] **Step 12.3: Toggle gwshell theme**

Toggle light/dark in gwshell. Confirm the SmokeCard's background flips with it (because `AiSection` toggles `.ai-scope.dark` based on store theme).

- [ ] **Step 12.4: Toggle language**

Toggle 中/EN. Confirm the SmokeCard buttons update to Chinese ("添加"/"编辑"/...) — this proves both `gwshell` and `ai` namespaces respond to `i18n.changeLanguage`.

- [ ] **Step 12.5: Confirm gwshell legacy screens are still pixel-identical to baseline**

Re-visit each baseline screen from Step 0.3. Differences allowed: NONE (other than the AI tab, which now shows the smoke card instead of ProviderEditor).

- [ ] **Step 12.6: Inspect DOM for tailwind leakage**

Open devtools, inspect a non-AI element (e.g. Sidebar). Confirm none of its computed styles changed since baseline (no tailwind reset is applied because `preflight: false` and `important: '.ai-scope'` gate everything).

- [ ] **Step 12.7: Stop dev server**

Stop `npm run tauri dev`.

- [ ] **Step 12.8: Verify production build**

Run: `cd D:/toolsource/gwshell && npm run tauri build 2>&1 | tail -30`
Expected: completes successfully (builds the Tauri bundle). If build fails, fix errors and re-run.

- [ ] **Step 12.9: Final commit (only if any fix-up changes were made)**

```bash
cd D:/toolsource/gwshell && git status
# If clean: nothing to commit. If dirty: stage and commit with message "stage 0 task 12: smoke test fixups"
```

---

## Acceptance Checklist (mirrors spec §5)

- [ ] AC1: `npm run dev` starts with no errors
- [ ] AC2: `npm run build` exit 0
- [ ] AC3: `npm run tauri dev` window renders normally
- [ ] AC4: gwshell legacy UI: zero visual regression (compared to Step 0.3 baseline)
- [ ] AC5: gwshell legacy UI: zero textual regression (中/EN toggle parity)
- [ ] AC6: gwshell theme toggle: zero regression
- [ ] AC7: i18next instance: both `gwshell` and `ai` namespaces resolve
- [ ] AC8: SmokeCard renders in Settings → AI
- [ ] AC9: SmokeCard background follows gwshell theme
- [ ] AC10: tailwind doesn't leak (other regions unchanged)
- [ ] AC11: `cargo build` passes (in `src-tauri/`)

---

## Rollback Plan

If any task hits unsolvable trouble:

```bash
cd D:/toolsource/gwshell
git log --oneline -20    # find the last good commit before stage 0
git reset --hard <commit>
# OR for a single bad task:
git revert HEAD
```

Each task is committed separately so reverting is granular.

---

## Self-Review Notes

- **Spec coverage:** §3.1 deps → Task 1; §3.2 tailwind/postcss → Task 2; §3.3 directory → Task 3; §3.4 i18next migration (7 sub-steps) → Tasks 4–8; §3.5 smoke → Task 10; §3.6 Settings integration → Task 11; §3.7 backend → Task 3 step 3.3–3.4. §4 implementation steps mirror task order. §5 acceptance → final checklist.
- **Placeholder scan:** every code/config block is concrete; no "TBD" or "add appropriate handling".
- **Type consistency:** `t` signature `(key, params?) => string` is consistent across appStore, getT, i18n/index.ts. `Locale = 'zh' | 'en'` consistent.
- **Storage key gotcha (Step 5.1 NOTE):** before finalising the i18next persistence key, the engineer must verify the existing localStorage key used by gwshell for locale, to preserve user preferences.
- **Interpolation correction:** spec §3.4 step 5 mentioned overriding `interpolation.prefix='{', suffix='}'` — that was wrong. gwshell already uses `{{var}}` (verified by grepping `src/i18n/zh.ts`). i18next default is `{{var}}`. The plan does NOT override interpolation.
- **Second `activeNav === 'ai'` site (Step 11.3):** flagged as needing investigation by the engineer because spec only mentioned the first site.
