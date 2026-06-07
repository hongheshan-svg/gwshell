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

#[derive(Debug, Serialize, Clone, Default)]
pub struct DiskStats {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub mount: String,
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
    pub disk: Option<DiskStats>,
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
        self.user
            + self.nice
            + self.system
            + self.idle
            + self.iowait
            + self.irq
            + self.softirq
            + self.steal
    }
    pub fn active(&self) -> u64 {
        self.total()
            .saturating_sub(self.idle)
            .saturating_sub(self.iowait)
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
        } else if line.starts_with("cpu")
            && line
                .chars()
                .nth(3)
                .map(|c| c.is_ascii_digit())
                .unwrap_or(false)
        {
            if let Some(t) = parse_cpu_line(line) {
                cores.push(t);
            }
        }
    }
    Some((total?, cores))
}

/// Parse /proc/meminfo into MemStats.
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
            "MemTotal:" => total_kb = val,
            "MemAvailable:" => avail_kb = val,
            "SwapTotal:" => swap_total_kb = val,
            "SwapFree:" => swap_free_kb = val,
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

/// Parse output of `ps -eo pid,%cpu,%mem,rss,comm --sort=-%cpu | head -21`.
/// `comm` is placed LAST so process names containing spaces are captured intact
/// (the old `comm` second-column layout dropped/misaligned such rows).
/// Skips the header line. Returns up to 20 rows.
pub fn parse_ps(text: &str) -> Vec<ProcInfo> {
    text.lines()
        .skip(1)
        .filter_map(|line| {
            let mut parts = line.split_ascii_whitespace();
            let pid: u32 = parts.next()?.parse().ok()?;
            let cpu: f64 = parts.next()?.parse().ok()?;
            let mem: f64 = parts.next()?.parse().ok()?;
            let rss: u64 = parts.next()?.parse().ok()?;
            // comm is the trailing field and may contain whitespace.
            let comm: String = parts.collect::<Vec<_>>().join(" ");
            if comm.is_empty() {
                return None;
            }
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
    let nums: Vec<f64> = text
        .split_ascii_whitespace()
        .take(3)
        .filter_map(|s| s.parse().ok())
        .collect();
    match nums.len() {
        3 => (nums[0], nums[1], nums[2]),
        _ => (0.0, 0.0, 0.0),
    }
}

/// Parse `df -kP /` output (header + one data row). Sizes are KiB.
pub fn parse_df(text: &str) -> Option<DiskStats> {
    let line = text.lines().nth(1)?; // skip header
    let cols: Vec<&str> = line.split_whitespace().collect();
    if cols.len() < 6 {
        return None;
    }
    let total_kb: u64 = cols[1].parse().ok()?;
    let used_kb: u64 = cols[2].parse().ok()?;
    let mount = cols[cols.len() - 1].to_string();
    Some(DiskStats {
        total_bytes: total_kb.saturating_mul(1024),
        used_bytes: used_kb.saturating_mul(1024),
        mount,
    })
}

/// Parse `ip -o -4 addr show` lines for ipv4 per interface.
pub fn parse_ip_addr(text: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.split_ascii_whitespace().collect();
        if parts.len() < 4 {
            continue;
        }
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
        if parts.len() < 2 {
            continue;
        }
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
    if total_d <= 0.0 {
        0.0
    } else {
        (100.0 * active_d / total_d).clamp(0.0, 100.0)
    }
}

pub fn cpu_breakdown(prev: CpuTimes, cur: CpuTimes) -> (f64, f64, f64) {
    let total_d = cur.total().saturating_sub(prev.total()) as f64;
    if total_d <= 0.0 {
        return (0.0, 0.0, 0.0);
    }
    let u = (cur.user.saturating_sub(prev.user) + cur.nice.saturating_sub(prev.nice)) as f64;
    let s = cur.system.saturating_sub(prev.system) as f64;
    let w = cur.iowait.saturating_sub(prev.iowait) as f64;
    (
        100.0 * u / total_d,
        100.0 * s / total_d,
        100.0 * w / total_d,
    )
}

// ---- Tests ----

#[cfg(test)]
mod tests {
    use super::*;

    /// End-to-end parse of the full Server-panel probe against REAL `/proc`
    /// output captured from a Linux host (Debian bookworm, via Docker). Drives
    /// two samples through `build_snapshot` so the CPU% and byte-rate deltas
    /// are actually exercised — this is the data the Server panel renders.
    #[test]
    fn build_snapshot_parses_real_linux_proc_capture() {
        let s1 = include_str!("testdata/proc_sample1.txt");
        let s2 = include_str!("testdata/proc_sample2.txt");
        let last = Arc::new(Mutex::new(StdHashMap::new()));
        let static_host = Arc::new(Mutex::new(StdHashMap::new()));
        let sid = "test-session";

        // First sample primes the CPU-jiffie / net-byte baselines.
        let _ = build_snapshot(s1, sid, &last, &static_host);
        // Second sample (captured ~2s later) yields real deltas.
        let snap = build_snapshot(s2, sid, &last, &static_host);

        let cpu = snap.cpu.expect("CPU section parsed");
        assert!(
            (0.0..=100.0).contains(&cpu.total_percent),
            "cpu total% in range, got {}",
            cpu.total_percent
        );
        assert!(!cpu.per_core.is_empty(), "per-core CPU parsed");

        let mem = snap.mem.expect("MEM section parsed");
        assert!(mem.mem_total_bytes > 0, "mem total > 0");
        assert!(
            mem.mem_used_bytes > 0 && mem.mem_used_bytes <= mem.mem_total_bytes,
            "mem used in (0, total]"
        );

        assert!(snap.net.is_some(), "NET section parsed");

        let procs = snap.procs.expect("PROC section parsed");
        assert!(!procs.is_empty(), "process list non-empty");

        let nics = snap.nics.expect("NIC section parsed");
        assert!(!nics.is_empty(), "NIC list non-empty");
    }

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
    fn parses_meminfo_totals() {
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
        let text = "    PID %CPU %MEM   RSS COMMAND\n   1234  5.0  1.2 20480 bash\n   5678  2.0  0.5 10240 sshd\n";
        let v = parse_ps(text);
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].pid, 1234);
        assert_eq!(v[0].comm, "bash");
        assert!((v[0].cpu_percent - 5.0).abs() < 1e-6);
    }

    #[test]
    fn parses_ps_comm_with_spaces() {
        let text = "    PID %CPU %MEM   RSS COMMAND\n   42  1.0  0.1  2048 my worker\n";
        let v = parse_ps(text);
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].comm, "my worker");
    }

    #[test]
    fn parses_os_pretty_name() {
        let text = "NAME=\"Ubuntu\"\nVERSION_ID=\"24.04\"\nPRETTY_NAME=\"Ubuntu 24.04.4 LTS\"\nID=ubuntu\n";
        assert_eq!(parse_os_pretty(text), "Ubuntu 24.04.4 LTS");
    }

    #[test]
    fn parses_loadavg_triple() {
        assert_eq!(
            parse_loadavg("0.12 0.34 0.56 1/123 4567\n"),
            (0.12, 0.34, 0.56)
        );
    }

    #[test]
    fn parses_df_output() {
        let text = "Filesystem     1024-blocks     Used Available Capacity Mounted on\n/dev/sda1         41251136 12345678  26800000      32% /\n";
        let d = parse_df(text).expect("parse_df should succeed");
        assert_eq!(d.total_bytes, 41251136u64 * 1024);
        assert_eq!(d.used_bytes, 12345678u64 * 1024);
        assert_eq!(d.mount, "/");
    }

    #[test]
    fn parse_df_returns_none_on_header_only() {
        let text = "Filesystem     1024-blocks     Used Available Capacity Mounted on\n";
        assert!(parse_df(text).is_none());
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
        let prev = CpuTimes {
            idle: 100,
            ..Default::default()
        };
        let cur = CpuTimes {
            idle: 200,
            ..Default::default()
        };
        assert_eq!(cpu_percent(prev, cur), 0.0);
    }

    #[test]
    fn cpu_percent_is_hundred_on_full_load() {
        let prev = CpuTimes {
            user: 0,
            idle: 100,
            ..Default::default()
        };
        let cur = CpuTimes {
            user: 100,
            idle: 100,
            ..Default::default()
        };
        assert_eq!(cpu_percent(prev, cur), 100.0);
    }
}

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
    pub fn start(&self, session_id: String, ssh: Arc<SshManager>, app: AppHandle) {
        let mut tasks = self.tasks.lock();
        if tasks
            .get(&session_id)
            .is_some_and(|handle| handle.is_finished())
        {
            tasks.remove(&session_id);
        }
        if tasks.contains_key(&session_id) {
            return;
        }
        let last = self.last.clone();
        let static_host = self.static_host.clone();
        let sid = session_id.clone();

        let handle = tokio::spawn(async move {
            let static_cmd = r#"
echo '---HOST---'
whoami
hostname
uname -sr
cat /etc/os-release 2>/dev/null
nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || grep -c '^processor' /proc/cpuinfo 2>/dev/null || echo 1
grep '^model name' /proc/cpuinfo | head -1
echo '---HOSTEND---'
"#;
            // Bound the very first probe too. Without this, an early half-open
            // connection hangs the poller forever — the per-tick timeout in the
            // loop below never gets a chance to run, and the Server panel shows
            // neither data nor an error.
            let static_out =
                match timeout(Duration::from_secs(8), ssh.metrics_exec(&sid, static_cmd)).await {
                    Ok(result) => result,
                    Err(_) => {
                        let _ = app.emit(
                            &format!("server-metrics-error-{}", sid),
                            serde_json::json!({ "reason": "timeout" }),
                        );
                        return;
                    }
                };

            match static_out {
                Ok(text) => {
                    let host = parse_static_host(&text);
                    // Metrics read from /proc, which only exists on Linux. Detect a
                    // genuinely unsupported host from the kernel string rather than
                    // cpu_cores==0 — the latter wrongly rejected minimal Linux boxes
                    // that lack the `nproc` binary.
                    if !host.kernel.to_lowercase().contains("linux") {
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

            let mut consecutive_timeouts: u32 = 0;
            loop {
                let probe = r#"
echo '---STAT---';   cat /proc/stat
echo '---MEM---';    cat /proc/meminfo
echo '---NET---';    cat /proc/net/dev
echo '---UPT---';    cat /proc/uptime
echo '---LOAD---';   cat /proc/loadavg
echo '---DISK---';   df -kP / 2>/dev/null
echo '---PROC---';   ps -eo pid,%cpu,%mem,rss,comm --sort=-%cpu 2>/dev/null | head -21
echo '---NIC4---';   ip -o -4 addr show 2>/dev/null
echo '---NICLINK---';ip -o link show 2>/dev/null
echo '---END---'
"#;
                let out = match timeout(Duration::from_secs(5), ssh.metrics_exec(&sid, probe)).await
                {
                    Ok(Ok(text)) => {
                        consecutive_timeouts = 0;
                        text
                    }
                    Ok(Err(_)) => {
                        let _ = app.emit(
                            &format!("server-metrics-error-{}", sid),
                            serde_json::json!({ "reason": "disconnected" }),
                        );
                        break;
                    }
                    Err(_) => {
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

    pub fn stop_all(&self) {
        let handles: Vec<_> = self
            .tasks
            .lock()
            .drain()
            .map(|(_, handle)| handle)
            .collect();
        for handle in handles {
            handle.abort();
        }
        self.last.lock().clear();
        self.static_host.lock().clear();
    }
}

impl Default for MetricsManager {
    fn default() -> Self {
        Self::new()
    }
}

fn parse_static_host(text: &str) -> HostInfo {
    let mut iter = text.lines();
    let mut host = HostInfo::default();

    for line in &mut iter {
        if line.trim() == "---HOST---" {
            break;
        }
    }

    host.user = iter.next().unwrap_or("").trim().to_string();
    host.hostname = iter.next().unwrap_or("").trim().to_string();
    host.kernel = iter.next().unwrap_or("").trim().to_string();

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
    // Floor to 1 so downstream per-core math never divides by zero, even if the
    // remote couldn't report a core count.
    host.cpu_cores = cores.max(1);

    if let Some(line) = iter.next() {
        if let Some(after) = line.split_once(':') {
            host.cpu_model = after.1.trim().to_string();
        }
    }

    host
}

pub fn build_snapshot(
    text: &str,
    session_id: &str,
    last: &Arc<Mutex<StdHashMap<String, LastSample>>>,
    static_host: &Arc<Mutex<StdHashMap<String, HostInfo>>>,
) -> MetricsSnapshot {
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
                    "DISK" => "DISK",
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

    let mem_stats = sections.get("MEM").map(|t| parse_meminfo(t));

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
                let dt = now
                    .saturating_duration_since(p.taken_at)
                    .as_secs_f64()
                    .max(0.001);
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

    let disk_stats = sections.get("DISK").and_then(|t| parse_df(t));

    let procs = sections.get("PROC").map(|t| parse_ps(t));

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
            for n in ipv4.keys() {
                names.insert(n.clone());
            }
            for n in macs.keys() {
                if n != "lo" {
                    names.insert(n.clone());
                }
            }
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

    let host = static_host.lock().get(session_id).cloned().map(|mut h| {
        if let Some(upt) = sections.get("UPT") {
            if let Some(first) = upt.split_ascii_whitespace().next() {
                if let Ok(s) = first.parse::<f64>() {
                    h.uptime_seconds = s as u64;
                }
            }
        }
        h
    });

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
        disk: disk_stats,
        procs,
        nics,
        collected_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0),
    }
}
