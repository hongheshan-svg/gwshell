# Frontend (`src/`)

- **`App.tsx`** — root layout: TitleBar + Sidebar + SessionPanel + main content area (TabBar + TerminalContainer/SftpPanel + StatusBar), plus all modals rendered at root level
- **`stores/appStore.ts`** — primary Zustand store: sessions, tabs, split-pane config, modals, theme, locale. Most state mutations also fire backend `invoke()` calls as side effects (e.g. `addSession` saves to SQLite).
- **`stores/settingsStore.ts`** — separate Zustand store for user preferences (terminal font/size, editor settings, UI toggles). Persisted to backend via `invoke("save_settings")`.
- **`types/index.ts`** — shared TypeScript types (`SessionConfig`, `TabInfo`, `ThemeMode`, `MainView`)
- **`components/Terminal/TerminalView.tsx`** — xterm.js terminal. Maintains global maps (`terminalInstances`, `tabListenerCleanups`, `connectedTabs`) outside React to preserve terminal instances across re-renders and split-mode transitions. **Critical: only ONE set of event listeners per tab ID is allowed—`cleanupTabListeners()` must be called before re-attaching.**
- **`components/Terminal/TerminalContainer.tsx`** — renders a grid of 1/2/4/6/8 `TerminalView` panes based on `splitCount`/`splitPanes`
- **`i18n/`** — bilingual (en/zh) via `i18next` + `react-i18next`. Translation files in `i18n/locales/gwshell.{en,zh}.json`. Namespace is `gwshell`.

## Split-Pane Architecture

The app tiles open terminal tabs in a grid. `splitCount` (1/2/4/6/8) in `appStore` selects the layout (1 = single pane; 2 = 2×1, 4 = 2×2, 6 = 2×3, 8 = 2×4), and `splitPanes: (string | null)[]` maps each grid slot to an open terminal tab id (or `null` for an empty slot). `setSplitCount(n)` rebuilds `splitPanes` from the current terminal tabs (active tab first). Pure slot helpers live in `lib/splitLayout.ts` (`buildSplitPanes`/`clearSlot`/`fillFirstEmpty`). Closing a tab empties its slot (`clearSlot`); dropping to ≤1 terminal tab collapses back to single-pane; a new tab fills the first empty slot. Tabs not currently in a slot stay mounted but hidden so their xterm instances survive layout changes. Clicking a pane sets the active tab (the active pane gets a highlight border). Split state is session-only (not persisted). Temporary clone sessions (`_temporary: true`) are never persisted to SQLite.

## i18n Rule

Every user-facing string goes through i18next. `gwshell.en.json` and `gwshell.zh.json` must stay key-for-key identical — add/remove keys in both files together.
