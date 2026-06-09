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
- **`components/Terminal/TerminalContainer.tsx`** — renders one or two `TerminalView`s side-by-side based on `splitTabId`
- **`i18n/`** — bilingual (en/zh) via `i18next` + `react-i18next`. Translation files in `i18n/locales/gwshell.{en,zh}.json`. Namespace is `gwshell`.

### Backend (`src-tauri/src/`)

- **`lib.rs`** — entry point, `AppState` struct, all `#[tauri::command]` handlers, tray icon setup, window close→hide behavior
- **`ssh.rs`** — `SshManager`: SSH connections via `libssh2`, SFTP operations, port forwarding. Known hosts stored in `%LOCALAPPDATA%/gwshell/known_hosts.json`
- **`pty.rs`** — `PtyManager`: local shell sessions via `portable_pty`. Per-OS shell resolution (PowerShell, CMD, Bash, Git Bash, WSL distros, Zsh, Fish)
- **`serial.rs`** — `SerialManager`: serial port connections
- **`session.rs`** — `SessionConfig` and `SessionGroup` data structures
- **`database.rs`** — SQLite persistence via `rusqlite`, stored in the Tauri app data directory

### IPC Event Pattern

Backend pushes terminal output to the frontend via Tauri events:
- `pty-data-{session_id}` — PTY stdout chunks
- `ssh-data-{session_id}` — SSH stdout chunks
- `serial-data-{session_id}` — Serial port data

`TerminalView` listens for these events and writes them to the xterm.js terminal instance.

### Split-Pane Architecture

The app supports an optional 2-pane side-by-side split. `splitTabId: string | null` in `appStore` drives the split: when non-null it identifies the second (partner) tab to display alongside the active tab. `setSplitTabId(id)` enables the split; `setSplitTabId(null)` returns to single-pane. If the partner tab is closed, `splitTabId` is automatically cleared. Temporary clone sessions created for the split are marked `_temporary: true` and are never persisted to SQLite.

### Session Types

`session_type`: `ssh` | `sftp` | `localshell` | `docker` | `serial`. The `TabInfo.type` mirrors this plus `asset-list` for the session manager view.

### Version Syncing

`npm version` triggers a `postversion` script that syncs the version from `package.json` into `src-tauri/Cargo.toml` automatically.
