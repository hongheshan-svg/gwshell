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
```

There are no automated tests in this project.

## Architecture

GWShell is a **Tauri 2** desktop application: a React/TypeScript frontend rendered in a WebView, communicating with a Rust backend via `invoke()` IPC calls.

### Frontend (`src/`)

- **`App.tsx`** — root layout: TitleBar + Sidebar + SessionPanel + main content area (TabBar + TerminalContainer/SftpPanel + StatusBar), plus all modals rendered at root level
- **`stores/appStore.ts`** — single Zustand store for all app state: sessions, tabs, split-pane config, modals, theme, locale. Most state mutations here also fire backend `invoke()` calls as side effects (e.g. `addSession` saves to SQLite).
- **`types/index.ts`** — shared TypeScript types (`SessionConfig`, `TabInfo`, `ThemeMode`, `MainView`)
- **`components/Terminal/TerminalView.tsx`** — xterm.js terminal. Maintains global maps (`terminalInstances`, `tabListenerCleanups`, `connectedTabs`) outside React to preserve terminal instances across re-renders and split-mode transitions. Critical: only ONE set of event listeners per tab ID is allowed—`cleanupTabListeners()` must be called before re-attaching.
- **`components/Terminal/TerminalContainer.tsx`** — renders one or more `TerminalView`s in a CSS grid based on `splitCount` (1/2/4/6/8 panes)
- **`i18n/`** — bilingual (en/zh) translation via `getT(locale)` returning a typed `t(key)` function stored directly in the Zustand store

### Backend (`src-tauri/src/`)

- **`lib.rs`** — entry point, `AppState` struct, all `#[tauri::command]` handlers, tray icon setup, window close→hide behavior
- **`ssh.rs`** — `SshManager`: SSH connections via `libssh2`, SFTP operations, port forwarding. Known hosts stored in `%LOCALAPPDATA%/gwshell/known_hosts.json`
- **`pty.rs`** — `PtyManager`: local shell sessions via `portable_pty`. Per-OS shell resolution (PowerShell, CMD, Bash, Git Bash, WSL distros, Zsh, Fish)
- **`serial.rs`** — `SerialManager`: serial port connections
- **`database.rs`** — SQLite persistence via `rusqlite`, stored in the Tauri app data directory
- **`ai_config.rs`** — AI provider config management (Claude Code, Codex, Gemini, etc.), compatible with CC-Switch format
- **`mcp_config.rs`** — MCP server config management, syncs to Claude/Gemini config files on disk
- **`usage_tracker.rs`** — AI usage/cost tracking records

### IPC Event Pattern

Backend pushes terminal output to the frontend via Tauri events:
- `pty-data-{session_id}` — PTY stdout chunks
- `ssh-data-{session_id}` — SSH stdout chunks  
- `serial-data-{session_id}` — Serial port data

`TerminalView` listens for these events and writes them to the xterm.js terminal instance.

### Split-Pane Architecture

`splitCount` (1/2/4/6/8) drives the layout. When splitting, `AppStore.setSplitCount()` clones sessions marked `_temporary: true`—these are never persisted to SQLite and are cleaned up when their tab closes or split count decreases. The `splitPanes` array maps slot index → tab ID.

### Session Types

`session_type`: `ssh` | `sftp` | `localshell` | `docker` | `serial`. The `TabInfo.type` mirrors this plus `asset-list` for the session manager view.
