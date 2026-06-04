# SSH russh Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `ssh2`/libssh2 SSH backend with an async `russh` + `russh-sftp` implementation that eliminates the interactive-input freeze, preserving the exact Tauri IPC contract.

**Architecture:** One `russh::client::Handle` per connection on the existing Tokio runtime. The shell runs as an async task with a `select!` loop (channel data → `ssh-data-{id}` events; UI input via `mpsc` → `channel.data`). SFTP, exec, metrics, and port-forwarding are additional channels on the same connection — there is no blocking-mode toggling and no shared C session, which is what removes the freeze. The old `ssh.rs` stays compiling until a final cutover task swaps the wiring and deletes it.

**Tech Stack:** Rust, Tauri 2, Tokio, `russh`, `russh-sftp`, `russh::keys`, `socks` (SOCKS5 reuse), `encoding_rs` (UTF-8 streaming decode, reused).

---

## Reconciliation note (read first)

`russh`'s API shifts between minor versions. Every code block below uses the canonical 0.5x/0.6x pattern, but **before writing each russh-touching task, run `cargo doc -p russh --no-deps --open` (or read `~/.cargo/registry/src/*/russh-*/src/`) for the pinned version and reconcile exact signatures** (`request_pty`, `authenticate_publickey`, `ChannelMsg` variants, `keys` module path). Where a signature differs, keep the structure and adjust the call. This is expected, not a deviation.

## File structure

- `src-tauri/Cargo.toml` — deps (add russh stack; remove `ssh2` at cutover)
- `src-tauri/src/ssh/mod.rs` — `SshManager` (async), session registry, public API, submodule wiring
- `src-tauri/src/ssh/known_hosts.rs` — known_hosts JSON store, fingerprint formatting, `trust_host` (pure logic + unit tests)
- `src-tauri/src/ssh/params.rs` — `ConnectParams` (owned connection config), shared by all submodules
- `src-tauri/src/ssh/transport.rs` — build the underlying stream (direct / SOCKS5 / HTTP); returns a boxed async stream
- `src-tauri/src/ssh/handler.rs` — `client::Handler` impl + custom `HandlerError` carrying the fingerprint
- `src-tauri/src/ssh/auth.rs` — ordered auth fallback loop
- `src-tauri/src/ssh/connect.rs` — orchestrate transport → `connect_stream` → auth; jump-host chaining
- `src-tauri/src/ssh/session.rs` — shell channel task (PTY/shell/`select!`/resize/exit) + writer `mpsc`
- `src-tauri/src/ssh/exec.rs` — one-shot exec (`ssh_exec`, `metrics_exec`)
- `src-tauri/src/ssh/sftp.rs` — SFTP subsystem channel + file ops
- `src-tauri/src/ssh/forward.rs` — local port forwarding
- `src-tauri/src/lib.rs` — command handlers re-wired to `await` the async manager (cutover)
- `src-tauri/src/metrics.rs` — `spawn_blocking` → `await` (cutover)
- delete `src-tauri/src/ssh.rs` (cutover)

The old `src-tauri/src/ssh.rs` and its `SshManager` remain the live implementation (referenced by `lib.rs`/`metrics.rs`) until Task 12. New modules compile under `#[allow(dead_code)]` until then.

---

## Task 1: Add russh dependencies, keep building

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs` (declare new module)

- [ ] **Step 1: Add deps**

In `src-tauri/Cargo.toml` under `[dependencies]`, keep `ssh2 = "0.9"` for now and add (pin to the latest published versions; check crates.io):

```toml
russh = { version = "0.54", default-features = false, features = ["ring"] }
russh-sftp = "2"
```

`russh::keys` is re-exported from `russh` (no separate `russh-keys` dep needed in recent versions; if the pinned version requires it, add `russh-keys = "0.49"` and adjust imports). Confirm with `cargo doc -p russh`.

- [ ] **Step 2: Create empty module tree**

Create `src-tauri/src/ssh/mod.rs`:

```rust
//! Async SSH backend on russh. Replaces the libssh2 `ssh.rs` at cutover.
#![allow(dead_code)] // until cutover (Task 12)

mod known_hosts;
mod params;
```

In `src-tauri/src/lib.rs`, find `mod ssh;` and add directly under it:

```rust
mod ssh; // legacy libssh2 (removed at cutover)
#[path = "ssh/mod.rs"]
mod ssh_next;
```

(Using `ssh_next` avoids a name clash with the existing `ssh.rs` while both exist. At cutover we delete `ssh.rs`, rename the module to `ssh`, and drop the `#[path]`.)

Create placeholder `src-tauri/src/ssh/known_hosts.rs` and `src-tauri/src/ssh/params.rs` each containing only `// placeholder`.

- [ ] **Step 3: Build**

Run: `cd src-tauri && cargo build`
Expected: compiles (warnings about unused modules are fine).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/src/ssh/
git commit -m "build(ssh): add russh deps and empty ssh_next module"
```

---

## Task 2: known_hosts store + fingerprint formatting (pure logic, TDD)

**Files:**
- Create/replace: `src-tauri/src/ssh/known_hosts.rs`
- Test: same file `#[cfg(test)]`

- [ ] **Step 1: Write failing tests**

Replace `src-tauri/src/ssh/known_hosts.rs` with the test module first:

```rust
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct KnownHostEntry {
    pub fingerprint: String,
    pub key_type: String,
}

/// Result of checking a server key against the local store.
#[derive(Debug, PartialEq)]
pub enum HostKeyVerdict {
    Trusted,
    Unknown { fingerprint: String, key_type: String },
    Mismatch { fingerprint: String, key_type: String },
}

/// Format a raw SHA-256 host-key hash as the `SHA256:<base64>` string the UI shows.
pub fn format_fingerprint(sha256: &[u8]) -> String {
    format!("SHA256:{}", BASE64.encode(sha256))
}

pub fn verify(
    hosts: &HashMap<String, KnownHostEntry>,
    host: &str,
    port: u16,
    fingerprint: &str,
    key_type: &str,
) -> HostKeyVerdict {
    let key = format!("{}:{}", host, port);
    match hosts.get(&key) {
        Some(e) if e.fingerprint == fingerprint => HostKeyVerdict::Trusted,
        Some(_) => HostKeyVerdict::Mismatch {
            fingerprint: fingerprint.to_string(),
            key_type: key_type.to_string(),
        },
        None => HostKeyVerdict::Unknown {
            fingerprint: fingerprint.to_string(),
            key_type: key_type.to_string(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> HashMap<String, KnownHostEntry> {
        let mut m = HashMap::new();
        m.insert(
            "h:22".to_string(),
            KnownHostEntry { fingerprint: "SHA256:AAA".into(), key_type: "Ed25519".into() },
        );
        m
    }

    #[test]
    fn format_fingerprint_prefixes_sha256() {
        assert_eq!(format_fingerprint(&[0, 0, 0]), "SHA256:AAAA");
    }

    #[test]
    fn verify_trusted_when_match() {
        assert_eq!(verify(&store(), "h", 22, "SHA256:AAA", "Ed25519"), HostKeyVerdict::Trusted);
    }

    #[test]
    fn verify_mismatch_when_changed() {
        assert!(matches!(
            verify(&store(), "h", 22, "SHA256:BBB", "Ed25519"),
            HostKeyVerdict::Mismatch { .. }
        ));
    }

    #[test]
    fn verify_unknown_when_absent() {
        assert!(matches!(
            verify(&store(), "other", 22, "SHA256:CCC", "RSA"),
            HostKeyVerdict::Unknown { .. }
        ));
    }
}
```

- [ ] **Step 2: Run tests to verify they fail/pass**

Run: `cd src-tauri && cargo test --lib ssh::known_hosts`
Expected: compiles and the 4 tests PASS (the logic above is already complete). If it does not compile, fix imports.

- [ ] **Step 3: Add the persistence + trust functions**

Append to `src-tauri/src/ssh/known_hosts.rs` (ported verbatim from the old `ssh.rs` `known_hosts_path`/`load_known_hosts`/`save_known_hosts`/`trust_host`):

```rust
fn known_hosts_path() -> Option<std::path::PathBuf> {
    dirs::data_local_dir().map(|d| d.join("gwshell").join("known_hosts.json"))
}

pub fn load() -> HashMap<String, KnownHostEntry> {
    known_hosts_path()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save(hosts: &HashMap<String, KnownHostEntry>) {
    if let Some(path) = known_hosts_path() {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(hosts) {
            let _ = fs::write(path, json);
        }
    }
}

pub fn trust_host(host: &str, port: u16, fingerprint: &str, key_type: &str) {
    let mut hosts = load();
    hosts.insert(
        format!("{}:{}", host, port),
        KnownHostEntry { fingerprint: fingerprint.to_string(), key_type: key_type.to_string() },
    );
    save(&hosts);
}
```

- [ ] **Step 4: Build + test**

Run: `cd src-tauri && cargo test --lib ssh::known_hosts && cargo build`
Expected: tests PASS, build OK.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/ssh/known_hosts.rs
git commit -m "feat(ssh): known_hosts store + fingerprint verify (russh module)"
```

---

## Task 3: ConnectParams

**Files:**
- Create/replace: `src-tauri/src/ssh/params.rs`
- Modify: `src-tauri/src/ssh/mod.rs` (already declares `mod params;`)

- [ ] **Step 1: Define the owned params struct**

Replace `src-tauri/src/ssh/params.rs` (mirror the fields of the old `ConnectParams` in `ssh.rs`):

```rust
#[derive(Clone, Debug)]
pub struct ConnectParams {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub auth_method: String,
    pub totp_code: Option<String>,
    pub jump_host: Option<String>,
    pub jump_port: u16,
    pub jump_username: Option<String>,
    pub jump_password: Option<String>,
    pub jump_private_key_path: Option<String>,
    pub proxy_type: Option<String>,
    pub proxy_host: Option<String>,
    pub proxy_port: u16,
    pub proxy_username: Option<String>,
    pub proxy_password: Option<String>,
    pub connection_timeout: u32,
    pub idle_disconnect_minutes: u32,
}
```

- [ ] **Step 2: Build**

Run: `cd src-tauri && cargo build`
Expected: OK.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/ssh/params.rs
git commit -m "feat(ssh): ConnectParams for russh module"
```

---

## Task 4: Transport builder (direct / SOCKS5 / HTTP)

**Files:**
- Create: `src-tauri/src/ssh/transport.rs`
- Modify: `src-tauri/src/ssh/mod.rs` (add `mod transport;`)

- [ ] **Step 1: Define the boxed-stream alias and tilde helper**

Create `src-tauri/src/ssh/transport.rs`:

```rust
use crate::ssh::params::ConnectParams;
use std::io::{self, Read, Write};
use std::net::TcpStream;
use std::time::Duration;
use tokio::net::TcpStream as TokioTcp;

/// A connected, async, byte-oriented stream to hand to russh's `connect_stream`.
pub type SshStream = Box<dyn AsyncStream>;
pub trait AsyncStream: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send {}
impl<T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send> AsyncStream for T {}

/// Expand a leading `~`/`~/` to the home dir. (Ported from ssh.rs.)
pub fn expand_tilde(path: &str) -> std::path::PathBuf {
    use std::path::PathBuf;
    if path == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from("~"));
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}
```

- [ ] **Step 2: Direct + proxied TCP to the *target* (no jump yet)**

Append:

```rust
/// Build the underlying transport stream to the target host (direct or via
/// SOCKS5/HTTP proxy). Jump-host transport is handled in connect.rs because it
/// needs an established russh session. Returns a tokio async stream.
pub async fn build_direct_or_proxied(p: &ConnectParams) -> Result<SshStream, String> {
    match p.proxy_type.as_deref().unwrap_or("none") {
        "socks5" => {
            let std_stream = socks5_connect(p)?;
            std_stream.set_nonblocking(true).map_err(|e| e.to_string())?;
            let tok = TokioTcp::from_std(std_stream).map_err(|e| e.to_string())?;
            Ok(Box::new(tok))
        }
        "http" => {
            let std_stream = http_connect(p)?;
            std_stream.set_nonblocking(true).map_err(|e| e.to_string())?;
            let tok = TokioTcp::from_std(std_stream).map_err(|e| e.to_string())?;
            Ok(Box::new(tok))
        }
        _ => {
            let addr = format!("{}:{}", p.host, p.port);
            let tok = if p.connection_timeout > 0 {
                tokio::time::timeout(
                    Duration::from_secs(p.connection_timeout as u64),
                    TokioTcp::connect(&addr),
                )
                .await
                .map_err(|_| format!("Connection to {} timed out", addr))?
                .map_err(|e| format!("Connection to {} failed: {}", addr, e))?
            } else {
                TokioTcp::connect(&addr).await.map_err(|e| format!("Connection to {} failed: {}", addr, e))?
            };
            Ok(Box::new(tok))
        }
    }
}

fn socks5_connect(p: &ConnectParams) -> Result<TcpStream, String> {
    let proxy = format!("{}:{}", p.proxy_host.as_deref().unwrap_or(""), p.proxy_port);
    let target = format!("{}:{}", p.host, p.port);
    let s = match (p.proxy_username.as_deref(), p.proxy_password.as_deref()) {
        (Some(u), Some(pw)) => socks::Socks5Stream::connect_with_password(proxy.as_str(), target.as_str(), u, pw),
        _ => socks::Socks5Stream::connect(proxy.as_str(), target.as_str()),
    }
    .map_err(|e| format!("SOCKS5 proxy failed: {}", e))?;
    Ok(s.into_inner())
}

fn http_connect(p: &ConnectParams) -> Result<TcpStream, String> {
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
    let mut stream = TcpStream::connect(format!("{}:{}", p.proxy_host.as_deref().unwrap_or(""), p.proxy_port))
        .map_err(|e| format!("HTTP proxy connection failed: {}", e))?;
    let mut req = format!(
        "CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n",
        host = p.host, port = p.port
    );
    if let (Some(u), Some(pw)) = (p.proxy_username.as_deref(), p.proxy_password.as_deref()) {
        let creds = BASE64.encode(format!("{}:{}", u, pw).as_bytes());
        req.push_str(&format!("Proxy-Authorization: Basic {}\r\n", creds));
    }
    req.push_str("\r\n");
    stream.write_all(req.as_bytes()).map_err(|e| format!("HTTP CONNECT request failed: {}", e))?;
    let mut resp = [0u8; 4096];
    let n = stream.read(&mut resp).map_err(|e| format!("HTTP proxy response failed: {}", e))?;
    let s = String::from_utf8_lossy(&resp[..n]);
    if !s.contains("200") {
        return Err(format!("HTTP proxy refused: {}", s.lines().next().unwrap_or("")));
    }
    Ok(stream)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn expand_tilde_leaves_absolute_unchanged() {
        assert_eq!(expand_tilde("/etc/x"), std::path::PathBuf::from("/etc/x"));
    }
    #[test]
    fn expand_tilde_expands_prefix() {
        let home = dirs::home_dir().unwrap();
        assert_eq!(expand_tilde("~/.ssh/id"), home.join(".ssh/id"));
    }
}
```

Add `mod transport;` to `ssh/mod.rs`.

- [ ] **Step 3: Build + test**

Run: `cd src-tauri && cargo test --lib ssh::transport && cargo build`
Expected: tests PASS, build OK.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/ssh/transport.rs src-tauri/src/ssh/mod.rs
git commit -m "feat(ssh): transport builder (direct/SOCKS5/HTTP) for russh"
```

---

## Task 5: Handler with check_server_key

**Files:**
- Create: `src-tauri/src/ssh/handler.rs`
- Modify: `src-tauri/src/ssh/mod.rs` (add `mod handler;`)

- [ ] **Step 1: Implement the handler**

Create `src-tauri/src/ssh/handler.rs`. Reconcile the `check_server_key` signature and the key-hash API with `cargo doc -p russh` (the `ssh_key::PublicKey` fingerprint API):

```rust
use crate::ssh::known_hosts::{self, HostKeyVerdict};
use russh::client;

/// Carries a host-key rejection reason out of the handshake so connect.rs can
/// turn it into the exact `FINGERPRINT_UNKNOWN:`/`FINGERPRINT_MISMATCH:` string
/// the frontend already parses.
#[derive(Debug, Clone)]
pub enum HostKeyError {
    Unknown { fingerprint: String, key_type: String },
    Mismatch { fingerprint: String, key_type: String },
}

pub struct Client {
    pub host: String,
    pub port: u16,
    /// Set by check_server_key when it rejects, read by connect.rs.
    pub rejection: std::sync::Arc<std::sync::Mutex<Option<HostKeyError>>>,
}

impl client::Handler for Client {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        // SHA-256 fingerprint string "SHA256:<base64-no-pad>"; russh exposes a
        // fingerprint helper — reconcile exact call with cargo doc. Fall back to
        // hashing the OpenSSH wire bytes if needed.
        let fp = server_public_key
            .fingerprint(russh::keys::ssh_key::HashAlg::Sha256)
            .to_string(); // already "SHA256:..."
        let key_type = server_public_key.algorithm().to_string();

        match known_hosts::verify(&known_hosts::load(), &self.host, self.port, &fp, &key_type) {
            HostKeyVerdict::Trusted => Ok(true),
            HostKeyVerdict::Unknown { fingerprint, key_type } => {
                *self.rejection.lock().unwrap() = Some(HostKeyError::Unknown { fingerprint, key_type });
                Ok(false)
            }
            HostKeyVerdict::Mismatch { fingerprint, key_type } => {
                *self.rejection.lock().unwrap() = Some(HostKeyError::Mismatch { fingerprint, key_type });
                Ok(false)
            }
        }
    }
}
```

Add `mod handler;` to `ssh/mod.rs`.

- [ ] **Step 2: Build**

Run: `cd src-tauri && cargo build`
Expected: OK (reconcile any `fingerprint()`/`algorithm()` API mismatch first).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/ssh/handler.rs src-tauri/src/ssh/mod.rs
git commit -m "feat(ssh): russh Handler with known_hosts check_server_key"
```

---

## Task 6: Auth fallback loop

**Files:**
- Create: `src-tauri/src/ssh/auth.rs`
- Modify: `src-tauri/src/ssh/mod.rs` (add `mod auth;`)

- [ ] **Step 1: Implement ordered auth**

Create `src-tauri/src/ssh/auth.rs`. Reconcile `authenticate_*` signatures with `cargo doc -p russh`:

```rust
use crate::ssh::handler::Client;
use crate::ssh::params::ConnectParams;
use crate::ssh::transport::expand_tilde;
use russh::client::Handle;
use std::sync::Arc;

/// Authenticate `session` using the configured method, with graceful fallback.
/// Mirrors the auth method handling of the old ssh.rs but driven by russh.
pub async fn authenticate(session: &mut Handle<Client>, p: &ConnectParams) -> Result<(), String> {
    let user = &p.username;

    // Reveal allowed methods (also required by some servers before any auth).
    let _ = session.authenticate_none(user).await;

    let ok = match p.auth_method.as_str() {
        "publickey" => try_pubkey(session, p).await?,
        "agent" => try_agent(session, user).await?,
        "keyboardinteractive" => try_keyboard_interactive(session, p).await?,
        "none" => session.authenticate_none(user).await.map(|r| r.success()).unwrap_or(false),
        _ => {
            let pw = p.password.clone().unwrap_or_default();
            session
                .authenticate_password(user, pw)
                .await
                .map(|r| r.success())
                .map_err(|e| format!("Password auth failed: {}", e))?
        }
    };

    if ok {
        Ok(())
    } else {
        Err("Authentication failed".to_string())
    }
}

async fn try_pubkey(session: &mut Handle<Client>, p: &ConnectParams) -> Result<bool, String> {
    let path = p.private_key_path.as_deref().ok_or("Private key path is required")?;
    let key_path = expand_tilde(path);
    if !key_path.exists() {
        return Err(format!("SSH key file not found: {}", key_path.display()));
    }
    let key = russh::keys::load_secret_key(&key_path, p.password.as_deref())
        .map_err(|e| format!("Public key load failed ({}): {}", key_path.display(), e))?;
    let hash = session.best_supported_rsa_hash().await.ok().flatten().flatten();
    let res = session
        .authenticate_publickey(
            &p.username,
            russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key), hash),
        )
        .await
        .map_err(|e| format!("Public key auth failed: {}", e))?;
    Ok(res.success())
}

async fn try_agent(session: &mut Handle<Client>, user: &str) -> Result<bool, String> {
    // Reconcile agent API with cargo doc: connect to the agent, iterate identities,
    // call authenticate_publickey_with for each until one succeeds.
    let mut agent = russh::keys::agent::client::AgentClient::connect_env()
        .await
        .map_err(|e| format!("SSH agent unavailable: {}", e))?;
    let identities = agent.request_identities().await.map_err(|e| format!("Agent identities failed: {}", e))?;
    for id in identities {
        if let Ok(res) = session.authenticate_publickey_with(user, id, None, &mut agent).await {
            if res.success() {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

async fn try_keyboard_interactive(session: &mut Handle<Client>, p: &ConnectParams) -> Result<bool, String> {
    use russh::client::KeyboardInteractiveAuthResponse as R;
    let mut resp = session
        .authenticate_keyboard_interactive_start(&p.username, None)
        .await
        .map_err(|e| format!("Keyboard-interactive start failed: {}", e))?;
    loop {
        match resp {
            R::Success => return Ok(true),
            R::Failure { .. } => return Ok(false),
            R::InfoRequest { prompts, .. } => {
                // Auto-fill password for the first prompt, TOTP for any extra prompt.
                let answers: Vec<String> = prompts
                    .iter()
                    .enumerate()
                    .map(|(i, _)| {
                        if i == 0 {
                            p.password.clone().unwrap_or_default()
                        } else {
                            p.totp_code.clone().unwrap_or_default()
                        }
                    })
                    .collect();
                resp = session
                    .authenticate_keyboard_interactive_respond(answers)
                    .await
                    .map_err(|e| format!("Keyboard-interactive response failed: {}", e))?;
            }
        }
    }
}
```

Add `mod auth;` to `ssh/mod.rs`.

- [ ] **Step 2: Build**

Run: `cd src-tauri && cargo build`
Expected: OK (reconcile `authenticate_*`, `PrivateKeyWithHashAlg`, agent API names against the pinned version).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/ssh/auth.rs src-tauri/src/ssh/mod.rs
git commit -m "feat(ssh): russh auth fallback (pubkey/agent/password/keyboard-interactive)"
```

---

## Task 7: Connect orchestration + jump host

**Files:**
- Create: `src-tauri/src/ssh/connect.rs`
- Modify: `src-tauri/src/ssh/mod.rs` (add `mod connect;`)

- [ ] **Step 1: Build the Config + connect over a stream, with jump chaining**

Create `src-tauri/src/ssh/connect.rs`:

```rust
use crate::ssh::auth;
use crate::ssh::handler::{Client, HostKeyError};
use crate::ssh::params::ConnectParams;
use crate::ssh::transport::{self, expand_tilde, SshStream};
use russh::client::{self, Handle};
use std::sync::{Arc, Mutex};
use std::time::Duration;

fn make_config(idle_minutes: u32) -> Arc<client::Config> {
    Arc::new(client::Config {
        inactivity_timeout: if idle_minutes > 0 {
            Some(Duration::from_secs(idle_minutes as u64 * 60))
        } else {
            None
        },
        keepalive_interval: Some(Duration::from_secs(30)),
        keepalive_max: 3,
        nodelay: true,
        ..Default::default()
    })
}

/// Establish an authenticated russh session to the target, honouring jump host
/// and proxy settings. Returns the live Handle.
pub async fn establish(p: &ConnectParams) -> Result<Handle<Client>, String> {
    let stream = build_transport_stream(p).await?;
    connect_over(stream, p).await
}

async fn build_transport_stream(p: &ConnectParams) -> Result<SshStream, String> {
    if let Some(jh) = p.jump_host.as_deref().filter(|s| !s.is_empty()) {
        // 1. Connect to the jump host itself (direct/proxy only — no nested jump).
        let jump_params = ConnectParams {
            host: jh.to_string(),
            port: p.jump_port,
            username: p.jump_username.clone().unwrap_or_else(|| p.username.clone()),
            password: p.jump_password.clone().or_else(|| p.password.clone()),
            private_key_path: p.jump_private_key_path.clone(),
            auth_method: if p.jump_private_key_path.as_deref().is_some_and(|s| !s.is_empty()) {
                "publickey".into()
            } else {
                "password".into()
            },
            jump_host: None,
            proxy_type: p.proxy_type.clone(),
            proxy_host: p.proxy_host.clone(),
            proxy_port: p.proxy_port,
            proxy_username: p.proxy_username.clone(),
            proxy_password: p.proxy_password.clone(),
            ..p.clone()
        };
        let jump_stream = transport::build_direct_or_proxied(&jump_params).await?;
        let jump_session = connect_over(jump_stream, &jump_params).await?;
        // 2. Open a direct-tcpip channel to the real target through the jump.
        let channel = jump_session
            .channel_open_direct_tcpip(p.host.clone(), p.port as u32, "127.0.0.1".to_string(), 0)
            .await
            .map_err(|e| format!("Jump direct-tcpip failed: {}", e))?;
        // Keep the jump session alive for the lifetime of the tunnel by leaking it
        // into the stream owner. (Store it alongside the channel stream.)
        Ok(Box::new(JumpStream { _jump: jump_session, inner: channel.into_stream() }))
    } else {
        transport::build_direct_or_proxied(p).await
    }
}

/// Wraps a jump channel stream and keeps the jump Handle alive with it.
struct JumpStream<S> {
    _jump: Handle<Client>,
    inner: S,
}
impl<S: tokio::io::AsyncRead + Unpin> tokio::io::AsyncRead for JumpStream<S> {
    fn poll_read(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        let this = unsafe { self.get_unchecked_mut() };
        std::pin::Pin::new(&mut this.inner).poll_read(cx, buf)
    }
}
impl<S: tokio::io::AsyncWrite + Unpin> tokio::io::AsyncWrite for JumpStream<S> {
    fn poll_write(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &[u8],
    ) -> std::task::Poll<std::io::Result<usize>> {
        let this = unsafe { self.get_unchecked_mut() };
        std::pin::Pin::new(&mut this.inner).poll_write(cx, buf)
    }
    fn poll_flush(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        let this = unsafe { self.get_unchecked_mut() };
        std::pin::Pin::new(&mut this.inner).poll_flush(cx)
    }
    fn poll_shutdown(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        let this = unsafe { self.get_unchecked_mut() };
        std::pin::Pin::new(&mut this.inner).poll_shutdown(cx)
    }
}

async fn connect_over(stream: SshStream, p: &ConnectParams) -> Result<Handle<Client>, String> {
    let rejection = Arc::new(Mutex::new(None));
    let handler = Client { host: p.host.clone(), port: p.port, rejection: rejection.clone() };
    let config = make_config(p.idle_disconnect_minutes);

    let mut session = match client::connect_stream(config, stream, handler).await {
        Ok(s) => s,
        Err(e) => {
            // Host-key rejection surfaces as the exact frontend-parsed strings.
            if let Some(rej) = rejection.lock().unwrap().take() {
                return Err(match rej {
                    HostKeyError::Unknown { fingerprint, key_type } =>
                        format!("FINGERPRINT_UNKNOWN:{}:{}", fingerprint, key_type),
                    HostKeyError::Mismatch { fingerprint, key_type } =>
                        format!("FINGERPRINT_MISMATCH:{}:{}", fingerprint, key_type),
                });
            }
            return Err(format!("Handshake failed: {}", e));
        }
    };

    auth::authenticate(&mut session, p).await?;
    let _ = expand_tilde; // referenced for re-export consistency
    Ok(session)
}
```

Add `mod connect;` to `ssh/mod.rs`.

- [ ] **Step 2: Build**

Run: `cd src-tauri && cargo build`
Expected: OK. Reconcile `channel_open_direct_tcpip` arg types (`String` vs `&str`, `u32`) and the `JumpStream` pin-projection (use `pin-project-lite` if you prefer over `unsafe`).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/ssh/connect.rs src-tauri/src/ssh/mod.rs
git commit -m "feat(ssh): connect orchestration with jump-host chaining"
```

---

## Task 8: Shell session task + SshManager (shell path)

**Files:**
- Create: `src-tauri/src/ssh/session.rs`
- Replace: `src-tauri/src/ssh/mod.rs` (introduce `SshManager`)

- [ ] **Step 1: Session task**

Create `src-tauri/src/ssh/session.rs`. Reconcile `request_pty`, `ChannelMsg`, `window_change` against `cargo doc`:

```rust
use crate::ssh::connect;
use crate::ssh::params::ConnectParams;
use russh::ChannelMsg;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

/// Control messages to a running shell task.
pub enum ShellCmd {
    Data(Vec<u8>),
    Resize { cols: u32, rows: u32 },
    Close,
}

/// Spawn a shell session: connect, open PTY+shell, and pump I/O until close/EOF.
/// Returns a sender for input/resize/close. Emits `ssh-data-{id}` / `ssh-exit-{id}`.
pub async fn spawn(
    session_id: String,
    params: ConnectParams,
    cols: u32,
    rows: u32,
    app: AppHandle,
) -> Result<mpsc::Sender<ShellCmd>, String> {
    let mut session = connect::establish(&params).await?;
    let mut channel = session
        .channel_open_session()
        .await
        .map_err(|e| format!("Channel open failed: {}", e))?;
    channel
        .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
        .await
        .map_err(|e| format!("PTY request failed: {}", e))?;
    channel
        .request_shell(true)
        .await
        .map_err(|e| format!("Shell request failed: {}", e))?;

    let (tx, mut rx) = mpsc::channel::<ShellCmd>(256);
    let data_ev = format!("ssh-data-{}", session_id);
    let exit_ev = format!("ssh-exit-{}", session_id);

    tokio::spawn(async move {
        let mut decoder = encoding_rs::UTF_8.new_decoder();
        loop {
            tokio::select! {
                cmd = rx.recv() => match cmd {
                    Some(ShellCmd::Data(bytes)) => {
                        if channel.data(&bytes[..]).await.is_err() { break; }
                    }
                    Some(ShellCmd::Resize { cols, rows }) => {
                        let _ = channel.window_change(cols, rows, 0, 0).await;
                    }
                    Some(ShellCmd::Close) | None => break,
                },
                msg = channel.wait() => match msg {
                    Some(ChannelMsg::Data { data }) => emit_decoded(&mut decoder, &data, &app, &data_ev, false),
                    Some(ChannelMsg::ExtendedData { data, .. }) => emit_decoded(&mut decoder, &data, &app, &data_ev, false),
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                    _ => {}
                },
            }
        }
        // Flush any trailing decoder state and surface the disconnect.
        emit_decoded(&mut decoder, &[], &app, &data_ev, true);
        let _ = app.emit(&exit_ev, ());
        let _ = session.disconnect(russh::Disconnect::ByApplication, "", "English").await;
    });

    Ok(tx)
}

/// Decode bytes through a streaming UTF-8 decoder and emit a batched event.
fn emit_decoded(decoder: &mut encoding_rs::Decoder, bytes: &[u8], app: &AppHandle, ev: &str, last: bool) {
    if bytes.is_empty() && !last {
        return;
    }
    let mut out = String::with_capacity(bytes.len() + 16);
    let _ = decoder.decode_to_string(bytes, &mut out, last);
    if !out.is_empty() {
        let _ = app.emit(ev, out);
    }
}
```

- [ ] **Step 2: SshManager (shell methods)**

Replace `src-tauri/src/ssh/mod.rs` with the manager plus existing module decls:

```rust
//! Async SSH backend on russh.
#![allow(dead_code)] // until cutover (Task 12)

mod auth;
mod connect;
mod handler;
mod known_hosts;
mod params;
mod session;
mod transport;

pub use known_hosts::trust_host;
pub use params::ConnectParams;

use session::ShellCmd;
use std::collections::HashMap;
use tauri::AppHandle;
use tokio::sync::{mpsc, Mutex};

#[derive(Default)]
pub struct SshManager {
    shells: Mutex<HashMap<String, mpsc::Sender<ShellCmd>>>,
}

impl SshManager {
    pub fn new() -> Self {
        Self::default()
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn connect(
        &self,
        session_id: &str,
        params: ConnectParams,
        rows: u32,
        cols: u32,
        app: AppHandle,
    ) -> Result<(), String> {
        let tx = session::spawn(session_id.to_string(), params, cols, rows, app).await?;
        self.shells.lock().await.insert(session_id.to_string(), tx);
        Ok(())
    }

    pub async fn write_to_ssh(&self, session_id: &str, data: &[u8]) -> Result<(), String> {
        let tx = self.shells.lock().await.get(session_id).cloned();
        match tx {
            Some(tx) => tx.send(ShellCmd::Data(data.to_vec())).await.map_err(|_| "Session closed".into()),
            None => Err("Session not found".into()),
        }
    }

    pub async fn resize_ssh(&self, session_id: &str, cols: u32, rows: u32) -> Result<(), String> {
        let tx = self.shells.lock().await.get(session_id).cloned();
        match tx {
            Some(tx) => tx.send(ShellCmd::Resize { cols, rows }).await.map_err(|_| "Session closed".into()),
            None => Err("Session not found".into()),
        }
    }

    pub async fn close_ssh(&self, session_id: &str) {
        if let Some(tx) = self.shells.lock().await.remove(session_id) {
            let _ = tx.send(ShellCmd::Close).await;
        }
    }

    pub async fn close_all(&self) {
        let txs: Vec<_> = self.shells.lock().await.drain().map(|(_, v)| v).collect();
        for tx in txs {
            let _ = tx.send(ShellCmd::Close).await;
        }
    }
}
```

- [ ] **Step 3: Build**

Run: `cd src-tauri && cargo build`
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/ssh/session.rs src-tauri/src/ssh/mod.rs
git commit -m "feat(ssh): shell session task + async SshManager (shell path)"
```

---

## Task 9: exec / metrics

**Files:**
- Create: `src-tauri/src/ssh/exec.rs`
- Modify: `src-tauri/src/ssh/mod.rs` (store the connect params per session; add exec methods)

- [ ] **Step 1: Persist params and add a connection for exec**

Because exec/metrics open their own channel, the simplest correct design is: keep one extra russh `Handle` per session dedicated to exec/metrics/sftp (opened lazily), OR reuse the shell session's `Handle` via a shared clone. russh `Handle` is `Clone`, so store a clone of the shell `Handle` in the manager when connecting and reuse it for exec/sftp channels.

Update `session::spawn` to also return the `Handle` (clone before moving into the task) and store it. Modify `spawn`'s signature to `Result<(mpsc::Sender<ShellCmd>, Handle<Client>), String>` and return `(tx, session.clone())` before `tokio::spawn`. (Reconcile: `Handle` is `Clone` in russh.)

In `ssh/mod.rs`, change the registry to hold both:

```rust
struct SessionHandle {
    shell: mpsc::Sender<ShellCmd>,
    conn: russh::client::Handle<crate::ssh::handler::Client>,
}
#[derive(Default)]
pub struct SshManager {
    sessions: Mutex<HashMap<String, SessionHandle>>,
}
```

Adjust `connect`/`write_to_ssh`/`resize_ssh`/`close_ssh`/`close_all` to use `.shell`.

- [ ] **Step 2: exec.rs**

Create `src-tauri/src/ssh/exec.rs`:

```rust
use crate::ssh::handler::Client;
use russh::client::Handle;
use russh::ChannelMsg;

/// Run a command on a fresh channel of an existing connection; return stdout.
pub async fn exec(conn: &Handle<Client>, command: &str) -> Result<String, String> {
    let mut channel = conn.channel_open_session().await.map_err(|e| format!("Exec channel failed: {}", e))?;
    channel.exec(true, command).await.map_err(|e| format!("Exec failed: {}", e))?;
    let mut out = Vec::new();
    while let Some(msg) = channel.wait().await {
        match msg {
            ChannelMsg::Data { data } => out.extend_from_slice(&data),
            ChannelMsg::ExtendedData { .. } => {}
            ChannelMsg::Eof | ChannelMsg::Close => break,
            _ => {}
        }
    }
    Ok(String::from_utf8_lossy(&out).trim().to_string())
}
```

Add `mod exec;` to `ssh/mod.rs` and the manager methods:

```rust
pub async fn ssh_exec(&self, session_id: &str, command: &str) -> Result<String, String> {
    let conn = self.sessions.lock().await.get(session_id).map(|s| s.conn.clone());
    match conn {
        Some(conn) => exec::exec(&conn, command).await,
        None => Err("Session not found".into()),
    }
}

pub async fn metrics_exec(&self, session_id: &str, command: &str) -> Result<String, String> {
    self.ssh_exec(session_id, command).await
}
```

- [ ] **Step 3: Build**

Run: `cd src-tauri && cargo build`
Expected: OK. Reconcile `exec(want_reply, cmd)` arg order and `channel.exec` signature.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/ssh/exec.rs src-tauri/src/ssh/session.rs src-tauri/src/ssh/mod.rs
git commit -m "feat(ssh): exec/metrics over shared connection"
```

---

## Task 10: SFTP

**Files:**
- Create: `src-tauri/src/ssh/sftp.rs`
- Modify: `src-tauri/src/ssh/mod.rs` (SFTP methods + `SftpEntry`)

- [ ] **Step 1: SFTP session helper + entry type**

Create `src-tauri/src/ssh/sftp.rs`. Reconcile `russh_sftp::client::SftpSession` + `protocol` types against `cargo doc -p russh-sftp`:

```rust
use crate::ssh::handler::Client;
use russh::client::Handle;
use russh_sftp::client::SftpSession;
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize, Clone)]
pub struct SftpEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<u64>,
    pub permissions: Option<u32>,
}

async fn open_sftp(conn: &Handle<Client>) -> Result<SftpSession, String> {
    let channel = conn.channel_open_session().await.map_err(|e| format!("SFTP channel failed: {}", e))?;
    channel.request_subsystem(true, "sftp").await.map_err(|e| format!("SFTP subsystem failed: {}", e))?;
    SftpSession::new(channel.into_stream()).await.map_err(|e| format!("SFTP init failed: {}", e))
}

pub async fn list_dir(conn: &Handle<Client>, path: &str) -> Result<Vec<SftpEntry>, String> {
    let sftp = open_sftp(conn).await?;
    let mut out = Vec::new();
    let dir = sftp.read_dir(path).await.map_err(|e| format!("SFTP readdir failed: {}", e))?;
    for entry in dir {
        let meta = entry.metadata();
        let name = entry.file_name();
        let full = format!("{}/{}", path.trim_end_matches('/'), name);
        out.push(SftpEntry {
            name,
            path: full,
            is_dir: meta.is_dir(),
            size: meta.size.unwrap_or(0),
            modified: meta.mtime.map(|t| t as u64),
            permissions: meta.permissions.map(|p| p as u32),
        });
    }
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

pub async fn realpath(conn: &Handle<Client>, path: &str) -> Result<String, String> {
    let sftp = open_sftp(conn).await?;
    sftp.canonicalize(path).await.map_err(|e| format!("SFTP realpath failed: {}", e))
}

pub async fn mkdir(conn: &Handle<Client>, path: &str) -> Result<(), String> {
    let sftp = open_sftp(conn).await?;
    sftp.create_dir(path).await.map_err(|e| format!("SFTP mkdir failed: {}", e))
}

pub async fn rmdir(conn: &Handle<Client>, path: &str) -> Result<(), String> {
    let sftp = open_sftp(conn).await?;
    sftp.remove_dir(path).await.map_err(|e| format!("SFTP rmdir failed: {}", e))
}

pub async fn delete_file(conn: &Handle<Client>, path: &str) -> Result<(), String> {
    let sftp = open_sftp(conn).await?;
    sftp.remove_file(path).await.map_err(|e| format!("SFTP delete failed: {}", e))
}

pub async fn rename(conn: &Handle<Client>, old: &str, new: &str) -> Result<(), String> {
    let sftp = open_sftp(conn).await?;
    sftp.rename(old, new).await.map_err(|e| format!("SFTP rename failed: {}", e))
}

pub async fn read_text(conn: &Handle<Client>, path: &str) -> Result<String, String> {
    use tokio::io::AsyncReadExt;
    let sftp = open_sftp(conn).await?;
    let mut f = sftp.open(path).await.map_err(|e| format!("SFTP open failed: {}", e))?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).await.map_err(|e| format!("SFTP read failed: {}", e))?;
    String::from_utf8(buf).map_err(|_| "File is not valid UTF-8 text".into())
}

pub async fn write_text(conn: &Handle<Client>, path: &str, content: &str) -> Result<(), String> {
    use russh_sftp::protocol::OpenFlags;
    use tokio::io::AsyncWriteExt;
    let sftp = open_sftp(conn).await?;
    let mut f = sftp
        .open_with_flags(path, OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE)
        .await
        .map_err(|e| format!("SFTP create failed: {}", e))?;
    f.write_all(content.as_bytes()).await.map_err(|e| format!("SFTP write failed: {}", e))?;
    f.flush().await.map_err(|e| format!("SFTP flush failed: {}", e))?;
    Ok(())
}

pub async fn download(conn: &Handle<Client>, remote: &str, local: &str) -> Result<(), String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let sftp = open_sftp(conn).await?;
    let mut rf = sftp.open(remote).await.map_err(|e| format!("SFTP open failed: {}", e))?;
    let mut lf = tokio::fs::File::create(local).await.map_err(|e| format!("Local create failed: {}", e))?;
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = rf.read(&mut buf).await.map_err(|e| format!("SFTP read failed: {}", e))?;
        if n == 0 { break; }
        lf.write_all(&buf[..n]).await.map_err(|e| format!("Local write failed: {}", e))?;
    }
    lf.flush().await.map_err(|e| format!("Local flush failed: {}", e))?;
    Ok(())
}

pub async fn upload(conn: &Handle<Client>, remote: &str, local: &str) -> Result<(), String> {
    use russh_sftp::protocol::OpenFlags;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let sftp = open_sftp(conn).await?;
    let mut lf = tokio::fs::File::open(local).await.map_err(|e| format!("Local read failed: {}", e))?;
    let mut rf = sftp
        .open_with_flags(remote, OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE)
        .await
        .map_err(|e| format!("SFTP create failed: {}", e))?;
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = lf.read(&mut buf).await.map_err(|e| format!("Local read failed: {}", e))?;
        if n == 0 { break; }
        rf.write_all(&buf[..n]).await.map_err(|e| format!("SFTP write failed: {}", e))?;
    }
    rf.flush().await.map_err(|e| format!("SFTP flush failed: {}", e))?;
    let _ = Path::new(remote);
    Ok(())
}

pub async fn chmod(conn: &Handle<Client>, path: &str, mode: u32) -> Result<(), String> {
    // Reconcile setstat/set_metadata API; russh-sftp exposes set_metadata(path, Metadata).
    let sftp = open_sftp(conn).await?;
    let mut meta = sftp.metadata(path).await.map_err(|e| format!("SFTP stat failed: {}", e))?;
    meta.permissions = Some(mode);
    sftp.set_metadata(path, meta).await.map_err(|e| format!("SFTP chmod failed: {}", e))
}

pub async fn create_file(conn: &Handle<Client>, path: &str) -> Result<(), String> {
    use russh_sftp::protocol::OpenFlags;
    let sftp = open_sftp(conn).await?;
    let _ = sftp
        .open_with_flags(path, OpenFlags::CREATE | OpenFlags::WRITE)
        .await
        .map_err(|e| format!("SFTP create file failed: {}", e))?;
    Ok(())
}
```

Add `mod sftp;` to `ssh/mod.rs`, re-export `pub use sftp::SftpEntry;`, and add one manager method per op that clones the connection and calls the helper, e.g.:

```rust
pub async fn sftp_list_dir(&self, session_id: &str, path: &str) -> Result<Vec<sftp::SftpEntry>, String> {
    let conn = self.sessions.lock().await.get(session_id).map(|s| s.conn.clone());
    match conn { Some(c) => sftp::list_dir(&c, path).await, None => Err("Session not found".into()) }
}
```

Repeat for `sftp_realpath`, `sftp_mkdir`, `sftp_rmdir`, `sftp_delete_file`, `sftp_rename`, `sftp_read_text`, `sftp_write_text`, `sftp_download`, `sftp_upload`, `sftp_chmod`, `sftp_create_file` (each ~4 lines, same shape — repeated deliberately, not abbreviated).

- [ ] **Step 2: Build**

Run: `cd src-tauri && cargo build`
Expected: OK. Reconcile `read_dir`/`metadata`/`set_metadata`/`OpenFlags` names against `cargo doc -p russh-sftp`.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/ssh/sftp.rs src-tauri/src/ssh/mod.rs
git commit -m "feat(ssh): SFTP over russh-sftp on shared connection"
```

---

## Task 11: Local port forward

**Files:**
- Create: `src-tauri/src/ssh/forward.rs`
- Modify: `src-tauri/src/ssh/mod.rs` (forward methods + registry)

- [ ] **Step 1: Forward implementation**

Create `src-tauri/src/ssh/forward.rs`:

```rust
use crate::ssh::handler::Client;
use russh::client::Handle;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Notify;

/// Bind 127.0.0.1:local_port and forward each accepted connection to
/// remote_host:remote_port through `conn` via direct-tcpip. Returns the bound port.
pub async fn start_local(
    conn: Handle<Client>,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
    stop: Arc<Notify>,
) -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", local_port))
        .await
        .map_err(|e| format!("Tunnel bind failed: {}", e))?;
    let actual = listener.local_addr().map_err(|e| e.to_string())?.port();

    tokio::spawn(async move {
        loop {
            let accept = tokio::select! {
                _ = stop.notified() => break,
                a = listener.accept() => a,
            };
            let Ok((mut socket, _)) = accept else { break };
            let conn = conn.clone();
            let rhost = remote_host.clone();
            tokio::spawn(async move {
                let Ok(channel) = conn
                    .channel_open_direct_tcpip(rhost, remote_port as u32, "127.0.0.1".to_string(), 0)
                    .await
                else { return; };
                let mut stream = channel.into_stream();
                let mut buf_a = vec![0u8; 8192];
                let mut buf_b = vec![0u8; 8192];
                loop {
                    tokio::select! {
                        r = socket.read(&mut buf_a) => match r {
                            Ok(0) | Err(_) => break,
                            Ok(n) => { if stream.write_all(&buf_a[..n]).await.is_err() { break; } }
                        },
                        r = stream.read(&mut buf_b) => match r {
                            Ok(0) | Err(_) => break,
                            Ok(n) => { if socket.write_all(&buf_b[..n]).await.is_err() { break; } }
                        },
                    }
                }
            });
        }
    });

    Ok(actual)
}
```

Add to the registry a `Option<Arc<Notify>>` per session for the active forward; add manager methods:

```rust
pub async fn start_local_forward(
    &self,
    session_id: &str,
    local_port: u16,
    remote_host: &str,
    remote_port: u16,
) -> Result<u16, String> {
    let conn = self.sessions.lock().await.get(session_id).map(|s| s.conn.clone())
        .ok_or("Session not found")?;
    self.close_local_forward(session_id).await;
    let stop = std::sync::Arc::new(tokio::sync::Notify::new());
    let port = forward::start_local(conn, local_port, remote_host.to_string(), remote_port, stop.clone()).await?;
    self.forwards.lock().await.insert(session_id.to_string(), stop);
    Ok(port)
}

pub async fn close_local_forward(&self, session_id: &str) {
    if let Some(stop) = self.forwards.lock().await.remove(session_id) {
        stop.notify_waiters();
    }
}
```

Add `forwards: Mutex<HashMap<String, Arc<Notify>>>` to `SshManager` and `mod forward;`. Have `close_ssh`/`close_all` also clear forwards.

- [ ] **Step 2: Build**

Run: `cd src-tauri && cargo build`
Expected: OK.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/ssh/forward.rs src-tauri/src/ssh/mod.rs
git commit -m "feat(ssh): local port forwarding over russh"
```

---

## Task 12: Cutover — wire commands, delete ssh2

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/metrics.rs`
- Delete: `src-tauri/src/ssh.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/ssh/mod.rs` (remove `#![allow(dead_code)]`)

- [ ] **Step 1: Promote the module**

Delete the old file and rename the module: in `lib.rs` replace the two module lines from Task 1 with:

```rust
mod ssh;
```

Rename `src-tauri/src/ssh/mod.rs`'s effect by ensuring `lib.rs` no longer uses `#[path]`/`ssh_next`. Remove `#![allow(dead_code)]` from `ssh/mod.rs`.

```bash
git rm src-tauri/src/ssh.rs
```

- [ ] **Step 2: Rewire AppState + commands**

In `lib.rs`, `AppState.ssh_manager` type is unchanged (`SshManager`), but construction is `SshManager::new()`. Update each `#[tauri::command]` to `await` the now-async methods and pass the `ConnectParams` + `AppHandle`. Example for `ssh_connect` (build `ConnectParams` from the command args exactly as the old `connect` did, then):

```rust
state.ssh_manager
    .connect(&session_id, params, rows, cols, app_handle)
    .await
```

Update `write_to_ssh`, `resize_ssh`, `close_ssh`, `ssh_exec`, `start_tunnel`, and all `sftp_*` commands to `.await` the manager (they are already `async fn`). `ssh_trust_host` calls `ssh::trust_host(...)` (now re-exported from the module).

- [ ] **Step 3: metrics.rs**

In `src-tauri/src/metrics.rs`, replace each `tokio::task::spawn_blocking(move || ssh.metrics_exec(&sid, probe))` with a direct `ssh.metrics_exec(&sid, probe).await` inside the existing async context (the polling task is already async). Reconcile the surrounding `.await`/`?` flow.

- [ ] **Step 4: Remove ssh2**

In `Cargo.toml` delete the `ssh2 = "0.9"` line.

- [ ] **Step 5: Build + smoke**

Run: `cd src-tauri && cargo build && cd .. && npm run smoke:check`
Expected: build OK with no `ssh2` references; smoke PASS. Fix any remaining references to old `SshManager` method signatures.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(ssh): cut over to russh backend, remove ssh2"
```

---

## Task 13: Live verification matrix

**Files:** none (manual verification)

- [ ] **Step 1: Launch with diagnostics**

Run: `GWSHELL_SSH_DEBUG=1 npm run tauri dev` (if you keep a heartbeat in the new `session.rs`; optional — the russh path should not need it).

- [ ] **Step 2: Run the matrix and check each**

- [ ] Rapid Enter + rapid typing for 30s → **stays responsive** (the original freeze). This is the primary success criterion.
- [ ] Large output burst (`cat` a big file; `top`) → smooth, no UI stall.
- [ ] Idle >2s, then type → no spurious disconnect.
- [ ] First-connect host-key prompt appears (unknown), Accept persists to `known_hosts.json`, reconnect is silent.
- [ ] Changed host key → mismatch warning shown (not auto-trusted).
- [ ] Auth: password, publickey, agent, keyboard-interactive (+TOTP) each connect.
- [ ] Jump host connect works.
- [ ] SOCKS5 and HTTP proxy connect.
- [ ] Local tunnel (`start_tunnel`) forwards traffic.
- [ ] SFTP: list, mkdir, rename, delete, upload, download, edit+save, chmod.
- [ ] Server metrics panel populates (metrics_exec).
- [ ] Kill the server / network → terminal shows "session ended / press any key to reconnect" (clean exit, **no silent freeze**), and reconnect works.

- [ ] **Step 3: Final commit (if any fixups)**

```bash
git add -A
git commit -m "fix(ssh): live-verification fixups for russh backend"
```

---

## Self-review notes

- **Spec coverage:** transport/auth/host-key/shell/resize/SFTP/exec/metrics/forward/keepalive/idle all have tasks (2–11); IPC contract preserved at cutover (12); deleted-aux-machinery is satisfied by design (single connection, Tasks 8–11); out-of-scope items (X11, remote/dynamic forward, ssh-config, agent forwarding) are not added.
- **Reconciliation:** russh/russh-sftp signatures are the one source of churn; every russh-touching task says to verify against `cargo doc` for the pinned version. This is intentional, not a placeholder.
- **Type consistency:** `Handle<Client>` is threaded through connect/session/exec/sftp/forward; `SshManager` registry holds `SessionHandle { shell, conn }`; `ConnectParams`/`SftpEntry` names match across tasks.
