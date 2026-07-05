# Server Panel Enhancements — Design Spec

**Date:** 2026-07-03
**Status:** Approved (pending implementation plan)
**Scope:** Three incremental enhancements to the existing Server Panel (see `2026-04-20-server-panel-design.md`): disk I/O card, process sort/search/signal-selection, and resizable drawer.

## 1. Goal

Close three items from the original spec's §9 "Out of Scope / Future" list, without expanding the panel's scope beyond Linux `/proc`-based remotes:

1. **Disk I/O** — show read/write throughput and IOPS for the root device, derived from `/proc/diskstats`.
2. **Process table** — client-side column sorting + text search, plus a choice between SIGTERM and SIGKILL on kill.
3. **Resize** — a drag handle on the drawer's left edge, with width persisted across sessions.

All three reuse the existing single-batch SSH probe and the existing `LastSample` delta mechanism. No new SSH round-trips are added per tick.

## 2. Non-Goals

- No per-device breakdown (only the device backing `/` is tracked).
- No historical graphing of disk I/O beyond the single current value (the 60-point sparkline stays CPU/mem/net only).
- No backend ring-buffer history retention (out of scope, unchanged).
- No process search by command-line args or full path — search matches `comm` and `pid` text only.
- No new process columns (e.g. user, nice, start time).
- No macOS / BSD / Windows support (still `unsupported`).
- No persisted sort/search state across panel reopens (resets to defaults each open).

## 3. Feature A — Disk I/O via /proc/diskstats

### 3.1 Rationale

`iostat` is frequently absent on minimal remote hosts. `/proc/diskstats` is always present on Linux and exposes cumulative sector counters; a delta against the previous tick yields throughput and IOPS without any extra dependency.

### 3.2 Data collection

- The batched probe command in `metrics.rs` (the multi-`echo` block) gains one section:
  ```
  echo '---DISKIO---'; cat /proc/diskstats 2>/dev/null
  ```
- Section parser in `build_snapshot` adds a `"DISKIO"` tag mapping, mirroring the existing `STAT`/`MEM`/`DISK` handling.

### 3.3 Device selection

- Reuse the already-collected `df -kP /` output. Its first data column is the filesystem path (e.g. `/dev/sda2`, `/dev/nvme0n1p3`, or a non-`/dev` value for network/overlay mounts).
- Derive the diskstats device name by stripping the `/dev/` prefix. If the df filesystem is not under `/dev/` (e.g. `overlay`, `tmpfs`, NFS), no device can be matched → `disk_io = None` and the card shows space only (current behavior).
- In `/proc/diskstats`, match the line whose 3rd whitespace-separated field equals the derived device name. Partitions (`sda2`, `nvme0n1p3`) appear as their own lines, so the exact partition device is tracked.

### 3.4 Parsing

`/proc/diskstats` line fields (1-indexed, whitespace-separated):

- 1 major, 2 minor, 3 device name
- 6 sectors read (cumulative), 10 sectors written (cumulative)
- 4 reads completed, 8 writes completed (for IOPS)

Each sector is 512 bytes (constant, per kernel ABI).

New pure function:

```rust
pub fn parse_diskstats(text: &str, device: &str) -> Option<DiskIoCounters> {
    // returns cumulative sectors_read, sectors_written, reads, writes
}
```

Unit-tested like the other `parse_*` functions.

### 3.5 Delta computation

`LastSample` gains two `u64` fields: `disk_sectors_read`, `disk_sectors_write` (and `reads`/`writes` for IOPS, or derive IOPS from the same counters). The delta path mirrors the existing CPU/net delta:

- If `prev` exists: `bytes_per_sec = (cur - prev) * 512 / elapsed_secs`.
- First sample (no `prev`): `disk_io = None` (card shows `—`).
- Wraparound/monotonic reset (counter < prev): treat as no prev → `None`.

`elapsed_secs` comes from the existing `now.duration_since(prev.instant)` already computed for CPU%.

### 3.6 Types

```rust
pub struct DiskIoStats {
    pub read_bytes_per_sec: u64,
    pub write_bytes_per_sec: u64,
    pub read_iops: u64,
    pub write_iops: u64,
}
```

Added to `MetricsSnapshot` as `pub disk_io: Option<DiskIoStats>`.

Frontend `DiskIoStats` mirror + `MetricsSnapshot.disk_io?: DiskIoStats | null`.

### 3.7 Frontend — DiskCard

- Extend `DiskCard` (no new card). Below the existing space progress bar, add a compact two-row key/value block:
  - 读速 (read): `fmtBytes(read_bytes_per_sec)/s` — reuses existing `fmtBytes`
  - 写速 (write): `fmtBytes(write_bytes_per_sec)/s`
- When `disk_io` is `null`, omit the block (space-only, identical to today).
- No sparkline for I/O (out of scope).

## 4. Feature B — Process sort, search, signal selection

### 4.1 Sorting

- Column headers (`进程名 / PID / %CPU / 内存`) become clickable buttons.
- New state: `sortKey: 'comm' | 'pid' | 'cpu' | 'mem'`, `sortDir: 'asc' | 'desc'`.
- Default: `sortKey='cpu', sortDir='desc'` (matches backend pre-sort, so no visual jump on first render).
- Clicking the active column toggles direction; clicking another column switches key and resets to `desc` for cpu/mem, `asc` for comm/pid.
- A small `▲`/`▼` glyph on the active header.
- Sort applied in `render` over a copied array (never mutate the prop). Numeric for pid/cpu/mem, locale-compare for comm.

### 4.2 Search

- A text input above the table header row (full-width, placeholder `搜索进程名/PID`).
- `filterText` state. Filters the (already-sorted) list by substring match on `comm` or `pid.toString()`.
- Empty filter = show all (current behavior).

### 4.3 Signal selection (SIGTERM / SIGKILL)

- Extend backend command:
  ```rust
  #[tauri::command]
  async fn kill_remote_process(
      session_id: String,
      pid: u32,
      signal: String,            // "SIGTERM" | "SIGKILL"
      state: State<'_, Arc<AppState>>,
  ) -> Result<(), String>
  ```
  Maps `signal` → `kill -TERM {pid}` / `kill -KILL {pid}`. Unknown values reject with an error string (defensive — frontend only ever sends the two).
- Frontend `invoke('kill_remote_process', { sessionId, pid, signal })`.
- UX: extend the existing armed-confirm pattern. Today a row kill button arms on first click and confirms on second click (3s timeout). New behavior:
  - First click **arms** the row (as today, 3s timeout).
  - When armed, the single confirm button is replaced by two side-by-side buttons:
    - **结束 (SIGTERM)** — primary style
    - **强制 (SIGKILL)** — destructive style
  - Either confirm sends the chosen signal and clears the armed state; both share the same 3s timeout.
  - Clicking elsewhere / Esc disarms (existing `useEscapeClose`-style behavior already on the panel).
- i18n keys added for both confirm buttons and their titles/tooltips.
- `pending` Set tracks `pid` only (one in-flight per row, as today; whichever confirm button is clicked first wins, the other is disabled while pending).

### 4.4 Data unchanged

- Backend still returns top-20 by `%CPU` (`ps --sort=-%cpu | head -21`). Sorting/search reorganize only the display.

## 5. Feature C — Resizable drawer + width persistence

### 5.1 Handle

- New element `.sp-resize-handle` as the first child of `.sp-drawer`, a 4px-wide strip on the drawer's left edge, `cursor: col-resize`, hover highlight via CSS.
- `aria-label` for accessibility (i18n key `serverPanel_resize_handle`).

### 5.2 Drag behavior

- `onMouseDown` on the handle starts drag: capture pointer, attach `mousemove`/`mouseup` to `window`.
- `mousemove`: `newWidth = window.innerWidth - clientX` (drawer is right-anchored), clamped to `[320, 720]`. Update a local `width` state applied as `style={{ width }}` on `.sp-drawer`.
- `mouseup`: end drag, remove listeners, persist width (§5.3).
- Drag is suppressed during `loading`/`no-ssh` is fine (handle still works; width is independent of metrics).

### 5.3 Persistence

- `AppSettings` interface (settingsStore.ts) gains `serverPanelWidth: number` (default `380`, matching the current fixed width in `ServerPanel.css:6`).
- On drag end: `update({ serverPanelWidth: width })` → existing `save_app_settings` JSON round-trip. No backend change (app_settings is a stored JSON string).
- On panel mount: read `settings.serverPanelWidth` and apply as initial width; fall back to `380` if unset.
- Debounce is unnecessary — persist only on `mouseup`, not on every `mousemove`.

### 5.4 CSS

- `.sp-drawer` currently has a fixed `width`. Replace with an inline `style` and keep `min-width`/`max-width` as CSS clamp safety (320/720) in addition to the JS clamp.
- Add `.sp-resize-handle` and `:hover`/active states.

## 6. Error handling

- **DISKIO parse failure / no device match** → `disk_io = None`; DiskCard shows space only. Never errors the whole snapshot.
- **Counter reset/wraparound** (cur < prev) → treat as first sample (`None`), self-heals next tick.
- **Unknown signal** → backend returns `Err`; frontend already `console.warn`s and clears pending (existing pattern). No crash.
- **Resize outside clamp** → JS clamp guarantees valid range; CSS min/max as belt-and-suspenders.

## 7. Testing

- **Rust unit tests** (alongside existing `parse_*` tests in `metrics.rs`):
  - `parse_diskstats` finds the right device line and extracts counters.
  - `parse_diskstats` returns `None` when device absent.
  - Delta math: first sample → `None`; second sample → correct bytes/s and IOPS; wraparound → `None`.
  - `kill_remote_process` signal mapping is covered indirectly (or a small helper test).
- **Frontend**: no test runner exists yet (see separate frontend-test-infra sub-project). For now validated by `npm run build` (tsc) and manual acceptance, consistent with the original Server Panel plan.
- **Smoke**: `scripts/stability-smoke.mjs` already verifies every `invoke(...)` has a registered command — the new `signal` param on `kill_remote_process` keeps the same command name, so the smoke check stays green.

## 8. i18n keys

New keys in both `gwshell.en.json` and `gwshell.zh.json` (parity enforced by the smoke test):

- `serverPanel_disk_read` / `serverPanel_disk_write` (read speed / write speed labels)
- `serverPanel_proc_search_placeholder`
- `serverPanel_proc_kill_sigterm` / `serverPanel_proc_kill_sigkill` (button + tooltip)
- `serverPanel_proc_sort_asc` / `serverPanel_proc_sort_desc` (aria)
- `serverPanel_resize_handle` (aria-label)

## 9. Out of scope (still)

Unchanged from original spec §9 except the three items now implemented here:

- Per-core CPU bar collapse/expand
- macOS / BSD / Windows remote support
- Backend multi-second history ring buffer
- Disk I/O sparkline/graph
