# CLAUDE.md

## Commands

Testing: the Rust backend has 170+ tests (`cargo test`); the frontend has no
component-test framework but ships targeted node scripts (`npm run test:node`)
plus the static smoke check. Run `npm run ci:check` before committing to mirror
what CI enforces. The backend CI job runs `cargo fmt --check`,
`cargo clippy --all-targets -- -D warnings` and `cargo test` on Ubuntu, macOS
and Windows; `cargo audit` runs separately in `.github/workflows/security.yml`.

### Prerequisites

- Node.js 20+
- Rust 1.92+
- Platform-specific Tauri v2 prerequisites (C++ build tools on Windows, webkit2gtk on Linux, etc.)

## Architecture

Frontend and backend directory guides are in `src/CLAUDE.md` and `src-tauri/CLAUDE.md` — they load automatically when a session works under those directories.

### Version Syncing

`npm version` triggers the `version` npm lifecycle script (see `package.json`), which rewrites the `version` field in `src-tauri/Cargo.toml` to match `package.json` and `git add`s it so the bump lands in the same commit/tag. `tauri.conf.json` has no `version` field — it inherits the version from Cargo.toml at build time.
