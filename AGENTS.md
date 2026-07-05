# AGENTS.md

Compact guide for OpenCode sessions working in this repo. For deeper architecture, see `CLAUDE.md` (kept in sync) and `README.md`.

## Stack

Tauri 2 desktop app: React 19 + TypeScript 5.8 + Vite 7 frontend, Rust backend. Frontend in `src/`, backend in `src-tauri/src/`. The two sides communicate only via Tauri `invoke()` IPC and backend-emitted events.

## Commands & verification order

CI (`.github/workflows/ci.yml`) runs this exact sequence — match it locally before pushing:

1. `npm ci` — install. **Requires `.npmrc`**: `legacy-peer-deps=true` (xterm 6 + addon betas have mismatched peer deps) and a pinned `registry=https://registry.npmjs.org/`. Do not regenerate the lockfile with a personal mirror — a previous lockfile pinned a CN mirror and broke CI on US runners.
2. `npm run build` — `tsc` strict typecheck + `vite build`, emits `../dist`. **`cargo check` will fail without this**, because tauri's `build.rs` requires `../dist` to exist.
3. `npm run smoke:check` — static wiring check: every frontend `invoke("x")` must have a matching `#[tauri::command] fn x` registered in `generate_handler!` in `src-tauri/src/lib.rs`. Also asserts `settingsStore` exports + persistence calls, `ServerPanel` cleanup invokes `stop_server_metrics`, and `metrics.rs` wraps polling in a 5s timeout. Adding an IPC command without wiring both sides fails here.
4. `cargo check` (run from `src-tauri/`) — backend type/borrow check. Run `cargo fmt` before submitting.

Other:

- `npm run dev` — frontend-only Vite dev server (port 1420, `strictPort`).
- `npm run tauri dev` — full desktop app with hot reload (runs `npm run dev` for you via `beforeDevCommand`).
- `npm run tauri build` — production packages.
- `npm version <x>` — runs the `version` lifecycle script, which rewrites the new version into `src-tauri/Cargo.toml` and stages it. Do not edit `Cargo.toml` version by hand.

## Tests

There is no Vitest/Jest runner. Tests are standalone Node scripts run directly:

- `node scripts/test-completion.mjs`
- `node scripts/test-split-layout.mjs`

Both transpile TS in-memory via the `typescript` package; no build step needed.

## Architecture notes (not obvious from filenames)

- **IPC contract**: frontend `invoke(name)` ↔ backend `#[tauri::command] fn name` registered in `lib.rs` `generate_handler!`. Backend pushes events: `pty-data-{id}`, `ssh-data-{id}`, `serial-data-{id}`, `*-exit-{id}`, `sftp-progress-{id}`, `server-metrics-{id}`.
- **`components/Terminal/TerminalView.tsx`**: xterm instances live in module-level maps outside React so they survive re-renders and split changes. Invariant: only one listener set per tab id — call `cleanupTabListeners()` before re-attaching, or you get duplicate listeners.
- **Split-pane**: `splitCount` ∈ {1,2,4,6,8} (1×1, 2×1, 2×2, 2×3, 2×4). Pure slot helpers in `src/lib/splitLayout.ts` (`buildSplitPanes`/`clearSlot`/`fillFirstEmpty`). Split state is session-only, not persisted.
- **Session types**: `ssh | localshell | docker | serial`. SFTP is a side panel on an SSH tab, not a session type. Terminal tabs are reorderable via `@dnd-kit`; the asset-list home tab is pinned first.
- **State**: `stores/appStore.ts` (sessions, tabs, split, modals, theme, locale) and `stores/settingsStore.ts` (preferences, persisted via `save_app_settings`/`load_app_settings`). Many store mutations fire backend `invoke()` side effects (e.g. `addSession` writes SQLite).
- **i18n**: `i18n/locales/gwshell.{en,zh}.json`, namespace `gwshell`. Both locale files must stay key-for-key identical — add/remove keys in both at once. Every user-facing string goes through i18next.
- **Backend layout** (`src-tauri/src/`): `lib.rs` (entry point, command handlers, tray, quake dropdown window, global shortcuts), `ssh/` (russh-based: connect/auth/transport/session/sftp/forward/exec/known_hosts), `pty.rs` (local shells via portable_pty), `serial.rs`, `docker.rs`, `metrics.rs` (server panel poller), `database.rs` (rusqlite, stored in `%LOCALAPPDATA%/gwshell/`), `crypto.rs`/`vault.rs` (keyring-encrypted secrets + Argon2id app lock), `agent/` (AI runtime: provider/policy/redaction/tools — newer module).

## Style

- TS strict with `noUnusedLocals` + `noUnusedParameters` — remove unused code or mark intentional. Two-space indent, named exports, PascalCase component files (`TerminalView.tsx`), `useX` hooks, `xStore.ts` stores, shared types in `src/types`.
- Rust snake_case modules, run `cargo fmt`.

## Conventions

- Conventional Commits: `feat:`, `fix:`, `refactor:`, `perf:`, `chore:`, `docs:`, with optional scope (`fix(ui): ...`). Imperative subject.
- Note platform-specific behavior (Windows/macOS/Linux, SSH, serial, packaging) in PR descriptions for relevant changes.

## Security

- Never commit real SSH credentials, private keys, tokens, or local SQLite DB files.
- Tauri capabilities live in `src-tauri/capabilities/default.json` (scoped to the `main` window). Keep IPC permissions narrow; review changes here carefully.
- Secrets are encrypted at rest via an OS-keyring master key (`crypto.rs`/`vault.rs`). Asset exports never include passwords.
