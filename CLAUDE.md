# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
npm install

# Development (launches Tauri app with hot-reload frontend)
npm run tauri dev

# Production build
npm run tauri build

# Frontend only (Vite dev server, no Tauri)
npm run dev

# TypeScript type-check + frontend build
npm run build

# Static smoke check (scans for common code issues, no runtime)
npm run smoke:check
```

There are no automated tests in this project. Use `npm run smoke:check` to catch common issues before committing.

### Prerequisites

- Node.js 20+
- Rust 1.80+
- Platform-specific Tauri v2 prerequisites (C++ build tools on Windows, webkit2gtk on Linux, etc.)

## Architecture

GWShell is a **Tauri 2** desktop application: a React/TypeScript frontend rendered in a WebView, communicating with a Rust backend via `invoke()` IPC calls.

### Frontend (`src/`)

- **`App.tsx`** — root layout: TitleBar + Sidebar + SessionPanel + main content area (TabBar + TerminalContainer/SftpPanel + StatusBar), plus all modals rendered at root level
- **`stores/appStore.ts`** — primary Zustand store: sessions, tabs, split-pane config, modals, theme, locale. Most state mutations also fire backend `invoke()` calls as side effects (e.g. `addSession` saves to SQLite).
- **`stores/settingsStore.ts`** — separate Zustand store for user preferences (terminal font/size, editor settings, UI toggles). Persisted to backend via `invoke("save_settings")`.
- **`types/index.ts`** — shared TypeScript types (`SessionConfig`, `TabInfo`, `ThemeMode`, `MainView`)
- **`components/Terminal/TerminalView.tsx`** — xterm.js terminal. Maintains global maps (`terminalInstances`, `tabListenerCleanups`, `connectedTabs`) outside React to preserve terminal instances across re-renders and split-mode transitions. **Critical: only ONE set of event listeners per tab ID is allowed—`cleanupTabListeners()` must be called before re-attaching.**
- **`components/Terminal/TerminalContainer.tsx`** — renders a grid of 1/2/4/6/8 `TerminalView` panes based on `splitCount`/`splitPanes`
- **`i18n/`** — bilingual (en/zh) via `i18next` + `react-i18next`. Translation files in `i18n/locales/gwshell.{en,zh}.json`. Namespace is `gwshell`.

### Backend (`src-tauri/src/`)

- **`lib.rs`** — entry point, `AppState` struct, all `#[tauri::command]` handlers, tray icon setup, Quake dropdown window, global shortcut, window close→hide behavior
- **`ssh/`** — async SSH backend on **russh** (pure Rust). `mod.rs` holds `SshManager`; submodules: `connect`/`auth`/`transport` (connection + jump host + proxies), `session` (shell/exec I/O pumps), `sftp` (file ops, recursive dir transfer with progress callbacks), `forward` (-L local and -D SOCKS5 forwarding; -R lives in `handler`/`mod`), `exec`, `known_hosts` (stored in `%LOCALAPPDATA%/gwshell/known_hosts.json`), `params`
- **`ssh_config.rs`** — `~/.ssh/config` parser for the asset import command (unit-tested)
- **`pty.rs`** — `PtyManager`: local shell sessions via `portable_pty`. Per-OS shell resolution (PowerShell, CMD, Bash, Git Bash, WSL distros, Zsh, Fish)
- **`serial.rs`** — `SerialManager`: serial port connections
- **`docker.rs`** — list containers / exec into them, locally (PTY) or over SSH (unit-tested parsing)
- **`metrics.rs`** — server panel poller: CPU/mem/disk/NIC/process stats over `ssh exec`
- **`session.rs`** — `SessionConfig` data structure
- **`database.rs`** — SQLite persistence via `rusqlite` (sessions, settings, command history, snippets), stored in `%LOCALAPPDATA%/gwshell/`
- **`crypto.rs`** / **`vault.rs`** — secrets are encrypted before they touch SQLite (OS keyring master key); optional Argon2id master-passphrase app lock
- **`history.rs`** — command history persistence helpers

### IPC Event Pattern

Backend pushes data to the frontend via Tauri events:
- `pty-data-{session_id}` / `ssh-data-{session_id}` / `serial-data-{session_id}` — terminal output chunks (matching `*-exit-{session_id}` events signal session end)
- `sftp-progress-{session_id}` — throttled file-transfer progress (`kind`, `file`, `fileIndex`, `fileTotal`, `bytes`, `total`)
- `server-metrics-{session_id}` — server panel metric snapshots

`TerminalView` listens for the data events and writes them to the xterm.js terminal instance. When the "session logging" setting is on, it also buffers output and appends it (ANSI-stripped) to `%LOCALAPPDATA%/gwshell/logs/{session}-{date}.log` via `append_session_log`.

### Split-Pane Architecture

The app tiles open terminal tabs in a grid. `splitCount` (1/2/4/6/8) in `appStore` selects the layout (1 = single pane; 2 = 2×1, 4 = 2×2, 6 = 2×3, 8 = 2×4), and `splitPanes: (string | null)[]` maps each grid slot to an open terminal tab id (or `null` for an empty slot). `setSplitCount(n)` rebuilds `splitPanes` from the current terminal tabs (active tab first). Pure slot helpers live in `lib/splitLayout.ts` (`buildSplitPanes`/`clearSlot`/`fillFirstEmpty`). Closing a tab empties its slot (`clearSlot`); dropping to ≤1 terminal tab collapses back to single-pane; a new tab fills the first empty slot. Tabs not currently in a slot stay mounted but hidden so their xterm instances survive layout changes. Clicking a pane sets the active tab (the active pane gets a highlight border). Split state is session-only (not persisted). Temporary clone sessions (`_temporary: true`) are never persisted to SQLite.

### Session Types

`session_type`: `ssh` | `localshell` | `docker` | `serial`. The `TabInfo.type` mirrors this plus `asset-list` for the session manager view. SFTP is not a session type — it is a side panel attached to the active SSH tab. Terminal tabs can be reordered by dragging (`@dnd-kit` in `TabBar`, `reorderTabs` in `appStore`); the asset-list home tab is pinned first.

### i18n Rule

Every user-facing string goes through i18next. `gwshell.en.json` and `gwshell.zh.json` must stay key-for-key identical — add/remove keys in both files together.

### Version Syncing

`npm version` triggers a `postversion` script that syncs the version from `package.json` into `src-tauri/Cargo.toml` automatically.
