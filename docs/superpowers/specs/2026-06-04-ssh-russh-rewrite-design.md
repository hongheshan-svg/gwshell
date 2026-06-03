# SSH Layer Rewrite on russh — Design

**Date:** 2026-06-04
**Status:** Approved (design); pending implementation plan
**Scope:** Replace the `ssh2`/libssh2 SSH backend (`src-tauri/src/ssh.rs`) entirely with an async implementation on `russh` + `russh-sftp`. Frontend and Tauri IPC contract unchanged.

## Problem

The current interactive-SSH backend uses one OS thread per session that owns a libssh2 `Session`, toggles blocking mode on/off, and hand-interleaves non-blocking reads and writes. Under rapid input the outbound SSH stream is corrupted; the server drops the TCP connection; `channel.read()` then returns a continuous stream of `LIBSSH2_ERROR_SOCKET_RECV` ("transport read") errors that the loop classifies as **non-fatal** and retries forever — a silent freeze with no disconnect surfaced.

This was confirmed at runtime via diagnostics (`GWSHELL_SSH_DEBUG=1`): healthy operation, then a burst, then unbroken `read/loop Err kind=Other msg="transport read"` plus `SSH write failed: Failure while draining incoming flow`, while the owner thread keeps looping (≈19 iters/s) and never emits `ssh-exit`.

The `ssh2`/libssh2 documentation states the root constraint directly: *"async operations must not be interwoven — calling function B while function A's future is sleeping will corrupt the internal buffers libssh2 uses for the session."* This is an architectural property of the library, not a tunable bug. Three prior fixes in this area have failed.

## Decision

- **Library:** `russh` (pure-Rust, async/Tokio) + `russh-sftp`. This is the engine Tabby — the closest analog to gwshell — migrated to. Pure-Rust async **structurally eliminates the bug class**: no C session to corrupt, no blocking-mode flag to toggle; read and write are independent async tasks coordinated by the event loop.
- **Scope:** Full replacement. Remove the `ssh2` dependency entirely. SFTP, exec, metrics, port-forwarding, jump host, proxies, and host-key verification all move to russh.
- **Crypto backend:** `ring` feature (no CMake/NASM toolchain → smoother Windows/macOS/Linux builds). Switchable to `aws-lc-rs` later if its performance/algorithms are wanted.

## Licensing

russh (Apache-2.0), russh-sftp (Apache-2.0), Tabby (MIT), gwshell (MIT) — all compatible.

- russh example code (`client_exec_interactive.rs`, `sftp_client.rs`) is **copied/adapted directly** with an Apache-2.0 attribution header on those files.
- Tabby's SSH logic is TypeScript calling russh via a native binding; there is no Rust to paste. Its control flow is **reimplemented in Rust** using Tabby as a blueprint (MIT-credit where substantial structure is lifted).

## Core architecture

One `russh::client::Handle` per SSH connection, driven by the existing Tokio runtime (Tauri runs `tokio` with `features=["full"]`; no new runtime). russh multiplexes channels over one connection, so a single connection carries the shell channel plus on-demand SFTP/exec channels.

Per session:
- **Shell channel:** `channel_open_session` → `request_pty("xterm-256color", cols, rows, 0, 0, &[])` → `request_shell(true)`. A `select!` loop:
  - `ChannelMsg::Data` / `ChannelMsg::ExtendedData` → forward bytes to the existing `ssh-data-{session_id}` event (keep the streaming UTF-8 decoder + ~16 ms batching from the current code).
  - `ChannelMsg::Eof` / `ChannelMsg::Close` → emit `ssh-exit-{session_id}`.
  - Input branch: bytes received from `write_to_ssh` (via an `mpsc`) → `channel.data(&bytes)`.
  - Keep a `_ => {}` arm (`ChannelMsg` is `#[non_exhaustive]`).
- **Input:** `write_to_ssh` sends bytes to the session task over an `mpsc`; the task calls `channel.data(...)`. No blocking mode, no manual interleave — Tokio handles backpressure. **This removes the freeze.**
- **Resize:** `channel.window_change(cols, rows, 0, 0)`.
- **Disconnect surfacing:** any persistent error / EOF / close from the event loop emits `ssh-exit-{session_id}` so a dead connection always becomes a clean "press any key to reconnect", never a silent spin.

**Deleted:** the entire `aux` / `metrics_aux` / `sftp_worker` / `aux_unavailable_until` apparatus, which existed only because libssh2 cannot run concurrent operations on one session. With russh, SFTP/exec/metrics are additional channels on the same connection.

`Config` settings: `keepalive_interval: Some(30s)`, `keepalive_max: 3`, `inactivity_timeout` derived from `idle_disconnect_minutes` (None when 0), `nodelay: true`.

## Feature mapping

| Feature | russh mechanism | Source pattern |
|---|---|---|
| Transport (direct / SOCKS5 / HTTP / jump) | Build the stream, then `client::connect_stream(cfg, stream, handler)` — one path for all | Tabby `ssh.ts` |
| Jump host (ProxyJump) | On jump session: `channel_open_direct_tcpip(target, port, "127.0.0.1", 0)` → `.into_stream()` → `connect_stream` over it; chainable for N hops | russh |
| SOCKS5 / HTTP proxy | Reuse `socks` crate / manual HTTP CONNECT → proxied `TcpStream` → `connect_stream` | existing code |
| Auth: none → publickey → agent → password → keyboard-interactive | Ordered fallback loop driven by `AuthResult` remaining-methods; `authenticate_none/publickey/password/keyboard_interactive_*`; handle k-i zero-prompt case and password auto-fill; agent via `russh::keys` (OpenSSH pipe/Pageant on Windows, `$SSH_AUTH_SOCK`/configured path on Unix) | Tabby `_handleAuth()` |
| Host key / known_hosts | `Handler::check_server_key` → SHA-256 fingerprint compared against existing `known_hosts.json`; on unknown/mismatch fail connect with the **existing `FINGERPRINT_UNKNOWN:<fp>:<type>` / `FINGERPRINT_MISMATCH:<fp>:<type>` error strings** the frontend parses; `ssh_trust_host` + retry flow preserved | gwshell store + Tabby UX |
| Shell / input / resize | as in Core architecture | russh example |
| SFTP | `request_subsystem(true, "sftp")` on a second channel → `russh_sftp::client::SftpSession::new(channel.into_stream())`; map all current ops (readdir/stat/realpath/mkdir/rmdir/unlink/rename/open/read/write/chmod/create) | russh sftp example |
| exec / metrics | `channel_open_session` + `exec` on the same connection | russh |
| Local port forward (tunnel) | local TCP listener → per accept, `channel_open_direct_tcpip` → bridge socket↔channel stream | Tabby `forwards.ts` |
| Keepalive / idle disconnect | `Config.keepalive_interval` + `keepalive_max` + `inactivity_timeout` | replaces manual blocking keepalive |

## IPC contract (unchanged)

All Tauri command names and parameters are preserved: `ssh_connect`, `ssh_trust_host`, `start_tunnel`, `write_to_ssh`, `resize_ssh`, `close_ssh`, `ssh_exec`, and all `sftp_*` (`sftp_list`, `sftp_realpath`, `sftp_mkdir`, `sftp_rmdir`, `sftp_delete_file`, `sftp_rename`, `sftp_download`, `sftp_upload`, `sftp_open_file`, `sftp_read_text`, `sftp_write_text`, `sftp_chmod`, `sftp_create_file`), plus `metrics_exec` consumed by `metrics.rs`. Events stay `ssh-data-{id}` and `ssh-exit-{id}`. Fingerprint error string format preserved. Result: `TerminalView.tsx`, `SftpPanel.tsx`, `metrics.rs`, and the store need no changes.

The `metrics.rs` callers currently use `tokio::task::spawn_blocking(|| ssh_manager.metrics_exec(...))`. Since the new manager is async, these call sites change to `await` the async method (still off the UI path); the public command surface is unchanged.

## Components

- `ssh/mod.rs` — `SshManager` (async): per-session registry of `Handle` + writer `mpsc` + cancellation; public async methods mirroring today's command surface.
- `ssh/handler.rs` — `client::Handler` impl: `check_server_key` (known_hosts/fingerprint), data/eof/close handling hooks.
- `ssh/connect.rs` — transport building (direct/SOCKS5/HTTP/jump) → `connect_stream`; auth fallback loop.
- `ssh/session.rs` — shell channel task (PTY/shell, I/O `select!` loop, resize, exit emission).
- `ssh/sftp.rs` — SFTP subsystem channel + file ops.
- `ssh/forward.rs` — local port forwarding.
- `ssh/known_hosts.rs` — known_hosts JSON store + fingerprint formatting (ports existing logic).

Each unit has one purpose and a narrow interface; the previous single 1700-line `ssh.rs` is decomposed.

## Error handling

- Connect failures map to the same user-facing error strings as today (including the fingerprint protocol strings).
- Any session-task termination (auth/connection error, server disconnect, EOF, idle timeout) emits `ssh-exit-{id}` exactly once; the writer `mpsc` send returns an error the command layer maps to "Session not found"/closed, matching current behavior.
- No error path spins silently: persistent transport failure ends the session task and surfaces `ssh-exit`.

## Testing

No automated SSH tests exist (project convention). Verification:
1. `cargo build` clean; `npm run smoke:check` PASS.
2. `GWSHELL_SSH_DEBUG=1` heartbeat confirms no error-spin under load.
3. Live repro matrix: rapid Enter/typing stays responsive (the original bug); large output burst (`cat` big file, `top`); idle >2 s then type; SFTP browse/upload/download/edit; jump host; SOCKS5 + HTTP proxy; local tunnel; server metrics panel; reconnect-on-disconnect.

## Out of scope

X11 forwarding, remote/dynamic port forwarding (only local forward exists today), SSH config (`~/.ssh/config`) parsing, agent forwarding. Serial and local-PTY paths are untouched.
