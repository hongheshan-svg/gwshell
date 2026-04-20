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
    let total_d = cur.total().saturating_sub(prev.total()) as f64;
    if total_d <= 0.0 {
        return (0.0, 0.0, 0.0);
    }
    let u = (cur.user.saturating_sub(prev.user) + cur.nice.saturating_sub(prev.nice)) as f64;
    let s = cur.system.saturating_sub(prev.system) as f64;
    let w = cur.iowait.saturating_sub(prev.iowait) as f64;
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
