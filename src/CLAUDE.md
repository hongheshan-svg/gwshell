# Frontend (`src/`)

- **`stores/appStore.ts`** — most state mutations also fire backend `invoke()` calls as side effects (e.g. `addSession` saves to SQLite).
- **`components/Terminal/TerminalView.tsx`** — xterm.js terminal. Per-tab state lives in module-level maps outside React so terminal instances survive re-renders and split-mode transitions: `terminalInstances` in `components/Terminal/terminalRegistry.ts`; `tabListenerCleanups`, `connectedTabs` and `cleanupTabListeners()` in `lib/terminalLifecycle.ts`. A tab id may have only one set of event listeners: call `cleanupTabListeners()` before re-attaching, otherwise the tab ends up with duplicate listeners.

## Split-Pane Architecture

Tabs not currently in a grid slot stay mounted but hidden so their xterm instances survive layout changes. Split state is session-only (not persisted), and temporary clone sessions (`_temporary: true`) are never persisted to SQLite.

## i18n Rule

Every user-facing string goes through i18next. `gwshell.en.json` and `gwshell.zh.json` must stay key-for-key identical — add/remove keys in both files together.
