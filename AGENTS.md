# Repository Guidelines

## Project Structure & Module Organization

GWShell is a Tauri 2 desktop app with a React/Vite frontend and Rust backend. Frontend code lives in `src/`: UI in `src/components`, Zustand stores in `src/stores`, hooks in `src/hooks`, shared types in `src/types`, i18n files in `src/i18n`, and global styles in `src/styles`. Static web assets are in `public`; app icons, capabilities, and Tauri config are under `src-tauri`. Rust backend modules are in `src-tauri/src`, including SSH, PTY, serial, session, and database code. Localized README files are in `docs`.

## Build, Test, and Development Commands

- `npm install`: install JavaScript dependencies from `package-lock.json`.
- `npm run dev`: start the Vite frontend for browser-based UI work.
- `npm run build`: run TypeScript checking with `tsc`, then build the Vite bundle.
- `npm run tauri dev`: run the full Tauri desktop app in development.
- `npm run tauri build`: create production desktop packages.
- `cd src-tauri; cargo check`: verify Rust backend code without producing packages.

## Coding Style & Naming Conventions

TypeScript uses strict compiler settings, including `noUnusedLocals` and `noUnusedParameters`; remove unused code or make intentional unused values explicit. Use React function components, named exports, and PascalCase component files such as `TerminalView.tsx`. Hooks should use `useX` naming, stores should use `xStore.ts`, and shared types belong in `src/types`. Keep Rust modules snake_case and run `cargo fmt` before submitting backend changes. Match existing two-space indentation in frontend files.

## Testing Guidelines

There is no dedicated first-party test runner configured yet. For now, validate changes with `npm run build` and `cargo check` for backend changes. When adding tests, place frontend tests near the feature as `*.test.ts` or `*.test.tsx`, and Rust unit tests in the relevant `src-tauri/src/*.rs` module or integration tests under `src-tauri/tests`.

## Commit & Pull Request Guidelines

Recent history uses Conventional Commit prefixes such as `feat:`, `fix:`, and `refactor:`. Keep subjects imperative and scoped, for example `fix: handle empty session list`. Pull requests should include a short summary, verification commands, linked issues when applicable, and screenshots or recordings for visible UI changes. Note platform-specific behavior for Windows, macOS, Linux, SSH, serial, or packaging changes.

## Security & Configuration Tips

Do not commit real SSH credentials, private keys, tokens, or local database files. Review Tauri capability changes in `src-tauri/capabilities/default.json`, and keep IPC commands narrowly scoped.
