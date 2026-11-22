# Backend (`src-tauri/src/`)

- **Reverse (-R) port forwarding** is handled in `ssh/handler.rs` and `ssh/mod.rs`, not in `ssh/forward.rs`.
- **Secrets** are encrypted with an OS-keyring master key before they touch SQLite (`crypto.rs`/`vault.rs`). When no keyring is available they are dropped (stored empty), never written in plaintext; the frontend warns via `secret_storage_available`.
- **AI agent safety**: `agent/risk.rs` (`classify_tool_call`) rates each command the assistant proposes, and `should_auto_execute_agent_action_with_policy` in `lib.rs` decides which ones run without confirmation. Security-sensitive; review changes there carefully.
