# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Commands are the standard `package.json` scripts (`npm run dev`, `build`, `smoke:check`, `test:node`, `ci:check`, `tauri dev`/`tauri build`) plus `cd src-tauri && cargo test` for the Rust suite.

Testing: the Rust backend has 170+ tests (`cargo test`); the frontend has no
component-test framework but ships targeted node scripts (`npm run test:node`)
plus the static smoke check. Run `npm run ci:check` before committing to mirror
what CI enforces. Backend CI additionally runs `cargo fmt`, `cargo clippy -- -D
warnings`, and `cargo audit` across a 3-OS matrix.

### Prerequisites

- Node.js 20+
- Rust 1.80+
- Platform-specific Tauri v2 prerequisites (C++ build tools on Windows, webkit2gtk on Linux, etc.)

## Architecture

GWShell is a **Tauri 2** desktop application: a React/TypeScript frontend rendered in a WebView, communicating with a Rust backend via `invoke()` IPC calls.

Frontend and backend directory guides now live in `src/CLAUDE.md` and `src-tauri/CLAUDE.md` — they load automatically when a session works under those directories.

### IPC Event Pattern

Backend pushes data to the frontend via Tauri events:

- `pty-data-{session_id}` / `ssh-data-{session_id}` / `serial-data-{session_id}` — terminal output chunks (matching `*-exit-{session_id}` events signal session end)
- `sftp-progress-{session_id}` — throttled file-transfer progress (`kind`, `file`, `fileIndex`, `fileTotal`, `bytes`, `total`)
- `server-metrics-{session_id}` — server panel metric snapshots

`TerminalView` listens for the data events and writes them to the xterm.js terminal instance. When the "session logging" setting is on, it also buffers output and appends it (ANSI-stripped) to `%LOCALAPPDATA%/gwshell/logs/{session}-{date}.log` via `append_session_log`.

### Session Types

`session_type`: `ssh` | `localshell` | `docker` | `serial`. The `TabInfo.type` mirrors this plus `asset-list` for the session manager view. SFTP is not a session type — it is a side panel attached to the active SSH tab. Terminal tabs can be reordered by dragging (`@dnd-kit` in `TabBar`, `reorderTabs` in `appStore`); the asset-list home tab is pinned first.

### Version Syncing

`npm version` triggers the `version` npm lifecycle script (see `package.json`), which rewrites the `version` field in `src-tauri/Cargo.toml` to match `package.json` and `git add`s it so the bump lands in the same commit/tag. `tauri.conf.json` has no `version` field — it inherits the version from Cargo.toml at build time.
