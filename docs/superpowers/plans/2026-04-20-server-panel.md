# Server Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a HexHub-style right-side "Server Panel" drawer that shows live host metrics (host info, CPU, memory, network, processes, NICs) for the currently active SSH session, refreshing every 2 seconds, Linux remote only.

**Architecture:** New backend module `metrics.rs` owns a `MetricsManager` that spawns a per-session tokio polling task. Each tick opens a fresh auxiliary SSH channel (via the existing `SshManager::ssh_exec` primitive), runs a single combined `/proc`-based probe, parses sections independently, computes CPU % and network rate deltas against the previous sample, and emits a `server-metrics-<session_id>` event. The frontend `<ServerPanel/>` component is a 380 px right-side drawer, toggled from `TitleBar`, that subscribes to the event for the active SSH tab and renders six stacked cards.

**Tech Stack:** Rust + tokio (backend polling), ssh2/libssh2 (auxiliary channel), Tauri events (push), React + Zustand (UI state), lucide-react (icons), SVG (sparkline + per-core bars), i18next (bilingual strings).

Spec: `docs/superpowers/specs/2026-04-20-server-panel-design.md`.

Note: This project has no automated frontend tests. Frontend TDD steps are replaced with `npm run smoke:check` and manual acceptance. Pure Rust parsers DO get `cargo test` unit tests (first task that creates them).

---

## File Structure

### New files
- `src-tauri/src/metrics.rs` — `MetricsManager`, snapshot types, parsers, polling loop.
- `src/types/serverMetrics.ts` — shared TS types (`MetricsSnapshot`, `HostInfo`, `CpuStats`, etc.).
- `src/components/ServerPanel/index.ts`
- `src/components/ServerPanel/ServerPanel.tsx` — drawer container, owns snapshot + history state, subscribes to events.
- `src/components/ServerPanel/HostCard.tsx`
- `src/components/ServerPanel/CpuCard.tsx`
- `src/components/ServerPanel/MemCard.tsx`
- `src/components/ServerPanel/NetCard.tsx`
- `src/components/ServerPanel/ProcessList.tsx`
- `src/components/ServerPanel/NicList.tsx`
- `src/components/ServerPanel/Sparkline.tsx` — shared SVG line chart, multi-series.
- `src/components/ServerPanel/ServerPanel.css` — scoped styles (follows existing pattern of per-component CSS, e.g. `SftpPanel.css`).

### Modified files
- `src-tauri/src/lib.rs` — add `mod metrics;`, add `MetricsManager` to `AppState`, add 3 new commands, register in `invoke_handler!`.
- `src-tauri/src/ssh.rs` — no logic change. Confirm `ssh_exec` is `pub` (it already is).
- `src/stores/appStore.ts` — add `serverPanelOpen: boolean` + `toggleServerPanel`.
- `src/App.tsx` — mount `<ServerPanel/>` at root level (overlay).
- `src/components/TitleBar/TitleBar.tsx` — add toggle button, gated on active-tab SSH.
- `src/i18n/locales/gwshell.zh.json`, `gwshell.en.json` — add `serverPanel.*` keys.
- `src/i18n/index.ts` (if it exports `TranslationKeys` union) — add the new key names.
- `scripts/stability-smoke.mjs` — add 3 assertions covering the new wiring.

---

## Task 1: Shared TypeScript types

**Files:**
- Create: `src/types/serverMetrics.ts`

- [ ] **Step 1: Create the types file**

Write the whole file:

```ts
// src/types/serverMetrics.ts
// Shape mirrors the Rust `MetricsSnapshot` serialized by serde.

export interface HostInfo {
  hostname: string;
  host_ip: string;        // filled in client-side from the session config (backend returns "")
  user: string;           // from `whoami`
  uptime_seconds: number;
  kernel: string;         // `uname -sr` output
  os_pretty: string;      // PRETTY_NAME from /etc/os-release
  cpu_model: string;      // first "model name" from /proc/cpuinfo
  cpu_cores: number;      // `nproc`
}

export interface CpuStats {
  total_percent: number;       // 0-100
  user_percent: number;
  system_percent: number;
  iowait_percent: number;
  per_core: number[];          // 0-100 each, length = cpu_cores
  loadavg_1m: number;
  loadavg_5m: number;
  loadavg_15m: number;
}

export interface MemStats {
  mem_total_bytes: number;
  mem_used_bytes: number;
  swap_total_bytes: number;
  swap_used_bytes: number;
}

export interface NetStats {
  total_rx_bytes: number;     // cumulative since boot
  total_tx_bytes: number;
  rx_bytes_per_sec: number;   // delta-derived
  tx_bytes_per_sec: number;
}

export interface ProcInfo {
  pid: number;
  comm: string;
  cpu_percent: number;
  mem_percent: number;
  rss_kb: number;
}

export interface NicInfo {
  name: string;
  ipv4: string | null;
  mac: string | null;
}

export interface MetricsSnapshot {
  host: HostInfo | null;
  cpu: CpuStats | null;
  mem: MemStats | null;
  net: NetStats | null;
  procs: ProcInfo[] | null;
  nics: NicInfo[] | null;
  collected_at: number;   // unix ms
}

export type MetricsErrorReason =
  | 'unsupported'       // remote is not Linux
  | 'disconnected'      // SSH channel can't be opened (session dropped)
  | 'timeout';          // >=3 consecutive tick timeouts

export interface MetricsErrorPayload {
  reason: MetricsErrorReason;
  detail?: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/serverMetrics.ts
git commit -m "feat(server-panel): add shared server metrics types"
```

---

## Task 2: Rust snapshot types + pure parsers (TDD)

The polling loop is side-effectful; the parsers are pure. Write unit tests first against real-sample `/proc` fixtures.

**Files:**
- Create: `src-tauri/src/metrics.rs`

- [ ] **Step 1: Stub the module with types only**

Create `src-tauri/src/metrics.rs`:

```rust
// src-tauri/src/metrics.rs
//
// Remote-server metrics collector. Runs a 2s polling task per SSH session,
// reusing the existing SshManager auxiliary-exec primitive to read /proc
// and ps/ip output. Parsers are pure (unit-tested); the polling loop is
// in the lower half of this file.

use serde::Serialize;
use std::collections::HashMap;

// ---- Snapshot types (serialized to the frontend) ----

#[derive(Debug, Serialize, Clone, Default)]
pub struct HostInfo {
    pub hostname: String,
    pub host_ip: String,
    pub user: String,
    pub uptime_seconds: u64,
    pub kernel: String,
    pub os_pretty: String,
    pub cpu_model: String,
    pub cpu_cores: u32,
}

#[derive(Debug, Serialize, Clone, Default)]
pub struct CpuStats {
    pub total_percent: f64,
    pub user_percent: f64,
    pub system_percent: f64,
    pub iowait_percent: f64,
    pub per_core: Vec<f64>,
    pub loadavg_1m: f64,
    pub loadavg_5m: f64,
    pub loadavg_15m: f64,
}

#[derive(Debug, Serialize, Clone, Default)]
pub struct MemStats {
    pub mem_total_bytes: u64,
    pub mem_used_bytes: u64,
    pub swap_total_bytes: u64,
    pub swap_used_bytes: u64,
}

#[derive(Debug, Serialize, Clone, Default)]
pub struct NetStats {
    pub total_rx_bytes: u64,
    pub total_tx_bytes: u64,
    pub rx_bytes_per_sec: f64,
    pub tx_bytes_per_sec: f64,
}

#[derive(Debug, Serialize, Clone)]
pub struct ProcInfo {
    pub pid: u32,
    pub comm: String,
    pub cpu_percent: f64,
    pub mem_percent: f64,
    pub rss_kb: u64,
}

#[derive(Debug, Serialize, Clone)]
pub struct NicInfo {
    pub name: String,
    pub ipv4: Option<String>,
    pub mac: Option<String>,
}

#[derive(Debug, Serialize, Clone, Default)]
pub struct MetricsSnapshot {
    pub host: Option<HostInfo>,
    pub cpu: Option<CpuStats>,
    pub mem: Option<MemStats>,
    pub net: Option<NetStats>,
    pub procs: Option<Vec<ProcInfo>>,
    pub nics: Option<Vec<NicInfo>>,
    pub collected_at: i64,
}

// ---- Raw CPU times from /proc/stat (for delta computation) ----

#[derive(Debug, Clone, Copy, Default)]
pub struct CpuTimes {
    pub user: u64,
    pub nice: u64,
    pub system: u64,
    pub idle: u64,
    pub iowait: u64,
    pub irq: u64,
    pub softirq: u64,
    pub steal: u64,
}

impl CpuTimes {
    pub fn total(&self) -> u64 {
        self.user + self.nice + self.system + self.idle + self.iowait + self.irq + self.softirq + self.steal
    }
    pub fn active(&self) -> u64 {
        self.total().saturating_sub(self.idle).saturating_sub(self.iowait)
    }
}

// ---- Parsers (pure) ----

/// Parse one line from /proc/stat of the form
/// "cpu  u n s i iow irq softirq steal ..." and return CpuTimes.
/// Returns None if the line doesn't start with "cpu".
pub fn parse_cpu_line(line: &str) -> Option<CpuTimes> {
    let mut parts = line.split_ascii_whitespace();
    let tag = parts.next()?;
    if !tag.starts_with("cpu") {
        return None;
    }
    let nums: Vec<u64> = parts.filter_map(|s| s.parse().ok()).collect();
    if nums.len() < 4 {
        return None;
    }
    Some(CpuTimes {
        user: nums[0],
        nice: nums[1],
        system: nums[2],
        idle: nums[3],
        iowait: *nums.get(4).unwrap_or(&0),
        irq: *nums.get(5).unwrap_or(&0),
        softirq: *nums.get(6).unwrap_or(&0),
        steal: *nums.get(7).unwrap_or(&0),
    })
}

/// Parse the whole /proc/stat output and return (total, per_core_vec).
pub fn parse_proc_stat(text: &str) -> Option<(CpuTimes, Vec<CpuTimes>)> {
    let mut total: Option<CpuTimes> = None;
    let mut cores: Vec<CpuTimes> = Vec::new();
    for line in text.lines() {
        if line.starts_with("cpu ") {
            total = parse_cpu_line(line);
        } else if line.starts_with("cpu") && line.chars().nth(3).map(|c| c.is_ascii_digit()).unwrap_or(false) {
            if let Some(t) = parse_cpu_line(line) {
                cores.push(t);
            }
        }
    }
    Some((total?, cores))
}

/// Parse /proc/meminfo into (mem_total, mem_available, swap_total, swap_free) bytes.
pub fn parse_meminfo(text: &str) -> MemStats {
    let mut total_kb = 0u64;
    let mut avail_kb = 0u64;
    let mut swap_total_kb = 0u64;
    let mut swap_free_kb = 0u64;
    for line in text.lines() {
        let mut parts = line.split_ascii_whitespace();
        let key = parts.next().unwrap_or("");
        let val: u64 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
        match key {
            "MemTotal:"     => total_kb = val,
            "MemAvailable:" => avail_kb = val,
            "SwapTotal:"    => swap_total_kb = val,
            "SwapFree:"     => swap_free_kb = val,
            _ => {}
        }
    }
    MemStats {
        mem_total_bytes: total_kb * 1024,
        mem_used_bytes: total_kb.saturating_sub(avail_kb) * 1024,
        swap_total_bytes: swap_total_kb * 1024,
        swap_used_bytes: swap_total_kb.saturating_sub(swap_free_kb) * 1024,
    }
}

/// Parse /proc/net/dev and return iface -> (rx_bytes, tx_bytes) for non-loopback interfaces.
pub fn parse_net_dev(text: &str) -> HashMap<String, (u64, u64)> {
    let mut out = HashMap::new();
    for line in text.lines().skip(2) {
        let (name_part, rest) = match line.split_once(':') {
            Some(v) => v,
            None => continue,
        };
        let name = name_part.trim().to_string();
        if name == "lo" {
            continue;
        }
        let cols: Vec<&str> = rest.split_ascii_whitespace().collect();
        if cols.len() < 9 {
            continue;
        }
        let rx: u64 = cols[0].parse().unwrap_or(0);
        let tx: u64 = cols[8].parse().unwrap_or(0);
        out.insert(name, (rx, tx));
    }
    out
}

/// Parse output of `ps -eo pid,comm,%cpu,%mem,rss --sort=-%cpu | head -21`.
/// Skips the header line. Returns up to 20 rows.
pub fn parse_ps(text: &str) -> Vec<ProcInfo> {
    text.lines()
        .skip(1)
        .filter_map(|line| {
            let mut parts = line.split_ascii_whitespace();
            let pid: u32 = parts.next()?.parse().ok()?;
            let comm: String = parts.next()?.to_string();
            let cpu: f64 = parts.next()?.parse().ok()?;
            let mem: f64 = parts.next()?.parse().ok()?;
            let rss: u64 = parts.next()?.parse().ok()?;
            Some(ProcInfo {
                pid,
                comm,
                cpu_percent: cpu,
                mem_percent: mem,
                rss_kb: rss,
            })
        })
        .take(20)
        .collect()
}

/// Parse /etc/os-release for PRETTY_NAME.
pub fn parse_os_pretty(text: &str) -> String {
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("PRETTY_NAME=") {
            return rest.trim().trim_matches('"').to_string();
        }
    }
    String::new()
}

/// Parse /proc/loadavg. Returns (1m, 5m, 15m).
pub fn parse_loadavg(text: &str) -> (f64, f64, f64) {
    let nums: Vec<f64> = text.split_ascii_whitespace()
        .take(3)
        .filter_map(|s| s.parse().ok())
        .collect();
    match nums.len() {
        3 => (nums[0], nums[1], nums[2]),
        _ => (0.0, 0.0, 0.0),
    }
}

/// Parse `ip -o -4 addr show` lines for ipv4 per interface.
pub fn parse_ip_addr(text: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.split_ascii_whitespace().collect();
        // "1: lo    inet 127.0.0.1/8 ..."
        if parts.len() < 4 { continue; }
        let iface = parts[1].trim_end_matches(':').to_string();
        if let Some(idx) = parts.iter().position(|p| *p == "inet") {
            if let Some(cidr) = parts.get(idx + 1) {
                let ip = cidr.split('/').next().unwrap_or("").to_string();
                if iface != "lo" {
                    out.insert(iface, ip);
                }
            }
        }
    }
    out
}

/// Parse `ip -o link show` lines for MAC per interface.
pub fn parse_ip_link(text: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.split_ascii_whitespace().collect();
        if parts.len() < 2 { continue; }
        let iface = parts[1].trim_end_matches(':').to_string();
        if let Some(idx) = parts.iter().position(|p| *p == "link/ether") {
            if let Some(mac) = parts.get(idx + 1) {
                out.insert(iface, mac.to_string());
            }
        }
    }
    out
}

// ---- Compute CPU % from two samples (prev, cur) ----

pub fn cpu_percent(prev: CpuTimes, cur: CpuTimes) -> f64 {
    let total_d = cur.total().saturating_sub(prev.total()) as f64;
    let active_d = cur.active().saturating_sub(prev.active()) as f64;
    if total_d <= 0.0 { 0.0 } else { (100.0 * active_d / total_d).clamp(0.0, 100.0) }
}

pub fn cpu_breakdown(prev: CpuTimes, cur: CpuTimes) -> (f64, f64, f64) {
    // (user%, system%, iowait%) normalized against total delta
    let total_d = cur.total().saturating_sub(prev.total()) as f64;
    if total_d <= 0.0 {
        return (0.0, 0.0, 0.0);
    }
    let u = (cur.user.saturating_sub(prev.user) + cur.nice.saturating_sub(prev.nice)) as f64;
    let s = (cur.system.saturating_sub(prev.system)) as f64;
    let w = (cur.iowait.saturating_sub(prev.iowait)) as f64;
    (100.0 * u / total_d, 100.0 * s / total_d, 100.0 * w / total_d)
}

// ---- Tests ----

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_cpu_line() {
        let t = parse_cpu_line("cpu  100 10 50 800 5 2 3 1 0 0").unwrap();
        assert_eq!(t.user, 100);
        assert_eq!(t.idle, 800);
        assert_eq!(t.iowait, 5);
        assert_eq!(t.total(), 971);
        assert_eq!(t.active(), 971 - 800 - 5);
    }

    #[test]
    fn rejects_non_cpu_line() {
        assert!(parse_cpu_line("ctxt 12345").is_none());
    }

    #[test]
    fn parses_full_proc_stat() {
        let text = "cpu  100 10 50 800 5 2 3 1\ncpu0 50 5 25 400 2 1 1 0\ncpu1 50 5 25 400 3 1 2 1\nctxt 9999\nbtime 1\n";
        let (total, cores) = parse_proc_stat(text).unwrap();
        assert_eq!(total.user, 100);
        assert_eq!(cores.len(), 2);
        assert_eq!(cores[0].user, 50);
    }

    #[test]
    fn parses_meminfo() {
        let text = "MemTotal:        4000000 kB\nMemFree:         1000000 kB\nMemAvailable:    3000000 kB\nSwapTotal:       1000000 kB\nSwapFree:         900000 kB\n";
        let m = parse_meminfo(text);
        assert_eq!(m.mem_total_bytes, 4000000 * 1024);
        assert_eq!(m.mem_used_bytes, (4000000 - 3000000) * 1024);
        assert_eq!(m.swap_total_bytes, 1000000 * 1024);
        assert_eq!(m.swap_used_bytes, (1000000 - 900000) * 1024);
    }

    #[test]
    fn parses_net_dev_skipping_loopback() {
        let text = "Inter-|   Receive                                                |  Transmit\n face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed\n    lo: 1000 10 0 0 0 0 0 0 1000 10 0 0 0 0 0 0\n  eth0: 5000 50 0 0 0 0 0 0 2500 25 0 0 0 0 0 0\n";
        let out = parse_net_dev(text);
        assert!(!out.contains_key("lo"));
        assert_eq!(out.get("eth0"), Some(&(5000u64, 2500u64)));
    }

    #[test]
    fn parses_ps_output() {
        let text = "    PID COMMAND         %CPU %MEM   RSS\n   1234 bash             5.0  1.2  20480\n   5678 sshd             2.0  0.5  10240\n";
        let v = parse_ps(text);
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].pid, 1234);
        assert_eq!(v[0].comm, "bash");
        assert!((v[0].cpu_percent - 5.0).abs() < 1e-6);
    }

    #[test]
    fn parses_os_pretty_name() {
        let text = "NAME=\"Ubuntu\"\nVERSION_ID=\"24.04\"\nPRETTY_NAME=\"Ubuntu 24.04.4 LTS\"\nID=ubuntu\n";
        assert_eq!(parse_os_pretty(text), "Ubuntu 24.04.4 LTS");
    }

    #[test]
    fn parses_loadavg_triple() {
        assert_eq!(parse_loadavg("0.12 0.34 0.56 1/123 4567\n"), (0.12, 0.34, 0.56));
    }

    #[test]
    fn parses_ip_addr_lines() {
        let text = "1: lo    inet 127.0.0.1/8 scope host lo\\       valid_lft forever preferred_lft forever\n2: eth0    inet 10.0.0.5/24 scope global eth0\\       valid_lft forever preferred_lft forever\n";
        let out = parse_ip_addr(text);
        assert!(!out.contains_key("lo"));
        assert_eq!(out.get("eth0"), Some(&"10.0.0.5".to_string()));
    }

    #[test]
    fn parses_ip_link_lines() {
        let text = "2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP mode DEFAULT group default qlen 1000\\    link/ether aa:bb:cc:dd:ee:ff brd ff:ff:ff:ff:ff:ff\n";
        let out = parse_ip_link(text);
        assert_eq!(out.get("eth0"), Some(&"aa:bb:cc:dd:ee:ff".to_string()));
    }

    #[test]
    fn cpu_percent_is_zero_on_idle() {
        let prev = CpuTimes { idle: 100, ..Default::default() };
        let cur  = CpuTimes { idle: 200, ..Default::default() };
        assert_eq!(cpu_percent(prev, cur), 0.0);
    }

    #[test]
    fn cpu_percent_is_hundred_on_full_load() {
        let prev = CpuTimes { user: 0, idle: 100, ..Default::default() };
        let cur  = CpuTimes { user: 100, idle: 100, ..Default::default() };
        assert_eq!(cpu_percent(prev, cur), 100.0);
    }
}
```

- [ ] **Step 2: Add the module to lib.rs so `cargo test` picks it up**

Edit `src-tauri/src/lib.rs`. Find the top of the file:

```rust
mod database;
mod pty;
mod serial;
mod session;
mod ssh;
```

Change to:

```rust
mod database;
mod metrics;
mod pty;
mod serial;
mod session;
mod ssh;
```

- [ ] **Step 3: Run the tests — expect PASS**

```bash
cd src-tauri && cargo test --lib metrics:: -q
```

Expected: `ok. N passed; 0 failed.` (12 tests).

If any fail, the failure output points at the parser. Fix the parser in-place and re-run. Do not commit red tests.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/metrics.rs src-tauri/src/lib.rs
git commit -m "feat(server-panel): add metrics snapshot types and /proc parsers"
```

---

## Task 3: Backend MetricsManager + polling loop

**Files:**
- Modify: `src-tauri/src/metrics.rs` (append the manager + polling logic)

- [ ] **Step 1: Append the `MetricsManager` and polling loop to `metrics.rs`**

Append to the bottom of `src-tauri/src/metrics.rs`:

```rust
// ---- MetricsManager (live polling against a remote SSH session) ----

use crate::ssh::SshManager;
use parking_lot::Mutex;
use std::collections::HashMap as StdHashMap;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::task::JoinHandle;
use tokio::time::{sleep, timeout};

pub struct LastSample {
    pub cpu_total: CpuTimes,
    pub cpu_per_core: Vec<CpuTimes>,
    pub net_bytes: StdHashMap<String, (u64, u64)>,
    pub taken_at: Instant,
}

pub struct MetricsManager {
    tasks: Mutex<StdHashMap<String, JoinHandle<()>>>,
    last: Arc<Mutex<StdHashMap<String, LastSample>>>,
    static_host: Arc<Mutex<StdHashMap<String, HostInfo>>>,
}

impl MetricsManager {
    pub fn new() -> Self {
        Self {
            tasks: Mutex::new(StdHashMap::new()),
            last: Arc::new(Mutex::new(StdHashMap::new())),
            static_host: Arc::new(Mutex::new(StdHashMap::new())),
        }
    }

    /// Idempotent. If a task already exists for this session_id, returns early.
    pub fn start(
        &self,
        session_id: String,
        ssh: Arc<SshManager>,
        app: AppHandle,
    ) {
        let mut tasks = self.tasks.lock();
        if tasks.contains_key(&session_id) {
            return;
        }
        let last = self.last.clone();
        let static_host = self.static_host.clone();
        let sid = session_id.clone();

        let handle = tokio::spawn(async move {
            // ---- One-time static probe ----
            let static_cmd = r#"
echo '---HOST---'
whoami
hostname
uname -sr
cat /etc/os-release 2>/dev/null
nproc
grep '^model name' /proc/cpuinfo | head -1
echo '---HOSTEND---'
"#;
            let ssh_static = ssh.clone();
            let sid_static = sid.clone();
            let static_out = tokio::task::spawn_blocking(move || {
                ssh_static.ssh_exec(&sid_static, static_cmd)
            })
            .await;

            match static_out {
                Ok(Ok(text)) => {
                    let host = parse_static_host(&text);
                    if host.cpu_cores == 0 {
                        // /proc/cpuinfo missing -> likely not Linux.
                        let _ = app.emit(
                            &format!("server-metrics-error-{}", sid),
                            serde_json::json!({ "reason": "unsupported" }),
                        );
                        return;
                    }
                    static_host.lock().insert(sid.clone(), host);
                }
                _ => {
                    let _ = app.emit(
                        &format!("server-metrics-error-{}", sid),
                        serde_json::json!({ "reason": "disconnected" }),
                    );
                    return;
                }
            }

            // ---- Polling loop ----
            let mut consecutive_timeouts: u32 = 0;
            loop {
                let probe = r#"
echo '---STAT---';   cat /proc/stat
echo '---MEM---';    cat /proc/meminfo
echo '---NET---';    cat /proc/net/dev
echo '---UPT---';    cat /proc/uptime
echo '---LOAD---';   cat /proc/loadavg
echo '---PROC---';   ps -eo pid,comm,%cpu,%mem,rss --sort=-%cpu 2>/dev/null | head -21
echo '---NIC4---';   ip -o -4 addr show 2>/dev/null
echo '---NICLINK---';ip -o link show 2>/dev/null
echo '---END---'
"#;
                let ssh_tick = ssh.clone();
                let sid_tick = sid.clone();
                let exec_fut = tokio::task::spawn_blocking(move || {
                    ssh_tick.ssh_exec(&sid_tick, probe)
                });

                let out = match timeout(Duration::from_secs(5), exec_fut).await {
                    Ok(Ok(Ok(text))) => {
                        consecutive_timeouts = 0;
                        text
                    }
                    Ok(Ok(Err(_))) => {
                        // ssh_exec returned Err -> session gone.
                        let _ = app.emit(
                            &format!("server-metrics-error-{}", sid),
                            serde_json::json!({ "reason": "disconnected" }),
                        );
                        break;
                    }
                    Ok(Err(_)) => {
                        // join error
                        let _ = app.emit(
                            &format!("server-metrics-error-{}", sid),
                            serde_json::json!({ "reason": "disconnected" }),
                        );
                        break;
                    }
                    Err(_) => {
                        // Timeout
                        consecutive_timeouts += 1;
                        if consecutive_timeouts >= 3 {
                            let _ = app.emit(
                                &format!("server-metrics-error-{}", sid),
                                serde_json::json!({ "reason": "timeout" }),
                            );
                            break;
                        }
                        sleep(Duration::from_secs(2)).await;
                        continue;
                    }
                };

                let snapshot = build_snapshot(&out, &sid, &last, &static_host);
                let _ = app.emit(&format!("server-metrics-{}", sid), &snapshot);

                sleep(Duration::from_secs(2)).await;
            }

            // Cleanup on exit.
            last.lock().remove(&sid);
            static_host.lock().remove(&sid);
        });

        tasks.insert(session_id, handle);
    }

    pub fn stop(&self, session_id: &str) {
        let mut tasks = self.tasks.lock();
        if let Some(handle) = tasks.remove(session_id) {
            handle.abort();
        }
        self.last.lock().remove(session_id);
        self.static_host.lock().remove(session_id);
    }
}

impl Default for MetricsManager {
    fn default() -> Self {
        Self::new()
    }
}

// ---- Static host probe parser ----

fn parse_static_host(text: &str) -> HostInfo {
    // The probe uses HOST/HOSTEND delimiters but we only care about line order.
    let mut iter = text.lines();
    let mut host = HostInfo::default();

    // Seek past "---HOST---"
    for line in &mut iter {
        if line.trim() == "---HOST---" {
            break;
        }
    }

    host.user = iter.next().unwrap_or("").trim().to_string();
    host.hostname = iter.next().unwrap_or("").trim().to_string();
    host.kernel = iter.next().unwrap_or("").trim().to_string();

    // /etc/os-release is multi-line; collect lines until `nproc` numeric line.
    // We do a simple heuristic: collect until we find a line that is purely digits (nproc),
    // then parse the collected block for PRETTY_NAME.
    let mut os_lines: Vec<String> = Vec::new();
    let mut cores: u32 = 0;
    for line in &mut iter {
        let trimmed = line.trim();
        if trimmed.chars().all(|c| c.is_ascii_digit()) && !trimmed.is_empty() {
            cores = trimmed.parse().unwrap_or(0);
            break;
        }
        if trimmed == "---HOSTEND---" {
            break;
        }
        os_lines.push(line.to_string());
    }
    host.os_pretty = parse_os_pretty(&os_lines.join("\n"));
    host.cpu_cores = cores;

    // model name line (if present)
    if let Some(line) = iter.next() {
        if let Some(after) = line.split_once(':') {
            host.cpu_model = after.1.trim().to_string();
        }
    }

    host
}

// ---- Combined-output parser (called every tick) ----

pub fn build_snapshot(
    text: &str,
    session_id: &str,
    last: &Arc<Mutex<StdHashMap<String, LastSample>>>,
    static_host: &Arc<Mutex<StdHashMap<String, HostInfo>>>,
) -> MetricsSnapshot {
    // Split by delimiter lines.
    let mut sections: StdHashMap<&str, String> = StdHashMap::new();
    let mut current: Option<&str> = None;
    let mut buf = String::new();
    for line in text.lines() {
        if let Some(tag) = line.strip_prefix("---").and_then(|s| s.strip_suffix("---")) {
            if let Some(prev) = current.take() {
                sections.insert(prev, std::mem::take(&mut buf));
            }
            if tag != "END" {
                current = Some(match tag {
                    "STAT" => "STAT",
                    "MEM" => "MEM",
                    "NET" => "NET",
                    "UPT" => "UPT",
                    "LOAD" => "LOAD",
                    "PROC" => "PROC",
                    "NIC4" => "NIC4",
                    "NICLINK" => "NICLINK",
                    _ => "",
                });
            }
            continue;
        }
        if current.is_some() {
            buf.push_str(line);
            buf.push('\n');
        }
    }

    let now = Instant::now();
    let mut prev_lock = last.lock();
    let prev = prev_lock.remove(session_id);

    // --- CPU ---
    let (cpu_stats, new_cpu_total, new_cpu_per_core) = match sections.get("STAT") {
        Some(stat_text) => match parse_proc_stat(stat_text) {
            Some((total, per_core)) => {
                let (cpu_pct, user_pct, sys_pct, iowait_pct, per_core_pct) = match &prev {
                    Some(p) => {
                        let t = cpu_percent(p.cpu_total, total);
                        let (u, s, w) = cpu_breakdown(p.cpu_total, total);
                        let core_pcts: Vec<f64> = per_core
                            .iter()
                            .enumerate()
                            .map(|(i, cur)| {
                                p.cpu_per_core
                                    .get(i)
                                    .map(|prev_c| cpu_percent(*prev_c, *cur))
                                    .unwrap_or(0.0)
                            })
                            .collect();
                        (t, u, s, w, core_pcts)
                    }
                    None => (0.0, 0.0, 0.0, 0.0, vec![0.0; per_core.len()]),
                };
                let (l1, l5, l15) = sections
                    .get("LOAD")
                    .map(|s| parse_loadavg(s))
                    .unwrap_or((0.0, 0.0, 0.0));
                (
                    Some(CpuStats {
                        total_percent: cpu_pct,
                        user_percent: user_pct,
                        system_percent: sys_pct,
                        iowait_percent: iowait_pct,
                        per_core: per_core_pct,
                        loadavg_1m: l1,
                        loadavg_5m: l5,
                        loadavg_15m: l15,
                    }),
                    total,
                    per_core,
                )
            }
            None => (None, CpuTimes::default(), Vec::new()),
        },
        None => (None, CpuTimes::default(), Vec::new()),
    };

    // --- MEM ---
    let mem_stats = sections.get("MEM").map(|t| parse_meminfo(t));

    // --- NET ---
    let new_net = sections
        .get("NET")
        .map(|t| parse_net_dev(t))
        .unwrap_or_default();
    let net_stats = {
        let mut total_rx: u64 = 0;
        let mut total_tx: u64 = 0;
        for (_, (rx, tx)) in &new_net {
            total_rx += rx;
            total_tx += tx;
        }
        let (rx_rate, tx_rate) = match &prev {
            Some(p) => {
                let dt = now.saturating_duration_since(p.taken_at).as_secs_f64().max(0.001);
                let mut prx: u64 = 0;
                let mut ptx: u64 = 0;
                for (_, (rx, tx)) in &p.net_bytes {
                    prx += rx;
                    ptx += tx;
                }
                let rx_d = total_rx.saturating_sub(prx) as f64 / dt;
                let tx_d = total_tx.saturating_sub(ptx) as f64 / dt;
                (rx_d.max(0.0), tx_d.max(0.0))
            }
            None => (0.0, 0.0),
        };
        if new_net.is_empty() {
            None
        } else {
            Some(NetStats {
                total_rx_bytes: total_rx,
                total_tx_bytes: total_tx,
                rx_bytes_per_sec: rx_rate,
                tx_bytes_per_sec: tx_rate,
            })
        }
    };

    // --- PROC ---
    let procs = sections.get("PROC").map(|t| parse_ps(t));

    // --- NIC ---
    let nics = {
        let ipv4 = sections
            .get("NIC4")
            .map(|t| parse_ip_addr(t))
            .unwrap_or_default();
        let macs = sections
            .get("NICLINK")
            .map(|t| parse_ip_link(t))
            .unwrap_or_default();
        if ipv4.is_empty() && macs.is_empty() {
            None
        } else {
            let mut names: std::collections::BTreeSet<String> = Default::default();
            for n in ipv4.keys() { names.insert(n.clone()); }
            for n in macs.keys() { if n != "lo" { names.insert(n.clone()); } }
            Some(
                names
                    .into_iter()
                    .map(|name| NicInfo {
                        ipv4: ipv4.get(&name).cloned(),
                        mac: macs.get(&name).cloned(),
                        name,
                    })
                    .collect::<Vec<_>>(),
            )
        }
    };

    // --- Host (static) ---
    let host = static_host.lock().get(session_id).cloned().map(|mut h| {
        // Refresh uptime from /proc/uptime each tick — it's cheap.
        if let Some(upt) = sections.get("UPT") {
            if let Some(first) = upt.split_ascii_whitespace().next() {
                if let Ok(s) = first.parse::<f64>() {
                    h.uptime_seconds = s as u64;
                }
            }
        }
        h
    });

    // Store this sample for the next tick.
    prev_lock.insert(
        session_id.to_string(),
        LastSample {
            cpu_total: new_cpu_total,
            cpu_per_core: new_cpu_per_core,
            net_bytes: new_net,
            taken_at: now,
        },
    );

    MetricsSnapshot {
        host,
        cpu: cpu_stats,
        mem: mem_stats,
        net: net_stats,
        procs,
        nics,
        collected_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0),
    }
}
```

- [ ] **Step 2: Run `cargo check` to verify the new code compiles**

```bash
cd src-tauri && cargo check
```

Expected: no errors. Warnings about unused items are acceptable since some are consumed only by the next task.

If there's an error about `MetricsManager` being unused or `SshManager::ssh_exec` visibility — verify that `pub fn ssh_exec` in `src-tauri/src/ssh.rs:802` is already `pub` (it is per the scan we did).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/metrics.rs
git commit -m "feat(server-panel): add MetricsManager polling loop and snapshot builder"
```

---

## Task 4: Tauri commands + `AppState` wiring

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add `MetricsManager` to `AppState`**

Edit `src-tauri/src/lib.rs`. Change this block (around line 16):

```rust
pub struct AppState {
    pub pty_manager: PtyManager,
    pub ssh_manager: SshManager,
    pub serial_manager: SerialManager,
    pub sessions: Mutex<Vec<SessionConfig>>,
    pub groups: Mutex<Vec<SessionGroup>>,
    pub db: Database,
}
```

to:

```rust
pub struct AppState {
    pub pty_manager: PtyManager,
    pub ssh_manager: Arc<SshManager>,
    pub serial_manager: SerialManager,
    pub sessions: Mutex<Vec<SessionConfig>>,
    pub groups: Mutex<Vec<SessionGroup>>,
    pub db: Database,
    pub metrics: metrics::MetricsManager,
}
```

- [ ] **Step 2: Update the `AppState::new`-equivalent construction**

Still in `lib.rs`, find the `run()` function. Locate:

```rust
    let app_state = Arc::new(AppState {
        pty_manager: PtyManager::new(),
        ssh_manager: SshManager::new(),
        serial_manager: SerialManager::new(),
        sessions: Mutex::new(initial_sessions),
        groups: Mutex::new(initial_groups),
        db,
    });
```

Change to:

```rust
    let app_state = Arc::new(AppState {
        pty_manager: PtyManager::new(),
        ssh_manager: Arc::new(SshManager::new()),
        serial_manager: SerialManager::new(),
        sessions: Mutex::new(initial_sessions),
        groups: Mutex::new(initial_groups),
        db,
        metrics: metrics::MetricsManager::new(),
    });
```

- [ ] **Step 3: Fix existing callers that use `state.ssh_manager` directly**

Changing `ssh_manager: SshManager` to `Arc<SshManager>` means `state.ssh_manager.some_method()` still works thanks to `Deref`. No changes needed at call sites — Rust auto-derefs `Arc<T>` for method calls.

Verify by running `cargo check`:

```bash
cd src-tauri && cargo check
```

Expected: no new errors beyond what was there before.

- [ ] **Step 4: Add three new Tauri commands**

Append to `src-tauri/src/lib.rs` right after the existing `ssh_exec` command (search for `async fn ssh_exec` — add directly below it):

```rust
// ---- Server Panel (Metrics) Commands ----

#[tauri::command]
fn start_server_metrics(
    session_id: String,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let ssh = state.ssh_manager.clone();
    state.metrics.start(session_id, ssh, app_handle);
    Ok(())
}

#[tauri::command]
fn stop_server_metrics(session_id: String, state: State<'_, Arc<AppState>>) {
    state.metrics.stop(&session_id);
}

#[tauri::command]
async fn kill_remote_process(
    session_id: String,
    pid: u32,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        let cmd = format!("kill {}", pid);
        state
            .ssh_manager
            .ssh_exec(&session_id, &cmd)
            .map(|_| ())
    })
    .await
    .map_err(|e| format!("task join: {}", e))?
}
```

- [ ] **Step 5: Register the three commands in `invoke_handler!`**

Still in `lib.rs`, find the `invoke_handler![...]` block near the bottom. It lists handlers like:

```rust
            ssh_exec,
            ping_host,
```

Insert the three new names right after `ssh_exec`:

```rust
            ssh_exec,
            start_server_metrics,
            stop_server_metrics,
            kill_remote_process,
            ping_host,
```

- [ ] **Step 6: Compile**

```bash
cd src-tauri && cargo check
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(server-panel): wire MetricsManager + 3 Tauri commands"
```

---

## Task 5: `appStore` state + i18n keys

**Files:**
- Modify: `src/stores/appStore.ts`
- Modify: `src/i18n/locales/gwshell.zh.json`
- Modify: `src/i18n/locales/gwshell.en.json`

- [ ] **Step 1: Add `serverPanelOpen` to `AppStore`**

Edit `src/stores/appStore.ts`. Find the interface block where `sftpPanelOpen` is declared (around line 86):

```ts
  // SFTP Panel
  sftpPanelOpen: boolean;
  toggleSftpPanel: () => void;
}
```

Change to:

```ts
  // SFTP Panel
  sftpPanelOpen: boolean;
  toggleSftpPanel: () => void;

  // Server Panel (right-side live metrics drawer — SSH only)
  serverPanelOpen: boolean;
  toggleServerPanel: () => void;
}
```

Then find the store-creation block where `sftpPanelOpen: true` lives (around line 471):

```ts
  sftpPanelOpen: true,
  toggleSftpPanel: () => set((state) => ({ sftpPanelOpen: !state.sftpPanelOpen })),
}));
```

Change to:

```ts
  sftpPanelOpen: true,
  toggleSftpPanel: () => set((state) => ({ sftpPanelOpen: !state.sftpPanelOpen })),

  serverPanelOpen: false,
  toggleServerPanel: () => set((state) => ({ serverPanelOpen: !state.serverPanelOpen })),
}));
```

- [ ] **Step 2: Add zh translations**

Edit `src/i18n/locales/gwshell.zh.json`. Find the last key before the closing `}` and add these keys (adjust the trailing-comma placement as needed):

```json
  "serverPanel_toggle_title": "显示服务器面板",
  "serverPanel_ssh_only": "仅 SSH 会话支持",
  "serverPanel_close": "关闭服务器面板",
  "serverPanel_title": "服务器面板",
  "serverPanel_status_loading": "加载中…",
  "serverPanel_status_disconnected": "连接已断开",
  "serverPanel_status_unsupported": "仅支持 Linux 远端",
  "serverPanel_status_timeout": "采集超时,已停止",
  "serverPanel_status_no_ssh": "请切换到 SSH 会话",
  "serverPanel_host_user": "用户",
  "serverPanel_host_host": "主机",
  "serverPanel_host_uptime": "运行时间",
  "serverPanel_host_system": "系统",
  "serverPanel_cpu_title": "CPU",
  "serverPanel_cpu_avg": "平均 CPU 占用",
  "serverPanel_cpu_user": "用户态",
  "serverPanel_cpu_system": "内核态",
  "serverPanel_cpu_iowait": "IO 等待",
  "serverPanel_cpu_load": "负载",
  "serverPanel_mem_title": "内存",
  "serverPanel_mem_physical": "物理内存",
  "serverPanel_mem_swap": "Swap",
  "serverPanel_net_title": "网络",
  "serverPanel_net_total_rx": "总下行",
  "serverPanel_net_total_tx": "总上行",
  "serverPanel_net_rate_rx": "实时下行",
  "serverPanel_net_rate_tx": "实时上行",
  "serverPanel_net_legend_cpu": "CPU",
  "serverPanel_net_legend_mem": "内存",
  "serverPanel_net_legend_tx": "上行",
  "serverPanel_net_legend_rx": "下行",
  "serverPanel_proc_title": "进程列表",
  "serverPanel_proc_col_process": "进程",
  "serverPanel_proc_col_pid": "Pid",
  "serverPanel_proc_col_cpu": "%CPU",
  "serverPanel_proc_col_mem": "内存",
  "serverPanel_proc_col_action": "操作",
  "serverPanel_proc_kill": "结束进程",
  "serverPanel_proc_kill_confirm_title": "结束进程",
  "serverPanel_proc_kill_confirm_body": "确定要结束进程 {{pid}} ({{name}}) 吗?",
  "serverPanel_proc_kill_confirm_ok": "结束",
  "serverPanel_proc_kill_confirm_cancel": "取消",
  "serverPanel_nic_title": "网卡信息",
  "serverPanel_nic_name": "名称",
  "serverPanel_nic_ipv4": "IPv4",
  "serverPanel_nic_mac": "MAC"
```

- [ ] **Step 3: Add en translations**

Edit `src/i18n/locales/gwshell.en.json` and add the matching English entries:

```json
  "serverPanel_toggle_title": "Show server panel",
  "serverPanel_ssh_only": "SSH sessions only",
  "serverPanel_close": "Close server panel",
  "serverPanel_title": "Server Panel",
  "serverPanel_status_loading": "Loading…",
  "serverPanel_status_disconnected": "Disconnected",
  "serverPanel_status_unsupported": "Linux remote required",
  "serverPanel_status_timeout": "Polling timed out — stopped",
  "serverPanel_status_no_ssh": "Switch to an SSH session",
  "serverPanel_host_user": "User",
  "serverPanel_host_host": "Host",
  "serverPanel_host_uptime": "Uptime",
  "serverPanel_host_system": "System",
  "serverPanel_cpu_title": "CPU",
  "serverPanel_cpu_avg": "Avg CPU usage",
  "serverPanel_cpu_user": "User",
  "serverPanel_cpu_system": "Kernel",
  "serverPanel_cpu_iowait": "IO wait",
  "serverPanel_cpu_load": "Load",
  "serverPanel_mem_title": "Memory",
  "serverPanel_mem_physical": "Physical",
  "serverPanel_mem_swap": "Swap",
  "serverPanel_net_title": "Network",
  "serverPanel_net_total_rx": "Total RX",
  "serverPanel_net_total_tx": "Total TX",
  "serverPanel_net_rate_rx": "Live RX",
  "serverPanel_net_rate_tx": "Live TX",
  "serverPanel_net_legend_cpu": "CPU",
  "serverPanel_net_legend_mem": "Mem",
  "serverPanel_net_legend_tx": "TX",
  "serverPanel_net_legend_rx": "RX",
  "serverPanel_proc_title": "Processes",
  "serverPanel_proc_col_process": "Process",
  "serverPanel_proc_col_pid": "PID",
  "serverPanel_proc_col_cpu": "%CPU",
  "serverPanel_proc_col_mem": "Memory",
  "serverPanel_proc_col_action": "Action",
  "serverPanel_proc_kill": "Kill",
  "serverPanel_proc_kill_confirm_title": "Kill process",
  "serverPanel_proc_kill_confirm_body": "Kill process {{pid}} ({{name}})?",
  "serverPanel_proc_kill_confirm_ok": "Kill",
  "serverPanel_proc_kill_confirm_cancel": "Cancel",
  "serverPanel_nic_title": "Network Interfaces",
  "serverPanel_nic_name": "Name",
  "serverPanel_nic_ipv4": "IPv4",
  "serverPanel_nic_mac": "MAC"
```

- [ ] **Step 4: Confirm `TranslationKeys` auto-derives (no manual edit needed)**

`src/i18n/index.ts` defines `export type TranslationKeys = keyof typeof gwshellZh`, so adding keys to `gwshell.zh.json` flows through automatically. No edit required — just confirm the line is still present:

```bash
grep -n "TranslationKeys = keyof" src/i18n/index.ts
```

Expected: one match.

- [ ] **Step 5: Type-check the frontend**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/stores/appStore.ts src/i18n/locales/gwshell.zh.json src/i18n/locales/gwshell.en.json
git commit -m "feat(server-panel): add appStore flag and i18n strings"
```

---

## Task 6: Shared `Sparkline` SVG component

**Files:**
- Create: `src/components/ServerPanel/Sparkline.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/ServerPanel/Sparkline.tsx`:

```tsx
import React, { useMemo } from 'react';

export interface SparkSeries {
  label: string;
  color: string;          // CSS color (hex, var(), etc.)
  data: number[];         // any range; each series is normalized independently
}

interface Props {
  series: SparkSeries[];
  width?: number;         // px
  height?: number;        // px
  className?: string;
}

/** Pure SVG multi-series sparkline. Each series self-normalizes to [0..1]. */
export const Sparkline: React.FC<Props> = ({
  series,
  width = 320,
  height = 80,
  className,
}) => {
  const paths = useMemo(() => {
    return series.map((s) => {
      const data = s.data;
      if (data.length < 2) return { d: '', color: s.color, label: s.label };
      const max = Math.max(...data, 1e-9);
      const min = Math.min(...data, 0);
      const range = max - min || 1;
      const step = width / (data.length - 1);
      const d = data
        .map((v, i) => {
          const x = i * step;
          const y = height - ((v - min) / range) * height;
          return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
        })
        .join(' ');
      return { d, color: s.color, label: s.label };
    });
  }, [series, width, height]);

  return (
    <svg
      className={className}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
    >
      {paths.map((p, i) => (
        <path key={i} d={p.d} fill="none" stroke={p.color} strokeWidth={1.5} />
      ))}
    </svg>
  );
};
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ServerPanel/Sparkline.tsx
git commit -m "feat(server-panel): add shared Sparkline SVG component"
```

---

## Task 7: `HostCard` + `NicList` (static/simple cards)

**Files:**
- Create: `src/components/ServerPanel/HostCard.tsx`
- Create: `src/components/ServerPanel/NicList.tsx`

- [ ] **Step 1: Create `HostCard.tsx`**

```tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { HostInfo } from '../../types/serverMetrics';

interface Props {
  host: HostInfo | null;
  hostIp: string;   // from session config, since the backend can't introspect it
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

export const HostCard: React.FC<Props> = ({ host, hostIp }) => {
  const { t } = useTranslation();
  const placeholder = '—';

  return (
    <div className="sp-card sp-card--host">
      <div className="sp-grid-2">
        <div className="sp-kv">
          <span className="sp-kv__k">{t('serverPanel_host_user')}</span>
          <span className="sp-kv__v">{host?.user || placeholder}</span>
        </div>
        <div className="sp-kv">
          <span className="sp-kv__k">{t('serverPanel_host_uptime')}</span>
          <span className="sp-kv__v">
            {host ? formatUptime(host.uptime_seconds) : placeholder}
          </span>
        </div>
        <div className="sp-kv">
          <span className="sp-kv__k">{t('serverPanel_host_host')}</span>
          <span className="sp-kv__v" title={hostIp}>{hostIp || placeholder}</span>
        </div>
        <div className="sp-kv">
          <span className="sp-kv__k">{t('serverPanel_host_system')}</span>
          <span className="sp-kv__v" title={host?.os_pretty ?? ''}>
            {host?.os_pretty || placeholder}
          </span>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Create `NicList.tsx`**

```tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { NicInfo } from '../../types/serverMetrics';

interface Props {
  nics: NicInfo[] | null;
}

export const NicList: React.FC<Props> = ({ nics }) => {
  const { t } = useTranslation();
  return (
    <div className="sp-card sp-card--nics">
      <div className="sp-card__title">{t('serverPanel_nic_title')}</div>
      {(!nics || nics.length === 0) ? (
        <div className="sp-empty">—</div>
      ) : (
        <table className="sp-table">
          <thead>
            <tr>
              <th>{t('serverPanel_nic_name')}</th>
              <th>{t('serverPanel_nic_ipv4')}</th>
              <th>{t('serverPanel_nic_mac')}</th>
            </tr>
          </thead>
          <tbody>
            {nics.map((n) => (
              <tr key={n.name}>
                <td>{n.name}</td>
                <td>{n.ipv4 ?? '—'}</td>
                <td>{n.mac ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
```

- [ ] **Step 3: Type-check and commit**

```bash
npx tsc --noEmit
git add src/components/ServerPanel/HostCard.tsx src/components/ServerPanel/NicList.tsx
git commit -m "feat(server-panel): add HostCard and NicList"
```

---

## Task 8: `CpuCard` with per-core bars

**Files:**
- Create: `src/components/ServerPanel/CpuCard.tsx`

- [ ] **Step 1: Write the component**

```tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { CpuStats } from '../../types/serverMetrics';

interface Props {
  cpu: CpuStats | null;
}

function fmt(n: number): string {
  return `${n.toFixed(1)}%`;
}

export const CpuCard: React.FC<Props> = ({ cpu }) => {
  const { t } = useTranslation();

  if (!cpu) {
    return (
      <div className="sp-card sp-card--cpu">
        <div className="sp-card__title">{t('serverPanel_cpu_title')}</div>
        <div className="sp-empty">—</div>
      </div>
    );
  }

  return (
    <div className="sp-card sp-card--cpu">
      <div className="sp-grid-4">
        <div className="sp-stat">
          <span className="sp-stat__label">{t('serverPanel_cpu_avg')}</span>
          <span className="sp-stat__value">{fmt(cpu.total_percent)}</span>
        </div>
        <div className="sp-stat">
          <span className="sp-stat__label">{t('serverPanel_cpu_user')}</span>
          <span className="sp-stat__value">{fmt(cpu.user_percent)}</span>
        </div>
        <div className="sp-stat">
          <span className="sp-stat__label">{t('serverPanel_cpu_system')}</span>
          <span className="sp-stat__value">{fmt(cpu.system_percent)}</span>
        </div>
        <div className="sp-stat">
          <span className="sp-stat__label">{t('serverPanel_cpu_iowait')}</span>
          <span className="sp-stat__value">{fmt(cpu.iowait_percent)}</span>
        </div>
      </div>
      <div className="sp-corelist">
        {cpu.per_core.map((p, i) => (
          <div key={i} className="sp-corerow">
            <span className="sp-corerow__name">CPU{i + 1}</span>
            <span className="sp-corerow__bar">
              <span
                className="sp-corerow__bar-fill"
                style={{ width: `${Math.min(100, Math.max(0, p))}%` }}
              />
            </span>
            <span className="sp-corerow__pct">{fmt(p)}</span>
          </div>
        ))}
      </div>
      <div className="sp-loadavg">
        <span>{t('serverPanel_cpu_load')}:</span>
        <span>{cpu.loadavg_1m.toFixed(2)}</span>
        <span>{cpu.loadavg_5m.toFixed(2)}</span>
        <span>{cpu.loadavg_15m.toFixed(2)}</span>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Type-check and commit**

```bash
npx tsc --noEmit
git add src/components/ServerPanel/CpuCard.tsx
git commit -m "feat(server-panel): add CpuCard with per-core bars"
```

---

## Task 9: `MemCard`

**Files:**
- Create: `src/components/ServerPanel/MemCard.tsx`

- [ ] **Step 1: Write the component**

```tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { MemStats } from '../../types/serverMetrics';

interface Props {
  mem: MemStats | null;
}

function fmtBytes(bytes: number): string {
  if (!bytes) return '0B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)}${units[u]}`;
}

function bar(used: number, total: number): { pct: number; label: string } {
  if (total <= 0) return { pct: 0, label: '—' };
  const pct = Math.min(100, Math.max(0, (used / total) * 100));
  return { pct, label: `${fmtBytes(used)}/${fmtBytes(total)}` };
}

export const MemCard: React.FC<Props> = ({ mem }) => {
  const { t } = useTranslation();

  if (!mem) {
    return (
      <div className="sp-card sp-card--mem">
        <div className="sp-card__title">{t('serverPanel_mem_title')}</div>
        <div className="sp-empty">—</div>
      </div>
    );
  }

  const ram = bar(mem.mem_used_bytes, mem.mem_total_bytes);
  const swap = bar(mem.swap_used_bytes, mem.swap_total_bytes);

  return (
    <div className="sp-card sp-card--mem">
      <div className="sp-membar">
        <div className="sp-membar__head">
          <span>{t('serverPanel_mem_physical')}</span>
          <span>{ram.label}</span>
        </div>
        <div className="sp-membar__track">
          <div className="sp-membar__fill sp-membar__fill--ram" style={{ width: `${ram.pct}%` }} />
        </div>
      </div>
      <div className="sp-membar">
        <div className="sp-membar__head">
          <span>{t('serverPanel_mem_swap')}</span>
          <span>{swap.label}</span>
        </div>
        <div className="sp-membar__track">
          <div className="sp-membar__fill sp-membar__fill--swap" style={{ width: `${swap.pct}%` }} />
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Type-check and commit**

```bash
npx tsc --noEmit
git add src/components/ServerPanel/MemCard.tsx
git commit -m "feat(server-panel): add MemCard with RAM and swap bars"
```

---

## Task 10: `NetCard` with multi-series sparkline

**Files:**
- Create: `src/components/ServerPanel/NetCard.tsx`

- [ ] **Step 1: Write the component**

```tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { NetStats } from '../../types/serverMetrics';
import { Sparkline, type SparkSeries } from './Sparkline';

interface Props {
  net: NetStats | null;
  cpuHistory: number[];
  memHistory: number[];
  rxHistory: number[];
  txHistory: number[];
}

function fmtBytes(bytes: number): string {
  if (!bytes) return '0B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)}${units[u]}`;
}

function fmtRate(bps: number): string {
  return `${fmtBytes(bps)}/s`;
}

export const NetCard: React.FC<Props> = ({ net, cpuHistory, memHistory, rxHistory, txHistory }) => {
  const { t } = useTranslation();

  const series: SparkSeries[] = [
    { label: t('serverPanel_net_legend_cpu'), color: '#3b82f6', data: cpuHistory },
    { label: t('serverPanel_net_legend_mem'), color: '#22c55e', data: memHistory },
    { label: t('serverPanel_net_legend_tx'), color: '#f59e0b', data: txHistory },
    { label: t('serverPanel_net_legend_rx'), color: '#10b981', data: rxHistory },
  ];

  return (
    <div className="sp-card sp-card--net">
      <div className="sp-grid-2">
        <div className="sp-kv">
          <span className="sp-kv__k">{t('serverPanel_net_total_tx')}</span>
          <span className="sp-kv__v">{net ? fmtBytes(net.total_tx_bytes) : '—'}</span>
        </div>
        <div className="sp-kv">
          <span className="sp-kv__k">{t('serverPanel_net_total_rx')}</span>
          <span className="sp-kv__v">{net ? fmtBytes(net.total_rx_bytes) : '—'}</span>
        </div>
        <div className="sp-kv">
          <span className="sp-kv__k">{t('serverPanel_net_rate_tx')}</span>
          <span className="sp-kv__v">{net ? fmtRate(net.tx_bytes_per_sec) : '—'}</span>
        </div>
        <div className="sp-kv">
          <span className="sp-kv__k">{t('serverPanel_net_rate_rx')}</span>
          <span className="sp-kv__v">{net ? fmtRate(net.rx_bytes_per_sec) : '—'}</span>
        </div>
      </div>
      <div className="sp-legend">
        {series.map((s) => (
          <span key={s.label} className="sp-legend__item">
            <span className="sp-legend__dot" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <Sparkline series={series} width={340} height={80} className="sp-sparkline" />
    </div>
  );
};
```

- [ ] **Step 2: Type-check and commit**

```bash
npx tsc --noEmit
git add src/components/ServerPanel/NetCard.tsx
git commit -m "feat(server-panel): add NetCard with multi-series sparkline"
```

---

## Task 11: `ProcessList` with remote kill

**Files:**
- Create: `src/components/ServerPanel/ProcessList.tsx`

- [ ] **Step 1: Write the component**

```tsx
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { X } from 'lucide-react';
import type { ProcInfo } from '../../types/serverMetrics';

interface Props {
  sessionId: string;
  procs: ProcInfo[] | null;
}

function fmtKb(kb: number): string {
  if (kb < 1024) return `${kb}KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)}MB`;
  return `${(mb / 1024).toFixed(2)}GB`;
}

// Inline two-click confirm: first click arms (tracked in `armedPid`), second
// click within 3 seconds actually sends the kill. No global modal needed, and
// avoids relying on window.confirm (unused elsewhere in this codebase).
export const ProcessList: React.FC<Props> = ({ sessionId, procs }) => {
  const { t } = useTranslation();
  const [pending, setPending] = useState<Set<number>>(new Set());
  const [armedPid, setArmedPid] = useState<number | null>(null);

  const handleKillClick = async (p: ProcInfo) => {
    if (armedPid !== p.pid) {
      setArmedPid(p.pid);
      setTimeout(() => {
        setArmedPid((cur) => (cur === p.pid ? null : cur));
      }, 3000);
      return;
    }
    setArmedPid(null);
    setPending((prev) => new Set(prev).add(p.pid));
    try {
      await invoke('kill_remote_process', { sessionId, pid: p.pid });
    } catch (e) {
      console.warn('kill_remote_process failed', e);
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(p.pid);
        return next;
      });
    }
  };

  return (
    <div className="sp-card sp-card--procs">
      <div className="sp-card__title">{t('serverPanel_proc_title')}</div>
      {(!procs || procs.length === 0) ? (
        <div className="sp-empty">—</div>
      ) : (
        <table className="sp-table sp-table--procs">
          <thead>
            <tr>
              <th>{t('serverPanel_proc_col_process')}</th>
              <th>{t('serverPanel_proc_col_pid')}</th>
              <th>{t('serverPanel_proc_col_cpu')}</th>
              <th>{t('serverPanel_proc_col_mem')}</th>
              <th>{t('serverPanel_proc_col_action')}</th>
            </tr>
          </thead>
          <tbody>
            {procs.map((p) => (
              <tr key={p.pid}>
                <td title={p.comm}>{p.comm}</td>
                <td>{p.pid}</td>
                <td>{p.cpu_percent.toFixed(1)}%</td>
                <td>{fmtKb(p.rss_kb)}</td>
                <td>
                  <button
                    className={`sp-kill-btn${armedPid === p.pid ? ' sp-kill-btn--armed' : ''}`}
                    disabled={pending.has(p.pid)}
                    onClick={() => handleKillClick(p)}
                    title={
                      armedPid === p.pid
                        ? t('serverPanel_proc_kill_confirm_body', { pid: p.pid, name: p.comm })
                        : t('serverPanel_proc_kill')
                    }
                  >
                    <X size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Type-check and commit**

```bash
npx tsc --noEmit
git add src/components/ServerPanel/ProcessList.tsx
git commit -m "feat(server-panel): add ProcessList with remote kill"
```

---

## Task 12: `ServerPanel` drawer container + CSS

**Files:**
- Create: `src/components/ServerPanel/ServerPanel.tsx`
- Create: `src/components/ServerPanel/ServerPanel.css`
- Create: `src/components/ServerPanel/index.ts`

- [ ] **Step 1: Write the container**

Create `src/components/ServerPanel/ServerPanel.tsx`:

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import type {
  MetricsSnapshot,
  MetricsErrorPayload,
} from '../../types/serverMetrics';
import { HostCard } from './HostCard';
import { CpuCard } from './CpuCard';
import { MemCard } from './MemCard';
import { NetCard } from './NetCard';
import { ProcessList } from './ProcessList';
import { NicList } from './NicList';
import './ServerPanel.css';

const HISTORY_LEN = 60;

type Status = 'loading' | 'ok' | 'error' | 'no-ssh';

function pushHistory(arr: number[], v: number): number[] {
  const next = arr.length >= HISTORY_LEN ? arr.slice(1) : arr.slice();
  next.push(v);
  return next;
}

export const ServerPanel: React.FC = () => {
  const { t } = useTranslation();
  const { serverPanelOpen, toggleServerPanel, tabs, activeTabId, sessions } = useAppStore();

  const activeTab = tabs.find((tt) => tt.id === activeTabId);
  const activeSession = sessions.find((s) => s.id === activeTab?.sessionId);
  const isSsh = activeTab?.type === 'ssh';
  const sessionId = isSsh ? activeTab!.sessionId : null;
  const hostIp = activeSession ? `${activeSession.host ?? ''}${activeSession.port ? `:${activeSession.port}` : ''}` : '';

  const [snapshot, setSnapshot] = useState<MetricsSnapshot | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const cpuHistoryRef = useRef<number[]>([]);
  const memHistoryRef = useRef<number[]>([]);
  const rxHistoryRef = useRef<number[]>([]);
  const txHistoryRef = useRef<number[]>([]);
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (!serverPanelOpen) return;
    if (!sessionId) {
      setStatus('no-ssh');
      setSnapshot(null);
      return;
    }

    setStatus('loading');
    setSnapshot(null);
    setErrorBanner(null);
    cpuHistoryRef.current = [];
    memHistoryRef.current = [];
    rxHistoryRef.current = [];
    txHistoryRef.current = [];

    let dataUnlisten: UnlistenFn | null = null;
    let errUnlisten: UnlistenFn | null = null;
    let cancelled = false;

    (async () => {
      try {
        await invoke('start_server_metrics', { sessionId });
      } catch (e) {
        if (cancelled) return;
        setStatus('error');
        setErrorBanner(String(e));
        return;
      }

      dataUnlisten = await listen<MetricsSnapshot>(
        `server-metrics-${sessionId}`,
        (evt) => {
          const snap = evt.payload;
          setSnapshot(snap);
          setStatus('ok');
          if (snap.cpu) {
            cpuHistoryRef.current = pushHistory(cpuHistoryRef.current, snap.cpu.total_percent);
          }
          if (snap.mem && snap.mem.mem_total_bytes > 0) {
            const pct = (snap.mem.mem_used_bytes / snap.mem.mem_total_bytes) * 100;
            memHistoryRef.current = pushHistory(memHistoryRef.current, pct);
          }
          if (snap.net) {
            rxHistoryRef.current = pushHistory(rxHistoryRef.current, snap.net.rx_bytes_per_sec);
            txHistoryRef.current = pushHistory(txHistoryRef.current, snap.net.tx_bytes_per_sec);
          }
          forceRender((n) => n + 1);
        }
      );

      errUnlisten = await listen<MetricsErrorPayload>(
        `server-metrics-error-${sessionId}`,
        (evt) => {
          const p = evt.payload;
          setStatus('error');
          if (p.reason === 'unsupported') setErrorBanner(t('serverPanel_status_unsupported'));
          else if (p.reason === 'timeout') setErrorBanner(t('serverPanel_status_timeout'));
          else setErrorBanner(t('serverPanel_status_disconnected'));
        }
      );
    })();

    return () => {
      cancelled = true;
      if (dataUnlisten) dataUnlisten();
      if (errUnlisten) errUnlisten();
      invoke('stop_server_metrics', { sessionId }).catch(() => {});
    };
  }, [serverPanelOpen, sessionId, t]);

  if (!serverPanelOpen) return null;

  const greyed = status === 'error';

  return (
    <div className="sp-drawer" role="dialog" aria-label={t('serverPanel_title')}>
      <div className="sp-header">
        <div className="sp-header__title">{t('serverPanel_title')}</div>
        <button className="sp-header__close" onClick={toggleServerPanel} title={t('serverPanel_close')}>
          <X size={16} />
        </button>
      </div>

      {status === 'no-ssh' && (
        <div className="sp-banner sp-banner--info">{t('serverPanel_status_no_ssh')}</div>
      )}
      {status === 'loading' && (
        <div className="sp-banner sp-banner--info">{t('serverPanel_status_loading')}</div>
      )}
      {errorBanner && (
        <div className="sp-banner sp-banner--error">{errorBanner}</div>
      )}

      <div className={`sp-body ${greyed ? 'sp-body--greyed' : ''}`}>
        {status !== 'no-ssh' && (
          <>
            <HostCard host={snapshot?.host ?? null} hostIp={hostIp} />
            <CpuCard cpu={snapshot?.cpu ?? null} />
            <MemCard mem={snapshot?.mem ?? null} />
            <NetCard
              net={snapshot?.net ?? null}
              cpuHistory={cpuHistoryRef.current}
              memHistory={memHistoryRef.current}
              rxHistory={rxHistoryRef.current}
              txHistory={txHistoryRef.current}
            />
            <ProcessList sessionId={sessionId ?? ''} procs={snapshot?.procs ?? null} />
            <NicList nics={snapshot?.nics ?? null} />
          </>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Write the CSS**

Create `src/components/ServerPanel/ServerPanel.css`:

```css
.sp-drawer {
  position: fixed;
  top: 32px;                    /* below titlebar */
  right: 0;
  bottom: 0;
  width: 380px;
  z-index: 900;
  background: var(--bg-secondary, #1e1e1e);
  border-left: 1px solid var(--border-color, #2a2a2a);
  color: var(--text-primary, #e5e5e5);
  display: flex;
  flex-direction: column;
  animation: sp-slide-in 0.2s ease-out;
  box-shadow: -4px 0 20px rgba(0, 0, 0, 0.3);
  overflow: hidden;
}
@keyframes sp-slide-in {
  from { transform: translateX(100%); }
  to   { transform: translateX(0); }
}

.sp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-color, #2a2a2a);
  font-size: 14px;
  font-weight: 600;
}
.sp-header__close {
  background: transparent;
  border: 0;
  color: inherit;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
}
.sp-header__close:hover {
  background: var(--bg-hover, rgba(255,255,255,0.08));
}

.sp-banner {
  padding: 6px 14px;
  font-size: 12px;
}
.sp-banner--info { background: rgba(59, 130, 246, 0.12); color: #93c5fd; }
.sp-banner--error { background: rgba(239, 68, 68, 0.12); color: #fca5a5; }

.sp-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sp-body--greyed { opacity: 0.55; }

.sp-card {
  background: var(--bg-primary, #161616);
  border: 1px solid var(--border-color, #2a2a2a);
  border-radius: 6px;
  padding: 10px 12px;
}
.sp-card__title {
  font-size: 12px;
  color: var(--text-secondary, #a3a3a3);
  margin-bottom: 8px;
}
.sp-empty { font-size: 12px; color: var(--text-secondary, #a3a3a3); }

.sp-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 14px;
}
.sp-grid-4 {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px 10px;
}
.sp-kv { display: flex; flex-direction: column; font-size: 12px; }
.sp-kv__k { color: var(--text-secondary, #a3a3a3); }
.sp-kv__v { color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.sp-stat { display: flex; flex-direction: column; align-items: flex-start; }
.sp-stat__label { font-size: 11px; color: var(--text-secondary); }
.sp-stat__value { font-size: 14px; font-weight: 600; }

.sp-corelist { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
.sp-corerow { display: grid; grid-template-columns: 40px 1fr 48px; gap: 6px; align-items: center; font-size: 11px; }
.sp-corerow__bar {
  display: block;
  height: 8px;
  background: var(--bg-secondary, #2a2a2a);
  border-radius: 4px;
  overflow: hidden;
}
.sp-corerow__bar-fill {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #22c55e, #3b82f6);
}
.sp-corerow__pct { text-align: right; color: var(--text-secondary); }

.sp-loadavg { margin-top: 8px; font-size: 11px; color: var(--text-secondary); display: flex; gap: 10px; }

.sp-membar { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
.sp-membar__head { display: flex; justify-content: space-between; font-size: 11px; color: var(--text-secondary); }
.sp-membar__track { height: 10px; background: var(--bg-secondary); border-radius: 5px; overflow: hidden; }
.sp-membar__fill { height: 100%; }
.sp-membar__fill--ram { background: linear-gradient(90deg, #3b82f6, #22c55e); }
.sp-membar__fill--swap { background: linear-gradient(90deg, #f59e0b, #ef4444); }

.sp-legend { display: flex; gap: 10px; font-size: 11px; color: var(--text-secondary); margin: 8px 0 2px; }
.sp-legend__item { display: inline-flex; align-items: center; gap: 4px; }
.sp-legend__dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
.sp-sparkline { width: 100%; height: 80px; }

.sp-table { width: 100%; font-size: 11px; border-collapse: collapse; }
.sp-table th, .sp-table td { text-align: left; padding: 3px 6px; }
.sp-table thead th { color: var(--text-secondary); font-weight: 500; border-bottom: 1px solid var(--border-color); }
.sp-table tbody tr:hover { background: var(--bg-hover, rgba(255,255,255,0.04)); }

.sp-kill-btn {
  background: transparent;
  border: 1px solid var(--border-color);
  color: #ef4444;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
}
.sp-kill-btn:disabled { opacity: 0.4; cursor: default; }
.sp-kill-btn:hover:not(:disabled) { background: rgba(239, 68, 68, 0.12); }
.sp-kill-btn--armed { background: rgba(239, 68, 68, 0.25); border-color: #ef4444; animation: sp-pulse 0.8s ease-in-out infinite alternate; }
@keyframes sp-pulse { from { box-shadow: 0 0 0 0 rgba(239,68,68,0.5); } to { box-shadow: 0 0 0 4px rgba(239,68,68,0); } }
```

- [ ] **Step 3: Write the index**

Create `src/components/ServerPanel/index.ts`:

```ts
export { ServerPanel } from './ServerPanel';
```

- [ ] **Step 4: Type-check and commit**

```bash
npx tsc --noEmit
git add src/components/ServerPanel/ServerPanel.tsx src/components/ServerPanel/ServerPanel.css src/components/ServerPanel/index.ts
git commit -m "feat(server-panel): add ServerPanel drawer container"
```

---

## Task 13: TitleBar button + App.tsx mount

**Files:**
- Modify: `src/components/TitleBar/TitleBar.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add button to `TitleBar`**

Rewrite `src/components/TitleBar/TitleBar.tsx` as:

```tsx
import React from 'react';
import { Minus, Square, X, Activity } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';

// Cache the window reference at module level so the first click
// doesn't pay the initialization cost of creating a new Window object.
const appWindow = getCurrentWindow();

export const TitleBar: React.FC = () => {
  const { t } = useTranslation();
  const { tabs, activeTabId, serverPanelOpen, toggleServerPanel } = useAppStore();
  const activeTab = tabs.find((tt) => tt.id === activeTabId);
  const sshActive = activeTab?.type === 'ssh';

  const handleMinimize = () => appWindow.minimize();
  const handleMaximize = () => appWindow.toggleMaximize();
  const handleClose = () => appWindow.close();

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-title" data-tauri-drag-region>
        GWShell
      </div>
      <div className="titlebar-center" data-tauri-drag-region />
      <div className="titlebar-controls">
        <button
          className={`titlebar-btn${serverPanelOpen ? ' titlebar-btn--active' : ''}`}
          onClick={() => { if (sshActive) toggleServerPanel(); }}
          disabled={!sshActive}
          title={sshActive ? t('serverPanel_toggle_title') : t('serverPanel_ssh_only')}
          data-gw-action="toggle_server_panel"
        >
          <Activity size={14} />
        </button>
        <button className="titlebar-btn" onClick={handleMinimize} data-gw-action="minimize" title={t('titlebar_minimize')}>
          <Minus size={14} />
        </button>
        <button className="titlebar-btn" onClick={handleMaximize} data-gw-action="toggle_maximize" title={t('titlebar_maximize')}>
          <Square size={10} />
        </button>
        <button className="titlebar-btn titlebar-close" onClick={handleClose} data-gw-action="hide" title={t('titlebar_close')}>
          <X size={14} />
        </button>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Mount `ServerPanel` in `App.tsx`**

Edit `src/App.tsx`. Near the other lazy imports (around line 31), add:

```tsx
const ServerPanel = lazy(() => import('./components/ServerPanel').then((m) => ({ default: m.ServerPanel })));
```

Then near the bottom, inside the `<Suspense fallback={null}>` block where `AutoModeLogPanel` is rendered, add `<ServerPanel />`:

```tsx
        <Suspense fallback={null}>
          {showNewSession && <NewSessionModal />}
          {showDockerModal && <DockerModal />}
          {showLocalTerminalModal && <LocalTerminalModal />}
          {showSerialModal && <SerialPortModal />}
          {showSettings && <SettingsModal />}
          {showAppMenu && <AppMenu />}
          <UpdateChecker />
          <AutoModeLogPanel />
          <ServerPanel />
        </Suspense>
```

(`ServerPanel` itself renders `null` when `serverPanelOpen` is false, so it's safe to keep mounted.)

- [ ] **Step 3: Optional: add a `titlebar-btn--active` style rule**

If `titlebar-btn--active` isn't already styled, add to `src/styles/global.css` (search for `.titlebar-btn` and add next to it):

```css
.titlebar-btn--active {
  background: var(--accent-subtle, rgba(59, 130, 246, 0.15));
  color: var(--accent, #60a5fa);
}
.titlebar-btn:disabled { opacity: 0.4; cursor: default; }
```

- [ ] **Step 4: Type-check, smoke-check, commit**

```bash
npx tsc --noEmit
npm run smoke:check
```

Both should pass. Commit:

```bash
git add src/components/TitleBar/TitleBar.tsx src/App.tsx src/styles/global.css
git commit -m "feat(server-panel): add TitleBar toggle and mount drawer in App"
```

---

## Task 14: Smoke-check assertions + manual verification

**Files:**
- Modify: `scripts/stability-smoke.mjs`

- [ ] **Step 1: Extend smoke-check with three new assertions**

Edit `scripts/stability-smoke.mjs`. After the existing `const missingCommands = ...` block (around line 111), add:

```js
// ---- Server Panel wiring ----

const serverPanelPath = path.join(srcRoot, 'components', 'ServerPanel', 'ServerPanel.tsx');
if (!fs.existsSync(serverPanelPath)) {
  fail('Missing src/components/ServerPanel/ServerPanel.tsx');
} else {
  const text = readText(serverPanelPath);
  if (!/invoke\(\s*['"`]stop_server_metrics['"`]/.test(text)) {
    fail('ServerPanel.tsx useEffect cleanup must invoke stop_server_metrics');
  }
}

const metricsPath = path.join(tauriRoot, 'metrics.rs');
if (!fs.existsSync(metricsPath)) {
  fail('Missing src-tauri/src/metrics.rs');
} else {
  const text = readText(metricsPath);
  if (!/timeout\(\s*Duration::from_secs\(\s*5\s*\)/.test(text)) {
    fail('metrics.rs polling loop must wrap ssh_exec in a 5s timeout');
  }
}

for (const cmd of ['start_server_metrics', 'stop_server_metrics', 'kill_remote_process']) {
  if (!backendCommands.includes(cmd)) {
    fail(`Backend invoke_handler is missing ${cmd}`);
  }
}
```

- [ ] **Step 2: Run smoke-check — expect PASS**

```bash
npm run smoke:check
```

Expected: `Result: PASS`. If any assertion fails, the message tells you exactly what is missing — fix in the referenced file and re-run.

- [ ] **Step 3: Run full typecheck + build**

```bash
npm run build
cd src-tauri && cargo check && cd ..
```

Expected: both succeed.

- [ ] **Step 4: Manual acceptance checklist**

Spin up the app and go through the list from the spec §8.2. Document findings in the commit message.

Run:

```bash
npm run tauri dev
```

Then verify:

1. Connect to a Linux SSH session; click the Activity icon in the TitleBar — panel opens, cards populate within 2 seconds.
2. On the remote, run `ss -tn sport = :22 | wc -l` before opening panel and after closing — counts match (no lingering aux channel).
3. Open two SSH sessions in different tabs; switch between them — panel follows the active tab.
4. On the remote, run `yes > /dev/null` for a few seconds — CPU card rises, sparkline shows a peak, per-core bars fill.
5. On the remote, `exit` — panel greys out and shows "Disconnected".
6. Connect to a non-Linux host (macOS or Windows SSH) — panel shows "Linux remote required".
7. Click the kill button on a process you control (e.g. a `sleep 300` you launched) — it disappears from the next snapshot.
8. Toggle light/dark theme with panel open — panel styling tracks the theme.
9. Switch between zh and en — all panel strings translate.
10. Close the app, reopen it — panel starts closed (not persisted).

- [ ] **Step 5: Commit**

```bash
git add scripts/stability-smoke.mjs
git commit -m "feat(server-panel): add smoke-check assertions and finish wiring"
```

---

## Done

After all 14 tasks, the Server Panel is feature-complete against the spec. Remaining future work is listed in spec §9 (out of scope).
