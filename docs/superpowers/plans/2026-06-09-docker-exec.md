# Docker Exec Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `docker` sessions connect: on activate, list running containers over a Local or SSH `docker` CLI transport, show a picker, and open an interactive shell in the chosen container via `docker exec`, reusing the existing terminal event plumbing.

**Architecture:** A new `src-tauri/src/docker.rs` exposes `docker_list_containers` (runs `docker ps`, parses output) and `docker_exec` (spawns `docker exec -it <id> sh -c 'exec bash 2>/dev/null || exec sh'`). Local transport reuses `portable_pty` (a refactored shared spawn helper in `pty.rs`); SSH transport reuses the russh connection machinery (a transient one-shot exec for listing, and a `session::spawn`-style interactive channel that runs `exec` instead of `request_shell`). The frontend adds a `docker` branch in `TerminalView.setupConnection` that lists → shows `DockerContainerPicker` (App-root modal driven by `appStore`) → execs, routing data over `pty-data-*` (Local) or `ssh-data-*` (SSH).

**Tech Stack:** Rust (Tauri, portable_pty, russh, serde), React + TypeScript, xterm.js, Zustand, i18next.

**Spec:** `docs/superpowers/specs/2026-06-09-docker-exec-design.md`
**Branch:** `feat/docker-exec` (already created).

---

## Conventions / facts (verified against current code)

- Local PTY events: `pty-data-{sessionId}` (String), `pty-exit-{sessionId}` (()). Commands: `write_to_pty`, `resize_pty` (`rows,cols`), `close_pty`.
- SSH events: `ssh-data-{sessionId}` (String), `ssh-exit-{sessionId}` (()). Commands: `write_to_ssh`, `resize_ssh` (`cols,rows`), `close_ssh`. `ssh_exec(sessionId, command) -> String` runs a one-shot command on an already-open SSH connection.
- `PtyManager` (pty.rs): `sessions: Mutex<HashMap<String, PtyHandle>>`. `create_shell` builds a `CommandBuilder` via `resolve_shell()` then `pair.slave.spawn_command(cmd)` and starts a reader thread that emits `pty-data-{sid}`.
- `SshManager` (ssh/mod.rs): `sessions: Mutex<HashMap<String, SessionHandle>>`; `SessionHandle { shell: mpsc::Sender<ShellCmd>, conn: Arc<Handle<Client>>, forwarded }`. `session::spawn` (ssh/session.rs) does `channel_open_session` → `request_pty` → `request_shell(true)` and a reader task emitting `ssh-data`. `connect::establish(&params) -> (Handle<Client>, ForwardTargets)`. `exec::exec(&conn, cmd) -> String` opens a fresh channel and runs `channel.exec(true, cmd)`.
- `ConnectParams` struct: `src-tauri/src/ssh/params.rs`. Built inside `ssh_connect` (lib.rs:173-231) from individual args.
- Backend in-memory sessions: `state.sessions.lock()` holds all `SessionConfig`s (incl. credentials) loaded from SQLite. The docker session's `docker_ssh_tunnel` holds the **session_id** of the SSH session to use.
- Frontend `TerminalView.setupConnection` selects `eventPrefix`/`writeCmd`/`resizeCmd` by `tab.type` (TerminalView.tsx:949-965); registers `${eventPrefix}-data-${tab.sessionId}` and `${eventPrefix}-exit-...` listeners; cleanup stored in `tabListenerCleanups`. Close command chosen at TerminalView.tsx:1702.
- `TabInfo.type` already includes `'docker'`; `isInteractiveTerminal('docker') === true`.
- `SessionConfig` docker fields (types/index.ts:47-50): `docker_protocol`, `docker_unix_path`, `docker_connect_method` (string, values 'SSH'|'Local'), `docker_ssh_tunnel` (session_id string).

---

## File Structure

- **Create** `src-tauri/src/docker.rs` — `DockerContainer`, `parse_docker_ps`, `docker_list_containers`, `docker_exec`, `connect_params_from_session` helper. One responsibility: docker transport + commands.
- **Modify** `src-tauri/src/pty.rs` — extract a shared `spawn_in_pty(...)` used by `create_shell`; add `create_docker_exec(...)`.
- **Modify** `src-tauri/src/ssh/mod.rs` (+ a new `ssh/docker_session.rs` or an added fn in `session.rs`) — add `connect_and_exec_interactive(session_id, params, command, rows, cols, app)` that mirrors `session::spawn` but runs `channel.exec` instead of `request_shell`.
- **Modify** `src-tauri/src/lib.rs` — `mod docker;` + register the two commands.
- **Create** `src/components/Terminal/DockerContainerPicker.tsx`.
- **Modify** `src/stores/appStore.ts` — `dockerPicker` state + setter.
- **Modify** `src/App.tsx` — render the picker.
- **Modify** `src/components/Terminal/TerminalView.tsx` — `docker` connect branch + event routing + close command.
- **Modify** `src/i18n/locales/gwshell.{en,zh}.json` — picker/error strings.
- **Modify** `src/components/Modals/DockerModal.tsx` — drop the "开发中" badge (the type now works).

---

## Task 1: `parse_docker_ps` + `DockerContainer` (pure, TDD)

**Files:**
- Create: `src-tauri/src/docker.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod docker;`)

- [ ] **Step 1: Write the module skeleton + a failing unit test**

Create `src-tauri/src/docker.rs`:

```rust
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DockerContainer {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: String,
}

/// Parse the tab-delimited output of
/// `docker ps --no-trunc --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}'`.
/// Tolerates blank lines and trailing whitespace; rows with fewer than 4 fields
/// are skipped. Extra tabs in a field are not expected from this format.
pub fn parse_docker_ps(out: &str) -> Vec<DockerContainer> {
    out.lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|line| {
            let mut parts = line.splitn(4, '\t');
            let id = parts.next()?.trim().to_string();
            let name = parts.next()?.trim().to_string();
            let image = parts.next()?.trim().to_string();
            let status = parts.next().unwrap_or("").trim().to_string();
            if id.is_empty() {
                return None;
            }
            Some(DockerContainer { id, name, image, status })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_rows_and_skips_blanks() {
        let out = "abc123\tweb\tnginx:latest\tUp 3 hours\n\n\
                   def456\tdb\tpostgres:16\tUp 2 days (healthy)\n";
        let got = parse_docker_ps(out);
        assert_eq!(got.len(), 2);
        assert_eq!(got[0], DockerContainer {
            id: "abc123".into(), name: "web".into(),
            image: "nginx:latest".into(), status: "Up 3 hours".into(),
        });
        assert_eq!(got[1].name, "db");
        assert_eq!(got[1].status, "Up 2 days (healthy)");
    }

    #[test]
    fn skips_malformed_and_empty_id() {
        let out = "onlytwo\tfields\n\t\t\t\nok\tn\ti\ts\n";
        let got = parse_docker_ps(out);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].id, "ok");
    }
}
```

Add to `src-tauri/src/lib.rs` after `mod database;` (lib.rs:2):

```rust
mod docker;
```

- [ ] **Step 2: Run the test to verify it passes (it should — implementation is included)**

Run: `cd src-tauri && cargo test docker::tests`
Expected: 2 tests pass. (This task is structured as "skeleton + test together"; if you prefer strict red-green, comment out the body of `parse_docker_ps` to `Vec::new()`, watch it fail, then restore.)

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/docker.rs src-tauri/src/lib.rs
git commit -m "feat(docker): container model and docker ps parser with tests"
```

---

## Task 2: Local exec spawn — refactor `pty.rs`, add `create_docker_exec`

**Files:**
- Modify: `src-tauri/src/pty.rs`

Goal: spawn `docker exec -it <id> sh -c 'exec bash 2>/dev/null || exec sh'` in a PTY, reusing `create_shell`'s reader/writer/resize/handle machinery.

- [ ] **Step 1: Extract a shared spawn helper**

In `pty.rs`, the body of `create_shell` (≈ lines 466-535) builds a `CommandBuilder` then does: open PTY, `spawn_command`, start reader thread emitting `pty-data-{sid}`, start writer/resize handling, insert handle into `self.sessions`. Refactor so the part AFTER the `CommandBuilder` is built becomes a private method:

```rust
// New private method on PtyManager. Move the existing post-CommandBuilder logic
// (openpty using rows/cols, spawn_command(cmd), reader thread with the
// `pty-data-{sid}` / `pty-exit-{sid}` emit loop, writer thread, resize channel,
// and `self.sessions.lock().insert(...)`) into here verbatim. `create_shell`
// builds `cmd` (via resolve_shell + env + cwd) then calls this.
fn spawn_in_pty(
    &self,
    session_id: &str,
    app_handle: AppHandle,
    rows: u16,
    cols: u16,
    cmd: portable_pty::CommandBuilder,
    charset: Option<String>,
    integration_temp: Option<tempfile::TempPath>, // keep existing param if present; pass None for docker
) -> Result<(), String> {
    // ... exactly the current code from after `let (mut cmd, integration_temp) = ...`
    //     down through inserting the handle, but using the `cmd` passed in ...
}
```

Update `create_shell` to build `cmd`/env/cwd as today, then `return self.spawn_in_pty(session_id, app_handle, rows, cols, cmd, charset, integration_temp);`.

(Read the current `create_shell` body and move the lines precisely; do not change behavior. Run `cargo check` after to confirm `create_shell` still compiles and behaves identically.)

- [ ] **Step 2: Add `create_docker_exec`**

```rust
// Public method: spawn `docker exec` in a PTY, keyed by session_id.
pub fn create_docker_exec(
    &self,
    session_id: &str,
    app_handle: AppHandle,
    rows: u16,
    cols: u16,
    container_id: &str,
) -> Result<(), String> {
    let mut cmd = portable_pty::CommandBuilder::new("docker");
    cmd.args([
        "exec", "-it", container_id,
        "sh", "-c", "exec bash 2>/dev/null || exec sh",
    ]);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    self.spawn_in_pty(session_id, app_handle, rows, cols, cmd, None, None)
}
```

- [ ] **Step 3: Verify Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: no errors (pre-existing warnings ok).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/pty.rs
git commit -m "feat(docker): local PTY docker-exec spawn (shared spawn helper)"
```

---

## Task 3: SSH interactive exec — `connect_and_exec_interactive`

**Files:**
- Modify: `src-tauri/src/ssh/session.rs` (add a sibling fn) and `src-tauri/src/ssh/mod.rs` (expose a method)

Goal: establish an SSH connection from `ConnectParams` and run an interactive `exec` command (instead of a login shell), registered under a given session_id so `write_to_ssh`/`resize_ssh`/`close_ssh`/`ssh-data`/`ssh-exit` all work.

- [ ] **Step 1: Add an interactive-exec spawn in `ssh/session.rs`**

`session::spawn` currently does (ssh/session.rs ≈ 32-63): `connect::establish` → `channel_open_session` → `request_pty(...)` → optional agent_forward → `request_shell(true)` → starts the reader task (emitting `ssh-data-{id}`) and a writer/resize task, then registers a `SessionHandle` in the manager.

Add a near-duplicate `pub async fn spawn_exec(...)` with the SAME signature as `spawn` PLUS a `command: String` parameter, identical in every respect EXCEPT replace:

```rust
channel.request_shell(true).await.map_err(|e| format!("Shell request failed: {}", e))?;
```
with:
```rust
channel.exec(true, command.as_bytes()).await.map_err(|e| format!("Exec request failed: {}", e))?;
```

Everything else (PTY request, reader task with `ssh-data-{id}`/`ssh-exit-{id}`, writer/resize task, `SessionHandle` registration keyed by the passed `session_id`) stays the same. Read the full current `spawn` and copy it, making only that one-line change and adding the `command` param. (Reproducing it verbatim here would drift from the real source; mirror the actual function.)

- [ ] **Step 2: Expose a manager method in `ssh/mod.rs`**

Mirror how `SshManager` calls `session::spawn` today. Add:

```rust
pub async fn connect_and_exec_interactive(
    &self,
    session_id: &str,
    params: crate::ssh::params::ConnectParams,
    command: String,
    rows: u32,
    cols: u32,
    app: tauri::AppHandle,
) -> Result<(), String> {
    // same body shape as the existing connect+spawn entry point, but call
    // session::spawn_exec(..., command) instead of session::spawn(...).
    // Register the resulting SessionHandle in self.sessions under session_id.
}
```

(Find the existing function in `ssh/mod.rs` that drives `session::spawn` and clone its structure, substituting `spawn_exec`.)

- [ ] **Step 3: Verify Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/ssh/session.rs src-tauri/src/ssh/mod.rs
git commit -m "feat(docker): SSH interactive exec channel (spawn_exec)"
```

---

## Task 4: `docker.rs` commands + `ConnectParams` from session; register

**Files:**
- Modify: `src-tauri/src/docker.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add a `SessionConfig → ConnectParams` helper in `docker.rs`**

Read `src-tauri/src/ssh/params.rs` (the `ConnectParams` struct + its fields) and the `ConnectParams` construction inside `ssh_connect` (lib.rs:173-231). Write:

```rust
use crate::session::SessionConfig;
use crate::ssh::params::ConnectParams;

/// Build SSH ConnectParams from a saved SSH session (the docker tunnel target),
/// mirroring how `ssh_connect` constructs ConnectParams from its args. Pull
/// host/port/username/auth/key/jump/proxy/timeout fields from `s`.
pub fn connect_params_from_session(s: &SessionConfig) -> ConnectParams {
    // Populate every ConnectParams field from the matching SessionConfig field,
    // using the same defaults ssh_connect uses (port 22, auth_method "password",
    // proxy_port 1080, connection_timeout 30, etc.). Match field names exactly
    // against params.rs.
}
```

(The implementer must read both structs and map field-by-field; this is mechanical but must be exact.)

- [ ] **Step 2: Implement `docker_list_containers`**

```rust
use tauri::State;
use std::sync::Arc;
use crate::AppState;

const PS_FMT: &str = "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}";

#[tauri::command]
pub async fn docker_list_containers(
    connect_method: String,           // "Local" | "SSH"
    tunnel_session_id: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<DockerContainer>, String> {
    if connect_method.eq_ignore_ascii_case("ssh") {
        let tunnel_id = tunnel_session_id
            .ok_or_else(|| "No SSH session selected for this Docker host".to_string())?;
        // Look up the tunnel SSH session config from in-memory sessions.
        let sess = {
            let guard = state.sessions.lock();
            guard.iter().find(|s| s.id == tunnel_id).cloned()
        };
        let sess = sess.ok_or_else(|| "Referenced SSH session not found".to_string())?;
        let params = connect_params_from_session(&sess);
        // Transient one-shot: establish, exec docker ps, drop.
        let (conn, _fwd) = crate::ssh::connect::establish(&params)
            .await
            .map_err(|e| format!("SSH connect failed: {}", e))?;
        let conn = std::sync::Arc::new(conn);
        let out = crate::ssh::exec::exec(&conn, &format!("docker ps --no-trunc --format '{}'", PS_FMT))
            .await
            .map_err(|e| format!("docker ps failed: {}", e))?;
        Ok(parse_docker_ps(&out))
    } else {
        // Local: run the docker CLI as a child process.
        let output = tokio::task::spawn_blocking(|| {
            std::process::Command::new("docker")
                .args(["ps", "--no-trunc", "--format", PS_FMT])
                .output()
        })
        .await
        .map_err(|e| format!("task join: {}", e))?
        .map_err(|e| format!("Failed to run docker: {} (is Docker installed and on PATH?)", e))?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        Ok(parse_docker_ps(&String::from_utf8_lossy(&output.stdout)))
    }
}
```

(Verify the exact paths: `state.sessions` lock type — adjust `.lock()` vs `.lock().await` and `s.id`/`s.session_type` field names against `session.rs`. Verify `crate::ssh::connect::establish` and `crate::ssh::exec::exec` visibility — make them `pub(crate)` if needed. `ConnectParams` clone/Arc usage must match `exec::exec`'s expected `&Arc<Handle<Client>>`.)

- [ ] **Step 3: Implement `docker_exec`**

```rust
const EXEC_SHELL: &str = "exec bash 2>/dev/null || exec sh";

#[tauri::command]
pub async fn docker_exec(
    session_id: String,               // the DOCKER tab's session id (event/resize/close key)
    container_id: String,
    rows: u32,
    cols: u32,
    connect_method: String,           // "Local" | "SSH"
    tunnel_session_id: Option<String>,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    if connect_method.eq_ignore_ascii_case("ssh") {
        let tunnel_id = tunnel_session_id
            .ok_or_else(|| "No SSH session selected".to_string())?;
        let sess = {
            let guard = state.sessions.lock();
            guard.iter().find(|s| s.id == tunnel_id).cloned()
        }.ok_or_else(|| "Referenced SSH session not found".to_string())?;
        let params = connect_params_from_session(&sess);
        let cmd = format!("docker exec -it {} sh -c '{}'", container_id, EXEC_SHELL);
        state.ssh_manager
            .connect_and_exec_interactive(&session_id, params, cmd, rows, cols, app_handle)
            .await
    } else {
        let sid = session_id.clone();
        let cid = container_id.clone();
        let st = state.inner().clone();
        // rows/cols are u32 in the command; PtyManager uses u16.
        let (r, c) = (rows as u16, cols as u16);
        tokio::task::spawn_blocking(move || {
            st.pty_manager.create_docker_exec(&sid, app_handle, r, c, &cid)
        })
        .await
        .map_err(|e| format!("task join: {}", e))?
    }
}
```

(Match `AppState` field names: `state.ssh_manager`, `state.pty_manager`, `state.sessions` — verify against lib.rs `AppState` struct. The `container_id` is interpolated into a shell command for the SSH path; container ids from `docker ps` are hex/safe, but to be safe, validate `container_id` is `[A-Za-z0-9_.-]+` before interpolation and reject otherwise.)

- [ ] **Step 4: Add container-id validation helper**

```rust
fn valid_container_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-'))
}
```
Call it at the top of `docker_exec` (return `Err("Invalid container id")` if false) — defense for the SSH string-interpolation path.

- [ ] **Step 5: Register the commands in `lib.rs`**

In the `tauri::generate_handler![...]` macro (lib.rs:982-1042), add before the closing `]`:

```rust
    docker::docker_list_containers,
    docker::docker_exec,
```

- [ ] **Step 6: Verify Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: no errors. Then `cargo test docker::tests` still passes.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/docker.rs src-tauri/src/lib.rs
git commit -m "feat(docker): list/exec commands over Local and SSH transports"
```

---

## Task 5: Frontend — appStore picker state + `DockerContainerPicker`

**Files:**
- Modify: `src/stores/appStore.ts`
- Create: `src/components/Terminal/DockerContainerPicker.tsx`
- Modify: `src/App.tsx`
- Modify: `src/i18n/locales/gwshell.{en,zh}.json`

- [ ] **Step 1: Add `dockerPicker` state to `appStore.ts`**

Mirror the `showDockerModal` pattern (appStore.ts:68-69, 267-269). Add to the interface:

```ts
dockerPicker: { tabId: string; containers: DockerContainer[] } | null;
setDockerPicker: (p: { tabId: string; containers: DockerContainer[] } | null) => void;
```
and to the initializer:
```ts
dockerPicker: null,
setDockerPicker: (p) => set({ dockerPicker: p }),
```
Add the type near the top of `appStore.ts` (or import from a shared location):
```ts
export interface DockerContainer { id: string; name: string; image: string; status: string; }
```

- [ ] **Step 2: Create `DockerContainerPicker.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box } from 'lucide-react';
import type { DockerContainer } from '../../stores/appStore';

interface Props {
  containers: DockerContainer[];
  onPick: (id: string) => void;
  onCancel: () => void;
}

export const DockerContainerPicker: React.FC<Props> = ({ containers, onPick, onCancel }) => {
  const { t } = useTranslation();
  const [sel, setSel] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(i + 1, containers.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); if (containers[sel]) onPick(containers[sel].id); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [containers, sel, onPick, onCancel]);

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="ssh-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="ssh-modal-header"><h2>{t('docker_pick_container')}</h2></div>
        <div className="ssh-modal-body">
          {containers.map((c, i) => (
            <div
              key={c.id}
              className={`docker-pick-row${i === sel ? ' selected' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => onPick(c.id)}
            >
              <Box size={15} className="docker-pick-icon" />
              <span className="docker-pick-name">{c.name}</span>
              <span className="docker-pick-image">{c.image}</span>
              <span className="docker-pick-status">{c.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
```

Add minimal CSS to `src/styles/global.css` for `.docker-pick-row` (flex, gap, padding, `.selected { background: var(--bg-hover); }`), `.docker-pick-name` (color var(--text-primary)), `.docker-pick-image`/`.docker-pick-status` (var(--text-muted), margin-left auto for status). Match the existing modal row styling.

- [ ] **Step 3: Render the picker in `App.tsx`**

Add to the lazy modal imports + the modal render block (App.tsx:227-241). Render it when `dockerPicker` is set:

```tsx
{dockerPicker && (
  <DockerContainerPicker
    containers={dockerPicker.containers}
    onPick={(id) => { window.dispatchEvent(new CustomEvent('gwshell:docker-pick', { detail: { tabId: dockerPicker.tabId, id } })); setDockerPicker(null); }}
    onCancel={() => { window.dispatchEvent(new CustomEvent('gwshell:docker-cancel', { detail: { tabId: dockerPicker.tabId } })); setDockerPicker(null); }}
  />
)}
```
Pull `dockerPicker` and `setDockerPicker` from `useAppStore()` at the top of `App` (add to the destructure at App.tsx:47-54). Import `DockerContainerPicker` (eager import is fine; it is small).

Rationale for the CustomEvent: `TerminalView`'s connect flow (Task 6) awaits the user's pick; a window CustomEvent bridges the App-root picker back to the awaiting connect code without threading callbacks through the store. (Task 6 wires the listeners.)

- [ ] **Step 4: Add i18n keys** (both locales): `docker_pick_container` ("Select a container" / "选择容器"), `docker_no_containers` ("No running containers on this host" / "该主机没有运行中的容器"), `docker_listing` ("Listing containers…" / "正在列出容器…"), `docker_not_found` ("docker command failed — is Docker installed and running?" / "docker 命令失败 —— Docker 是否已安装并运行？"), `docker_connecting_container` ("Connecting to container…" / "正在连接容器…").

- [ ] **Step 5: Verify**

Run: `npm run build` and `npm run smoke:check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/stores/appStore.ts src/components/Terminal/DockerContainerPicker.tsx src/App.tsx src/styles/global.css src/i18n/locales/gwshell.en.json src/i18n/locales/gwshell.zh.json
git commit -m "feat(docker): container picker UI and store state"
```

---

## Task 6: Frontend — `docker` connect branch in `TerminalView`

**Files:**
- Modify: `src/components/Terminal/TerminalView.tsx`

- [ ] **Step 1: Event routing for docker**

In the `eventPrefix`/`writeCmd`/`resizeCmd` selection (TerminalView.tsx:949-965), add a docker case that depends on the connect method. Insert before the final `else`:

```ts
} else if (tab.type === "docker") {
  const dsess = sessionsRef.current.find((s) => s.id === tab.sessionId);
  const isSshDocker = (dsess?.docker_connect_method ?? '').toLowerCase() === 'ssh';
  eventPrefix = isSshDocker ? "ssh" : "pty";
  writeCmd = isSshDocker ? "write_to_ssh" : "write_to_pty";
  resizeCmd = isSshDocker ? "resize_ssh" : "resize_pty";
}
```

- [ ] **Step 2: docker connect branch**

After the `serial` branch and before `connectionReady` finalization (mirror the structure of the `localshell`/`ssh` branches around TerminalView.tsx:1531-1646), add:

```ts
} else if (tab.type === "docker") {
  const method = (session?.docker_connect_method ?? 'Local');
  const tunnelId = session?.docker_ssh_tunnel ?? null;
  instance?.terminal.write(`\r\n\x1b[90m${t('docker_listing')}\x1b[0m\r\n`);
  let containers: { id: string; name: string; image: string; status: string }[];
  try {
    containers = await invoke('docker_list_containers', {
      connectMethod: method,
      tunnelSessionId: tunnelId,
    });
  } catch (err) {
    instance?.terminal.write(`\r\n\x1b[31m${String(err)}\x1b[0m\r\n`);
    useAppStore.getState().updateTabConnected(tab.id, false);
    connectedTabs.delete(tab.id);
    return;
  }
  if (cancelled) return;
  if (containers.length === 0) {
    instance?.terminal.write(`\r\n\x1b[33m${t('docker_no_containers')}\x1b[0m\r\n`);
    useAppStore.getState().updateTabConnected(tab.id, false);
    connectedTabs.delete(tab.id);
    return;
  }
  // Ask the user to pick (App-root picker, bridged via window events).
  const containerId = await new Promise<string | null>((resolve) => {
    const onPick = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.tabId === tab.id) { cleanup(); resolve(d.id as string); }
    };
    const onCancel = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.tabId === tab.id) { cleanup(); resolve(null); }
    };
    const cleanup = () => {
      window.removeEventListener('gwshell:docker-pick', onPick);
      window.removeEventListener('gwshell:docker-cancel', onCancel);
    };
    window.addEventListener('gwshell:docker-pick', onPick);
    window.addEventListener('gwshell:docker-cancel', onCancel);
    useAppStore.getState().setDockerPicker({ tabId: tab.id, containers });
  });
  if (cancelled) return;
  if (!containerId) {
    // Cancelled — close the docker tab (no live session).
    const { destroyTerminal } = await import('./TerminalView');
    destroyTerminal(tab.id);
    useAppStore.getState().removeTab(tab.id);
    return;
  }
  instance?.terminal.write(`\r\n\x1b[90m${t('docker_connecting_container')}\x1b[0m\r\n`);
  await invoke('docker_exec', {
    sessionId: tab.sessionId,
    containerId,
    rows: instance!.terminal.rows,
    cols: instance!.terminal.cols,
    connectMethod: method,
    tunnelSessionId: tunnelId,
  });
  connectionReady = true;
}
```

(Verify the exact local variable names in `setupConnection`: `cancelled`, `connectionReady`, `instance`, `connectedTabs`, `session`, `sessionsRef`. The `data`/`exit` listeners were already registered earlier in the function using `eventPrefix` from Step 1, so docker output flows automatically once `docker_exec` starts emitting on `pty-data-*`/`ssh-data-*`.)

- [ ] **Step 3: Close command for docker**

At the cleanup close-command selection (TerminalView.tsx:1702-1703), make docker pick the right close command:

```ts
const isSshDocker = tab.type === "docker"
  && (sessionsRef.current.find((s) => s.id === tab.sessionId)?.docker_connect_method ?? '').toLowerCase() === 'ssh';
const closeCmd = (tab.type === "ssh" || isSshDocker) ? "close_ssh"
  : tab.type === "serial" ? "close_serial"
  : "close_pty";
```

- [ ] **Step 4: Verify**

Run: `npm run build` and `npm run smoke:check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Terminal/TerminalView.tsx
git commit -m "feat(docker): TerminalView docker connect branch (list, pick, exec)"
```

---

## Task 7: DockerModal polish + final verification

**Files:**
- Modify: `src/components/Modals/DockerModal.tsx`

- [ ] **Step 1: Remove the "开发中" badge**

In `DockerModal.tsx`, remove the `<span className="docker-notice-badge">{t('docker_notice')}</span>` (line ~104) now that docker connects. Leave the disabled Test/Auto-Config buttons and the placeholder Proxy tab as-is (out of scope). Optionally remove the now-unused `docker_notice` i18n key if nothing else references it (grep first).

- [ ] **Step 2: Full verification**

Run: `cd src-tauri && cargo check && cargo test docker::tests`, then `npm run build`, `npm run smoke:check`, `node scripts/test-completion.mjs`.
Expected: all pass.

- [ ] **Step 3: Manual verification (requires Docker)**

Run `npm run tauri dev`. Then:
1. **Local**: ensure Docker Desktop is running with ≥1 container (`docker run -d --name demo nginx`). Create a Docker session with connect method = Local. Open it → picker lists `demo` → pick → you get a shell inside the container (`bash` or `sh`). Type `ls`, `hostname` — confirm it's the container.
2. **sh-only image**: `docker run -d --name alp alpine sleep 1000` → pick `alp` → confirm it falls back to `sh` (no bash) without error.
3. **SSH**: with a remote host that has Docker and an SSH session saved, create a Docker session with method = SSH and that SSH session selected as the tunnel. Open → lists remote containers → pick → shell inside remote container. Resize the window — confirm the container shell reflows.
4. **No containers**: stop all containers → open docker session → "no running containers" message, tab not stuck "connecting".
5. **docker not found**: rename/remove docker from PATH (or use a host without docker) → clear error surfaced.
6. **Cancel**: open the picker, press Esc → the docker tab closes.

- [ ] **Step 4: Commit**

```bash
git add src/components/Modals/DockerModal.tsx
git commit -m "chore(docker): enable DockerModal (drop work-in-progress badge)"
```

---

## Self-Review (plan author)

- **Spec coverage:** list running containers (Task 4 `docker_list_containers`), picker (Task 5), exec bash→sh (Task 2/3/4 via `EXEC_SHELL`), Local transport (Task 2 + Task 4 local branch), SSH transport (Task 3 + Task 4 ssh branch), TerminalView docker branch + event routing + close (Task 6), error/no-container paths (Task 6), Rust parse test (Task 1), DockerModal polish (Task 7). Non-goals (Engine API, mgmt, tcp) excluded. All spec sections map to a task.
- **Placeholders:** the PTY/SSH refactor tasks (2, 3) and `connect_params_from_session` (4.1) instruct the implementer to mirror/field-map against the exact current source rather than reproducing 100+ lines verbatim — this is deliberate (reproducing russh/portable_pty machinery inline would drift from the real code). All genuinely-new logic (parser, commands, picker, store, TerminalView branch) has complete code.
- **Type/name consistency:** `DockerContainer {id,name,image,status}` identical across Rust (Task 1) and TS (Task 5); command names `docker_list_containers`/`docker_exec` and their camelCase args (`connectMethod`, `tunnelSessionId`, `sessionId`, `containerId`, `rows`, `cols`) consistent between Task 4 (Rust params snake_case) and Task 6 (JS camelCase) — Tauri v2 maps them. `EXEC_SHELL`/`PS_FMT` constants used consistently. Event prefixes (`pty`/`ssh`) match the transport in Task 6.
- **Scope:** single feature, one plan. SSH path uses two connections (transient list + persistent exec) — acceptable for MVP; noted.
