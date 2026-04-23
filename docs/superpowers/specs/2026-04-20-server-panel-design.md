# Server Panel — Design Spec

**Date:** 2026-04-20
**Status:** Approved (pending implementation plan)
**Scope:** MVP — Linux remote servers only

## 1. Goal

Add a HexHub-style "服务器面板 / Server Panel" to GWShell: a right-side drawer that shows live host metrics (CPU, memory, network, processes, NICs) for the currently active **SSH** session, refreshing every 2 seconds.

The panel augments — it does not replace — the terminal. It is an opt-in overlay, off by default, zero cost when closed.

## 2. Non-Goals

- Does **not** support local shell, serial, docker, or SFTP session types.
- Does **not** support macOS / BSD / Windows remote hosts in MVP — detected and shown as an explicit "unsupported OS" state.
- Does **not** embed a file browser. Users continue to use the existing SFTP session type.
- Does **not** require any agent installation on the remote host. Read-only `/proc` and standard coreutils (`ps`, `ip`) are sufficient.
- Does **not** persist metric history across panel open/close or app restarts.

## 3. User-Facing Behavior

### 3.1 Entry point
- A new icon button in `TitleBar` (between existing title-bar actions), tooltip "显示服务器面板 / Show server panel".
- Enabled only when the active tab's session type is `ssh`. Otherwise rendered disabled with tooltip "仅 SSH 会话支持 / SSH sessions only".
- Clicking toggles a global `serverPanelOpen` flag in `appStore`.

### 3.2 Panel layout
- Right-side drawer, 380 px wide, slides in over the terminal content area in 200 ms.
- Close `X` in the drawer's top-right corner mirrors the toggle.
- Content is scrollable vertically, laid out as stacked cards:
  1. **HostCard** — user, host IP, uptime, OS name + version
  2. **CpuCard** — total CPU %, breakdown (user/kernel/iowait), per-core horizontal bars
  3. **MemCard** — physical memory (used/total), swap (used/total) as dual progress bars
  4. **NetCard** — total RX/TX, current RX/TX rate, 60-point multi-series sparkline (CPU %, memory %, RX, TX), matching the reference UI's legend
  5. **ProcessList** — top 20 processes by %CPU, columns: process, PID, %CPU, memory, action (kill)
  6. **NicList** — interface name, IPv4 address, MAC

### 3.3 State transitions
- **Panel opens on SSH tab** → metrics begin streaming within 2 s; cards fill in.
- **Active tab changes to another SSH tab** → panel auto-switches to the new session; previous session's polling stops.
- **Active tab changes to non-SSH** → panel shows empty state "请切换到 SSH 会话 / Switch to an SSH session".
- **Remote SSH session disconnects** → panel freezes last snapshot (greyed out) and shows banner "连接已断开 / Disconnected".
- **Remote is not Linux** (no `/proc/stat`) → panel shows "仅支持 Linux 远端 / Linux remote required" and stops polling.

## 4. Frontend Architecture

### 4.1 File layout

```
src/components/ServerPanel/
├── ServerPanel.tsx        drawer container; owns snapshot + history state
├── HostCard.tsx
├── CpuCard.tsx
├── MemCard.tsx
├── NetCard.tsx
├── ProcessList.tsx
├── NicList.tsx
├── Sparkline.tsx          shared SVG line chart, multi-series (CPU %, mem %, RX, TX)
└── index.ts
```

### 4.2 State management
- `appStore` additions:
  - `serverPanelOpen: boolean`
  - `toggleServerPanel(): void`
- Metric data is **not** in Zustand. It lives in `ServerPanel.tsx` via `useState`:
  - `snapshot: MetricsSnapshot | null`
  - `history: { cpu: number[]; mem: number[]; rx: number[]; tx: number[] }` (four ring buffers, 60 entries each, used by the sparkline)
  - `status: 'loading' | 'ok' | 'error' | 'unsupported' | 'disconnected'`
- Rationale: 2 s updates into a global store would trigger cross-component re-renders; state is ephemeral and dies with the drawer.

### 4.3 Event subscription
- `useEffect` on `[activeTabId, serverPanelOpen]`:
  - If open AND active tab is SSH:
    - `invoke('start_server_metrics', { sessionId })`
    - `listen('server-metrics-' + sessionId, handler)`
    - `listen('server-metrics-error-' + sessionId, errHandler)`
  - Cleanup: unlisten both, `invoke('stop_server_metrics', { sessionId })`

### 4.4 i18n
- Add `serverPanel.*` namespace entries to `i18n/locales/gwshell.zh.json` and `gwshell.en.json`.
- All visible strings (card titles, column headers, status banners, tooltip, confirm-kill dialog) use `t('serverPanel.*')`.

### 4.5 Styling
- Reuses existing CSS variables (`--bg-primary`, `--bg-secondary`, `--text-primary`, accent colors). No hard-coded colors.
- Icons from `lucide-react` (already a project dependency).

## 5. Backend Architecture

### 5.1 New module `src-tauri/src/metrics.rs`

```rust
pub struct MetricsManager {
    tasks: Mutex<HashMap<String, JoinHandle<()>>>,
    last:  Mutex<HashMap<String, LastSample>>,
}

struct LastSample {
    cpu_total: CpuTimes,
    cpu_per_core: Vec<CpuTimes>,
    net_bytes: HashMap<String, (u64, u64)>,  // iface -> (rx, tx)
    taken_at: Instant,
}

#[derive(Serialize, Clone)]
pub struct MetricsSnapshot {
    host: Option<HostInfo>,
    cpu: Option<CpuStats>,
    mem: Option<MemStats>,
    net: Option<NetStats>,
    procs: Option<Vec<ProcInfo>>,
    nics: Option<Vec<NicInfo>>,
    collected_at: i64,  // unix millis
}
```

Each field is `Option<_>` so a single parse failure doesn't blank the whole panel.

### 5.2 SshManager extension

Add to `src-tauri/src/ssh.rs`:

```rust
pub fn open_exec_channel(&self, session_id: &str, cmd: &str)
    -> Result<String, String>;
```

Opens a fresh `libssh2` channel on the existing `Session` for `session_id`, runs `cmd` via `channel.exec`, reads stdout to EOF, closes the channel, returns the collected output. The underlying `Session` is shared — the PTY channel is untouched.

### 5.3 Polling loop (2 s interval)

**On `start_server_metrics`:**

1. Check `tasks` map — if entry for `session_id` exists, return early (idempotent).
2. Spawn a tokio task:
   - **Tick 1 (static probe):**
     ```sh
     hostname; uname -sr; cat /etc/os-release; nproc; grep 'model name' /proc/cpuinfo | head -1
     ```
     Store as `HostInfo`. If `/proc/cpuinfo` fails, emit `server-metrics-error` with reason `unsupported` and exit.
   - **Every tick (2 s):** one aux-channel exec, combined script:
     ```sh
     echo '---STAT---';   cat /proc/stat
     echo '---MEM---';    cat /proc/meminfo
     echo '---NET---';    cat /proc/net/dev
     echo '---UPT---';    cat /proc/uptime
     echo '---LOAD---';   cat /proc/loadavg
     echo '---PROC---';   ps -eo pid,comm,%cpu,%mem,rss --sort=-%cpu 2>/dev/null | head -21
     echo '---NIC---';    ip -o -4 addr show 2>/dev/null; ip -o link show 2>/dev/null
     echo '---END---'
     ```
   - Parse per-section; each section independently. Compute deltas against `LastSample` for CPU% and network rates.
   - Emit `window.emit("server-metrics-<session_id>", snapshot)`.
   - Update `LastSample`.

### 5.4 Parsing rules

- **CPU %:** `/proc/stat` `cpu` line fields `user, nice, system, idle, iowait, irq, softirq, steal`. `total = sum`, `active = total - idle - iowait`. Percentage = `100 * (active_delta) / (total_delta)`. Same per-core for subsequent `cpu0`, `cpu1`, ... lines.
- **Memory:** `/proc/meminfo` fields `MemTotal, MemAvailable, SwapTotal, SwapFree`. Used = `Total - Available`.
- **Network rates:** `/proc/net/dev` bytes columns, minus loopback. Rate = `(now - last) / dt_seconds`. Aggregate across non-loopback interfaces for the card's total; keep per-interface for NicList enrichment if needed.
- **Processes:** `ps` output skipped header, split whitespace, first 20 rows.
- **NICs:** parse `ip -o -4 addr show` for IPv4, `ip -o link show` for MAC.
- Any section whose parse fails is set to `None`; corresponding card shows "—" placeholders.

### 5.5 Error handling

- `open_exec_channel` error (session dropped / network down) → emit `server-metrics-error-<session_id>` with reason `disconnected`, stop task, drop `LastSample`.
- Per-tick command exceeds 5 s → skip this tick, don't update `LastSample`. After 3 consecutive timeouts, stop task and emit `disconnected`.
- Static probe on tick 1 indicates non-Linux → emit `unsupported`, stop task.

### 5.6 New Tauri commands

```rust
#[tauri::command]
async fn start_server_metrics(session_id: String, ...) -> Result<(), String>;

#[tauri::command]
async fn stop_server_metrics(session_id: String, ...);

#[tauri::command]
async fn kill_remote_process(session_id: String, pid: u32) -> Result<(), String>;
```

`kill_remote_process` runs `kill <pid>` via a one-shot aux channel. Front-end confirms with a modal before invoking.

All three registered in `lib.rs`'s `invoke_handler!`.

## 6. Data Flow Summary

```
User toggles panel
  → appStore.serverPanelOpen = true
  → <ServerPanel/> mounts
  → invoke('start_server_metrics', sessionId)
  → backend spawns 2s polling task
  → every 2s: window.emit('server-metrics-<sid>', snapshot)
  → frontend listener updates local state → cards re-render

User switches to another SSH tab
  → useEffect dep change → stop old, start new

User closes panel
  → <ServerPanel/> unmounts
  → invoke('stop_server_metrics', sessionId)
  → backend cancels task, frees LastSample

SSH session disconnects
  → aux channel open fails → emit error event
  → panel greys out, shows disconnected banner
```

## 7. Invariants

- At most one metrics task per `session_id` (map-guarded).
- Closing the panel fully stops backend work — no lingering timers.
- The PTY channel is never touched by MetricsManager; all metric reads use freshly opened and immediately closed aux channels.
- A single `MetricsSnapshot` contains either valid data or `None` per section — no mixed partial states silently omitted.

## 8. Testing & Verification

The project has no automated tests. MVP verification is manual + `npm run smoke:check`.

### 8.1 Smoke-check additions
`scripts/smoke-check.js` gains assertions:
- `ServerPanel.tsx` useEffect cleanup contains `stop_server_metrics`.
- `metrics.rs` polling loop has a per-tick timeout.
- New Tauri commands (`start_server_metrics`, `stop_server_metrics`, `kill_remote_process`) appear in `lib.rs` `invoke_handler!`.

### 8.2 Manual acceptance checklist

1. SSH into a Linux server, open panel — cards populate within 2 s.
2. Close panel; `ss -tn` on the target shows no lingering sshd channel growth.
3. Switch between two SSH tabs — panel data follows the active tab.
4. Run `yes > /dev/null` on the remote — CPU card spikes, sparkline shows a peak.
5. `exit` from the terminal — panel greys out with "disconnected" banner.
6. Connect to a macOS host — panel shows "Linux remote required" and stops.
7. Click kill on a process — it disappears from the list on the next tick.
8. Toggle light/dark theme — panel styling follows.
9. Toggle zh/en — all panel strings translate.
10. Close and reopen the app; panel state is not persisted (starts closed).

## 9. Out of Scope / Future

- Per-core selection / collapse-expand of CPU bars
- Disk I/O card (needs `iostat` which isn't always installed)
- Multi-second history retention (would require backend-side ring buffer)
- macOS / BSD / Windows remote support (different probe sources)
- Process column sorting, search, signal selection (SIGTERM vs SIGKILL)
- Panel width persistence / resizable drag handle
