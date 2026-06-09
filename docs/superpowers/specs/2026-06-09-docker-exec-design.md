# Docker Exec — Design

Date: 2026-06-09
Status: Approved (design), pending spec review

## Goal

Make the `docker` session type actually connect. Today GWShell can save a Docker
session (via `DockerModal`) but activating its tab does nothing — `TerminalView`
has no `docker` connection branch and there is no backend command. Implement an
MVP: on connect, list the host's **running** containers, let the user pick one,
then open an interactive shell inside it via `docker exec`, wired to the terminal
like any other interactive session.

## Current state

- `src/components/Modals/DockerModal.tsx` saves a `SessionConfig` with
  `session_type: 'docker'` and fields: `docker_protocol` (unix/tcp/http/https),
  `docker_unix_path`, `docker_connect_method` ('SSH' | 'Local'),
  `docker_ssh_tunnel` (id of an SSH session), plus name/color/environment/remark.
  The modal has a "开发中" badge and disabled Test/Auto-Config buttons; the Proxy
  tab is a placeholder.
- `src/components/Terminal/TerminalView.tsx` `setupConnection` handles only
  `localshell`, `ssh`, `serial` — there is **no `docker` branch**, so a docker
  tab opens and immediately shows disconnected. `isInteractiveTerminal()` DOES
  include `docker`, so completion/history/broadcast/resize are already enabled
  for it once data flows.
- No backend `docker_*` command exists. `src-tauri/src/pty.rs` spawns local
  shells via `portable_pty` (`CommandBuilder`, can run an arbitrary command).
  `src-tauri/src/ssh.rs` runs interactive SSH sessions (russh) with a PTY channel
  and emits `ssh-data-{id}` events; PTY emits `pty-data-{id}`.

## Decisions (from clarification)

- **Mechanism:** run the `docker` CLI over the existing PTY (Local) / SSH
  transports. NOT the Docker Engine API / direct socket. Requires `docker` to be
  on PATH on the target (local machine for Local; remote host for SSH).
- **Container selection:** on connect, list running containers and show a picker;
  the user chooses one to exec into.
- **Scope (v1, "精简 MVP"):** list running containers + exec into one. Both
  transports (Local and SSH). No container management (start/stop/logs).
- **In-container shell:** `sh -c 'exec bash 2>/dev/null || exec sh'` — uses bash
  when present, falls back to sh, in one command with no probe round-trip.

## Architecture (Approach A — docker CLI over existing transports)

### Backend — new module `src-tauri/src/docker.rs`

Two Tauri commands, registered in `lib.rs`:

**`docker_list_containers(args) -> Vec<DockerContainer>`**
- `DockerContainer { id: String, name: String, image: String, status: String }`.
- Runs, non-interactively, capturing stdout:
  `docker ps --no-trunc --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}'`
- **Local** (`docker_connect_method == 'Local'`): `std::process::Command::new("docker")`
  with those args; capture stdout/stderr; non-zero exit → return the stderr as an
  error string the frontend can show.
- **SSH** (`docker_connect_method == 'SSH'`): open an SSH connection using the
  connect params of the referenced `docker_ssh_tunnel` session (passed from the
  frontend, same shape `ssh_connect` already receives), run the `docker ps`
  command as a non-interactive remote exec, capture stdout, close the connection.
- Parse stdout into `Vec<DockerContainer>` with a pure helper
  `parse_docker_ps(out: &str) -> Vec<DockerContainer>` (Rust unit-tested).

**`docker_exec(args)`**
- Opens an INTERACTIVE session running, on the chosen transport:
  `docker exec -it <containerId> sh -c 'exec bash 2>/dev/null || exec sh'`
- **Local**: spawn it in a PTY via the existing `pty.rs` machinery (extend the
  shell-spawn path to accept a full argv/command, or add a docker-specific spawn
  that reuses the same reader thread + `pty-data-{sessionId}` emit + resize).
- **SSH**: open an SSH PTY channel via `ssh.rs` running that command instead of
  the login shell; reuse the existing `ssh-data-{sessionId}` emit + resize +
  `ssh-exit` plumbing.
- The session id is the docker TAB's session id, so the existing
  `pty-data-{id}` / `ssh-data-{id}` listeners in `TerminalView` receive output
  with no new event channel.

`docker_protocol` / `docker_unix_path` are NOT used in v1 (Engine-API concepts).
They remain on the struct for forward-compat.

### Frontend

**`TerminalView.setupConnection` — add a `docker` branch:**
1. Determine transport from `session.docker_connect_method`. For SSH, resolve
   `session.docker_ssh_tunnel` → the referenced SSH `SessionConfig` from the
   store; if missing/invalid, show an error in the terminal and stop.
2. `invoke('docker_list_containers', …)`.
   - error → write the error text to the terminal (e.g. "docker not found" /
     stderr), mark disconnected.
   - 0 running containers → write a "no running containers" message, disconnected.
   - ≥1 → open the container picker (below). Do NOT mark connected yet.
3. On pick → `invoke('docker_exec', { …, containerId })`, then attach the data
   listener for the transport's event (`pty-data-{id}` for Local, `ssh-data-{id}`
   for SSH) exactly like the existing branches, mark connected, and let the
   normal interactive path (resize, completion, broadcast) take over.
4. Picker cancelled → close the docker tab (it has no live session yet).

**New component `src/components/Terminal/DockerContainerPicker.tsx`:**
- A small modal listing `DockerContainer[]` (name, image, truncated status),
  keyboard navigable (↑/↓/Enter, Esc to cancel), styled with the existing modal
  CSS. Props: `containers`, `onPick(id)`, `onCancel`.
- Rendered at the App root, driven by a store field (e.g.
  `dockerPicker: { tabId, containers } | null` in `appStore`), consistent with
  how the app's other modals are rendered. `TerminalView`'s docker branch sets
  this field after a successful list, and reads back the chosen id via the
  picker's callbacks.

### Data flow

connect → resolve transport → `docker_list_containers` → picker → `docker_exec`
→ backend spawns `docker exec` over PTY/SSH → `pty-data-{id}`/`ssh-data-{id}` →
existing `TerminalView` listeners write to xterm. Resize → existing
`resize_pty`/`resize_ssh`. Exit → existing `pty-exit`/`ssh-exit` → reconnect arm.

### Error handling

- `docker` missing / not on PATH → stderr surfaced ("docker: command not found").
- SSH transport: referenced tunnel session missing → clear message; SSH connect
  failure → surfaced like a normal SSH connect error.
- No running containers → friendly message in the terminal with a hint.
- `docker exec` failure (container died between list and exec) → surfaced; user
  can reconnect.

## Non-goals (v1)

- Container lifecycle management (start/stop/restart/logs/inspect).
- Docker Engine API / direct unix-socket or tcp/https daemon connection (the
  modal lacks a host:port field for tcp anyway).
- Stopped containers (exec requires a running container).
- Multiple-container multiplexing in one tab.

## Files

- **New:** `src-tauri/src/docker.rs` (`docker_list_containers`, `docker_exec`,
  `parse_docker_ps`, `DockerContainer`) + its Rust unit test for parsing.
- **New:** `src/components/Terminal/DockerContainerPicker.tsx`.
- **Modify:** `src-tauri/src/lib.rs` — register the two commands; `mod docker;`.
- **Modify:** `src-tauri/src/pty.rs` and/or `ssh.rs` — allow spawning an explicit
  command (reuse readers/emit/resize) for the exec session.
- **Modify:** `src/components/Terminal/TerminalView.tsx` — `docker` connect
  branch + picker wiring.
- Possibly **Modify:** `src/stores/appStore.ts` — a flag/state to drive the
  picker for the connecting docker tab (if not handled locally in TerminalView).
- **Modify:** `DockerModal.tsx` — remove the "开发中" badge and enable the modal
  for real use (optional polish; the Test/Auto-Config buttons stay out of scope).
- i18n: picker labels, error strings, "no running containers".

## Testing

- No automated GUI/integration harness. `parse_docker_ps` gets a Rust
  `#[cfg(test)]` unit test (tab-delimited parsing, blank lines, missing fields).
- `cargo check` for the backend; `npm run build` + `npm run smoke:check` for the
  frontend.
- Manual: a Local docker session (Docker Desktop running) and an SSH docker
  session (remote host with docker) — verify listing, picker, exec into bash and
  into an sh-only (alpine) container, resize, and the no-containers / docker-not-
  found error paths.
