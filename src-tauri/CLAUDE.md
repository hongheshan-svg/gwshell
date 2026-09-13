# Backend (`src-tauri/src/`)

- **`lib.rs`** — entry point, `AppState` struct, all `#[tauri::command]` handlers, tray icon setup, Quake dropdown window, global shortcut, window close→hide behavior
- **`ssh/`** — async SSH backend on **russh** (pure Rust). `mod.rs` holds `SshManager`; submodules: `connect`/`auth`/`transport` (connection + jump host + proxies), `session` (shell/exec I/O pumps), `sftp` (file ops, recursive dir transfer with progress callbacks), `forward` (-L local and -D SOCKS5 forwarding; -R lives in `handler`/`mod`), `exec`, `known_hosts` (stored in `%LOCALAPPDATA%/gwshell/known_hosts.json`), `params`
- **`ssh_config.rs`** — `~/.ssh/config` parser for the asset import command (unit-tested)
- **`pty.rs`** — `PtyManager`: local shell sessions via `portable_pty`. Per-OS shell resolution (PowerShell, CMD, Bash, Git Bash, WSL distros, Zsh, Fish)
- **`serial.rs`** — `SerialManager`: serial port connections
- **`docker.rs`** — list containers / exec into them, locally (PTY) or over SSH (unit-tested parsing)
- **`metrics.rs`** — server panel poller: CPU/mem/disk/NIC/process stats over `ssh exec`
- **`session.rs`** — `SessionConfig` data structure
- **`database.rs`** — SQLite persistence via `rusqlite` (sessions, settings, command history, snippets), stored in `%LOCALAPPDATA%/gwshell/`
- **`crypto.rs`** / **`vault.rs`** — secrets are encrypted before they touch SQLite (OS keyring master key); optional Argon2id master-passphrase app lock. When no OS keyring is available, secrets are dropped (stored empty) rather than written in plaintext — the frontend warns via `secret_storage_available`.
- **`history.rs`** — command history persistence helpers
- **`agent/`** — the AI server-assistant backend. `manager` tracks agent sessions; `provider` streams from the configured LLM API (key stored encrypted, never returned to the frontend); `types` defines the tool/session data model; `tools` + `stream` build the read-only diagnostic commands (journal/service/docker/file tails); `risk` (`classify_tool_call`) classifies each proposed command's danger level; `policy` gates auto-execution; `redaction` strips secrets from evidence before it reaches the model; `audit` persists an audit trail; `prompt`, `alerts`, `log_filter`, `mock` support the rest. Security-sensitive: risk classification and the auto-execute allowlist live here.
