// src-tauri/src/metrics_platforms.rs
//
// Cross-platform SSH metrics probes & pure parsers supporting:
// - Linux (including Alpine / OpenWrt / BusyBox minimal environments)
// - macOS (Darwin: Apple Silicon & Intel)
// - BSD (FreeBSD / OpenBSD / NetBSD / DragonFly)
// - Windows (OpenSSH Server with cmd.exe or PowerShell default shell)

use super::{
    cpu_breakdown, cpu_percent, parse_df, parse_ip_addr, parse_ip_link, parse_loadavg,
    parse_meminfo, parse_net_dev, parse_os_pretty, parse_proc_stat, parse_ps, CpuStats, CpuTimes,
    DiskStats, HostInfo, LastSample, MemStats, MetricsSnapshot, NetStats, NicInfo, ProcInfo,
};
use parking_lot::Mutex;
use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemotePlatform {
    Linux,
    MacOs,
    Bsd,
    Windows,
}

impl RemotePlatform {
    pub fn as_str(self) -> &'static str {
        match self {
            RemotePlatform::Linux => "linux",
            RemotePlatform::MacOs => "macos",
            RemotePlatform::Bsd => "bsd",
            RemotePlatform::Windows => "windows",
        }
    }
}

/// First-contact POSIX `sh` probe: detects Linux / macOS / BSD and gathers
/// static host metadata in a single round-trip. Wrapping in `sh -c '...'`
/// guarantees compatibility even when the remote login shell is `csh`/`tcsh`
/// (FreeBSD root default) or `fish`.
pub const UNIX_DETECT_STATIC_CMD: &str = r#"sh -c '
_os=$(uname -s 2>/dev/null)
echo "---PLATFORM---"
echo "$_os"
echo "---HOST---"
whoami 2>/dev/null
hostname 2>/dev/null
uname -sr 2>/dev/null
case "$_os" in
  Linux)
    echo "---OSREL---"
    cat /etc/os-release 2>/dev/null || cat /etc/openwrt_release 2>/dev/null
    echo "---CORES---"
    nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || grep -c "^processor" /proc/cpuinfo 2>/dev/null || echo 1
    echo "---CPUMODEL---"
    grep -m1 "^model name" /proc/cpuinfo 2>/dev/null || grep -m1 "^Model" /proc/cpuinfo 2>/dev/null || grep -m1 "^Hardware" /proc/cpuinfo 2>/dev/null || grep -m1 "^cpu model" /proc/cpuinfo 2>/dev/null
    ;;
  Darwin)
    echo "---OSREL---"
    _pn=$(sw_vers -productName 2>/dev/null)
    _pv=$(sw_vers -productVersion 2>/dev/null)
    echo "PRETTY_NAME=\"${_pn:-macOS} ${_pv}\""
    echo "---CORES---"
    sysctl -n hw.ncpu 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1
    echo "---CPUMODEL---"
    sysctl -n machdep.cpu.brand_string 2>/dev/null || sysctl -n hw.model 2>/dev/null
    ;;
  *BSD|DragonFly)
    echo "---OSREL---"
    if [ -r /etc/os-release ]; then cat /etc/os-release 2>/dev/null; else echo "PRETTY_NAME=\"$(uname -sr 2>/dev/null)\""; fi
    echo "---CORES---"
    sysctl -n hw.ncpu 2>/dev/null || echo 1
    echo "---CPUMODEL---"
    sysctl -n hw.model 2>/dev/null
    ;;
esac
echo "---HOSTEND---"
'"#;

/// Static host probe for Windows OpenSSH (works whether the remote SSH default
/// shell is `cmd.exe` or `powershell.exe`).
pub const WINDOWS_STATIC_CMD: &str = r#"powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$os=Get-CimInstance Win32_OperatingSystem; $cpu=Get-CimInstance Win32_Processor | Select-Object -First 1; Write-Output '---PLATFORM---'; Write-Output 'Windows'; Write-Output '---HOST---'; Write-Output $env:USERNAME; Write-Output $env:COMPUTERNAME; Write-Output ('Windows ' + [Environment]::OSVersion.Version.ToString()); Write-Output '---OSREL---'; Write-Output ('PRETTY_NAME=\"' + $os.Caption.Trim() + '\"'); Write-Output '---CORES---'; Write-Output ([Environment]::ProcessorCount); Write-Output '---CPUMODEL---'; Write-Output ($cpu.Name.Trim()); Write-Output '---HOSTEND---'""#;

pub const LINUX_PROBE_CMD: &str = r#"sh -c '
echo "---STAT---";    cat /proc/stat 2>/dev/null
echo "---MEM---";     cat /proc/meminfo 2>/dev/null
echo "---NET---";     cat /proc/net/dev 2>/dev/null
echo "---UPT---";     cat /proc/uptime 2>/dev/null
echo "---LOAD---";    cat /proc/loadavg 2>/dev/null
echo "---DISK---";    df -kP / 2>/dev/null
echo "---PROC---";    ps -eo pid,%cpu,%mem,rss,comm --sort=-%cpu 2>/dev/null | head -21 || ps -eo pid,pcpu,pmem,rss,comm 2>/dev/null | head -21 || ps w 2>/dev/null | head -21
echo "---NIC4---";    ip -o -4 addr show 2>/dev/null
echo "---NICLINK---"; ip -o link show 2>/dev/null
echo "---IFCFG---";   if ! command -v ip >/dev/null 2>&1; then ifconfig 2>/dev/null; fi
echo "---END---"
'"#;

pub const MACOS_PROBE_CMD: &str = r#"sh -c '
echo "---MACCPU---";  top -l 2 -n 0 -s 1 2>/dev/null | grep "CPU usage" | tail -1
echo "---LOAD---";    sysctl -n vm.loadavg 2>/dev/null
echo "---MEMSIZE---"; sysctl -n hw.memsize 2>/dev/null
echo "---VMSTAT---";  vm_stat 2>/dev/null
echo "---SWAP---";    sysctl -n vm.swapusage 2>/dev/null
echo "---BOOT---";    sysctl -n kern.boottime 2>/dev/null; date +%s 2>/dev/null
echo "---DISK---";    df -kP /System/Volumes/Data 2>/dev/null || df -kP / 2>/dev/null
echo "---NETSTAT---"; netstat -ibn 2>/dev/null
echo "---PROC---";    ps -Arco pid,pcpu,pmem,rss,comm 2>/dev/null | head -21
echo "---IFCFG---";   ifconfig 2>/dev/null
echo "---END---"
'"#;

pub const BSD_PROBE_CMD: &str = r#"sh -c '
echo "---BSDCPU---";    sysctl -n kern.cp_time 2>/dev/null
echo "---BSDCORES---";  sysctl -n kern.cp_times 2>/dev/null
echo "---LOAD---";      sysctl -n vm.loadavg 2>/dev/null
echo "---BSDMEM---";    sysctl -n hw.physmem hw.pagesize vm.stats.vm.v_free_count vm.stats.vm.v_inactive_count vm.stats.vm.v_cache_count 2>/dev/null
echo "---BSDSWAP---";   swapinfo -k 2>/dev/null || swapctl -sk 2>/dev/null
echo "---BOOT---";      sysctl -n kern.boottime 2>/dev/null; date +%s 2>/dev/null
echo "---DISK---";      df -kP / 2>/dev/null
echo "---NETSTAT---";   netstat -ibn 2>/dev/null
echo "---PROC---";      ps -axo pid,pcpu,pmem,rss,comm 2>/dev/null | head -60
echo "---IFCFG---";     ifconfig 2>/dev/null
echo "---END---"
'"#;

pub const WINDOWS_PROBE_CMD: &str = r#"powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; Write-Output '---WINCPU---'; Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor | ForEach-Object { Write-Output ($_.Name + '|' + $_.PercentProcessorTime + '|' + $_.PercentUserTime + '|' + $_.PercentPrivilegedTime) }; Write-Output '---WINMEM---'; $os=Get-CimInstance Win32_OperatingSystem; $up=[int64]([DateTime]::Now - $os.LastBootUpTime).TotalSeconds; Write-Output ($os.TotalVisibleMemorySize.ToString() + '|' + $os.FreePhysicalMemory.ToString() + '|' + $os.SizeStoredInPagingFiles.ToString() + '|' + $os.FreeSpaceInPagingFiles.ToString() + '|' + $up.ToString()); Write-Output '---WINDISK---'; $d=Get-CimInstance Win32_LogicalDisk -Filter ('DeviceID=''' + $env:SystemDrive + ''''); if ($d) { Write-Output ($d.DeviceID + '|' + $d.Size + '|' + $d.FreeSpace) }; Write-Output '---WINNET---'; Get-NetAdapterStatistics | ForEach-Object { Write-Output ($_.Name + '|' + $_.ReceivedBytes + '|' + $_.SentBytes) }; Write-Output '---WINPROC---'; $totMem=[math]::Max(1, [double]$os.TotalVisibleMemorySize * 1024); Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 20 | ForEach-Object { $mp=[math]::Round(($_.WorkingSet64 / $totMem) * 100, 1); $rss=[int64]($_.WorkingSet64 / 1024); $cpu=if ($null -ne $_.CPU) { [math]::Round([double]$_.CPU, 1) } else { 0 }; Write-Output ($_.Id.ToString() + '|' + $cpu.ToString() + '|' + $mp.ToString() + '|' + $rss.ToString() + '|' + $_.ProcessName) }; Write-Output '---WINNIC---'; $macs=@{}; Get-NetAdapter | ForEach-Object { $macs[$_.Name]=$_.MacAddress }; Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.InterfaceAlias -notlike '*Loopback*' } | ForEach-Object { $m=$macs[$_.InterfaceAlias]; Write-Output ($_.InterfaceAlias + '|' + $_.IPAddress + '|' + $m) }; Write-Output '---END---'""#;

pub fn probe_cmd_for(platform: RemotePlatform) -> &'static str {
    match platform {
        RemotePlatform::Linux => LINUX_PROBE_CMD,
        RemotePlatform::MacOs => MACOS_PROBE_CMD,
        RemotePlatform::Bsd => BSD_PROBE_CMD,
        RemotePlatform::Windows => WINDOWS_PROBE_CMD,
    }
}

/// Split `---TAG---` delimited probe output into a section map.
pub fn split_sections(text: &str) -> HashMap<String, String> {
    let mut sections: HashMap<String, String> = HashMap::new();
    let mut current: Option<String> = None;
    let mut buf = String::new();
    for raw_line in text.lines() {
        let line = raw_line.trim_end_matches('\r');
        if let Some(tag) = line.strip_prefix("---").and_then(|s| s.strip_suffix("---")) {
            if !tag.is_empty()
                && tag
                    .chars()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
            {
                if let Some(prev) = current.take() {
                    sections.insert(prev, std::mem::take(&mut buf));
                }
                if tag != "END" && tag != "HOSTEND" {
                    current = Some(tag.to_string());
                }
                continue;
            }
        }
        if current.is_some() {
            buf.push_str(line);
            buf.push('\n');
        }
    }
    if let Some(prev) = current {
        sections.insert(prev, buf);
    }
    sections
}

/// Detect the remote OS platform from `---PLATFORM---` (or raw `uname -s` text).
pub fn detect_platform_from_text(text: &str) -> Option<RemotePlatform> {
    let sections = split_sections(text);
    let raw = sections
        .get("PLATFORM")
        .map(|s| s.trim())
        .unwrap_or_else(|| text.trim());
    let lower = raw.to_ascii_lowercase();
    if lower.contains("linux") {
        Some(RemotePlatform::Linux)
    } else if lower.contains("darwin") || lower.contains("macos") {
        Some(RemotePlatform::MacOs)
    } else if lower.contains("freebsd")
        || lower.contains("openbsd")
        || lower.contains("netbsd")
        || lower.contains("dragonfly")
    {
        Some(RemotePlatform::Bsd)
    } else if lower.contains("windows")
        || lower.contains("mingw")
        || lower.contains("msys")
        || lower.contains("cygwin")
    {
        Some(RemotePlatform::Windows)
    } else {
        None
    }
}

/// Parse static host info emitted by `UNIX_DETECT_STATIC_CMD` or `WINDOWS_STATIC_CMD`.
pub fn parse_static_host_sections(text: &str, platform: RemotePlatform) -> HostInfo {
    let sections = split_sections(text);
    let mut host = HostInfo {
        platform: platform.as_str().to_string(),
        ..Default::default()
    };

    if let Some(host_block) = sections.get("HOST") {
        let mut lines = host_block.lines().map(str::trim);
        host.user = lines.next().unwrap_or("").to_string();
        host.hostname = lines.next().unwrap_or("").to_string();
        host.kernel = lines.next().unwrap_or("").to_string();
    }

    if let Some(osrel) = sections.get("OSREL") {
        let pretty = parse_os_pretty(osrel);
        if !pretty.is_empty() {
            host.os_pretty = pretty;
        } else {
            // OpenWrt `/etc/openwrt_release` uses `DISTRIB_DESCRIPTION='...'`.
            for line in osrel.lines() {
                if let Some(rest) = line.strip_prefix("DISTRIB_DESCRIPTION=") {
                    host.os_pretty = rest.trim().trim_matches(&['"', '\''][..]).to_string();
                    break;
                }
            }
        }
    }
    if host.os_pretty.is_empty() {
        host.os_pretty = host.kernel.clone();
    }

    let cores = sections
        .get("CORES")
        .and_then(|s| s.lines().find_map(|l| l.trim().parse::<u32>().ok()))
        .unwrap_or(1);
    host.cpu_cores = cores.max(1);

    if let Some(cpu_line) = sections
        .get("CPUMODEL")
        .and_then(|s| s.lines().find(|l| !l.trim().is_empty()))
    {
        let trimmed = cpu_line.trim();
        host.cpu_model = match trimmed.split_once(':') {
            Some((_, after)) => after.trim().to_string(),
            None => trimmed.to_string(),
        };
    }

    host
}

// ---- Shared Unix/BSD/macOS Parsers ----

/// Parse `sysctl -n vm.loadavg` (e.g. `{ 2.41 2.73 2.63 }` or `0.12 0.34 0.56`).
pub fn parse_sysctl_loadavg(text: &str) -> (f64, f64, f64) {
    let cleaned: String = text
        .chars()
        .map(|c| {
            if c.is_ascii_digit() || c == '.' || c == '-' {
                c
            } else {
                ' '
            }
        })
        .collect();
    parse_loadavg(&cleaned)
}

/// Parse `kern.boottime` + `date +%s` output into uptime seconds.
/// Accepts `{ sec = 1795040995, usec = 367717 } ...` followed by `1795359435`.
pub fn parse_boottime_uptime(text: &str) -> Option<u64> {
    let mut boot_sec: Option<u64> = None;
    let mut now_sec: Option<u64> = None;
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(idx) = trimmed.find("sec =") {
            let after = &trimmed[idx + 5..];
            let digits: String = after
                .trim_start()
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect();
            if let Ok(sec) = digits.parse::<u64>() {
                boot_sec = Some(sec);
            }
        } else if !trimmed.is_empty() && trimmed.chars().all(|c| c.is_ascii_digit()) {
            if let Ok(sec) = trimmed.parse::<u64>() {
                // On OpenBSD `kern.boottime` prints a raw unix timestamp on line 1
                // and `date +%s` prints current time on line 2.
                if boot_sec.is_none() {
                    boot_sec = Some(sec);
                } else {
                    now_sec = Some(sec);
                }
            }
        }
    }
    let boot = boot_sec?;
    let now = now_sec.unwrap_or_else(|| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(boot)
    });
    Some(now.saturating_sub(boot))
}

/// Parse `netstat -ibn` output on macOS and BSD into `iface -> (rx_bytes, tx_bytes)`.
/// Only counts `<Link#...>` rows (or link-layer rows) to avoid double-counting
/// interfaces that have multiple IPv4/IPv6 addresses, and skips loopback (`lo*`).
pub fn parse_netstat_ibn(text: &str) -> HashMap<String, (u64, u64)> {
    let mut out: HashMap<String, (u64, u64)> = HashMap::new();
    let mut lines = text.lines().filter(|l| !l.trim().is_empty());
    let header_line = match lines.next() {
        Some(h) => h,
        None => return out,
    };
    let headers: Vec<&str> = header_line.split_ascii_whitespace().collect();
    let ibytes_idx = headers.iter().position(|h| *h == "Ibytes");
    let obytes_idx = headers.iter().position(|h| *h == "Obytes");
    let (Some(ib_idx), Some(ob_idx)) = (ibytes_idx, obytes_idx) else {
        return out;
    };
    let header_len = headers.len();

    for line in lines {
        let cols: Vec<&str> = line.split_ascii_whitespace().collect();
        if cols.len() < 7 {
            continue;
        }
        let raw_name = cols[0].trim_end_matches('*');
        if raw_name.starts_with("lo") {
            continue;
        }
        // Only count the link-layer row (`<Link#N>`) so IPv4/IPv6 alias lines
        // aren't summed multiple times.
        let is_link_row = cols.get(2).is_some_and(|c| c.starts_with("<Link#"));
        if !is_link_row {
            continue;
        }
        // When a `<Link#N>` row has no MAC address (e.g. gif0, utun0), the
        // `Address` column is empty and every subsequent column shifts left by 1.
        let shift = if cols.len() + 1 == header_len { 1 } else { 0 };
        let rx = cols
            .get(ib_idx.saturating_sub(shift))
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        let tx = cols
            .get(ob_idx.saturating_sub(shift))
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        out.entry(raw_name.to_string())
            .and_modify(|(erx, etx)| {
                *erx = (*erx).max(rx);
                *etx = (*etx).max(tx);
            })
            .or_insert((rx, tx));
    }
    out
}

/// Parse `ifconfig` output (macOS, FreeBSD, OpenBSD, NetBSD, BusyBox/OpenWrt)
/// into non-loopback `NicInfo` entries (IPv4 + MAC).
pub fn parse_ifconfig(text: &str) -> Vec<NicInfo> {
    let mut ipv4_map: HashMap<String, String> = HashMap::new();
    let mut mac_map: HashMap<String, String> = HashMap::new();
    let mut current: Option<String> = None;

    for raw_line in text.lines() {
        let line = raw_line.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }
        if !line.starts_with(' ') && !line.starts_with('\t') {
            let iface = line
                .split_ascii_whitespace()
                .next()
                .unwrap_or("")
                .trim_end_matches(':')
                .to_string();
            if iface.is_empty() || iface == "lo" || iface.starts_with("lo0") {
                current = None;
            } else {
                current = Some(iface);
            }
            // BusyBox/old Linux puts `HWaddr aa:bb:...` on the header line.
            if let Some(ref name) = current {
                let parts: Vec<&str> = line.split_ascii_whitespace().collect();
                if let Some(idx) = parts.iter().position(|p| *p == "HWaddr") {
                    if let Some(mac) = parts.get(idx + 1) {
                        mac_map.insert(name.clone(), (*mac).to_string());
                    }
                }
            }
            continue;
        }

        let Some(ref name) = current else {
            continue;
        };
        let parts: Vec<&str> = line.split_ascii_whitespace().collect();
        if parts.is_empty() {
            continue;
        }

        // IPv4: `inet 192.168.1.5 ...` or BusyBox `inet addr:192.168.1.5`
        if parts[0] == "inet" {
            if let Some(second) = parts.get(1) {
                let raw_ip = second.strip_prefix("addr:").unwrap_or(second);
                let ip = raw_ip.split('/').next().unwrap_or("");
                if !ip.is_empty() && ip != "127.0.0.1" && !ipv4_map.contains_key(name) {
                    ipv4_map.insert(name.clone(), ip.to_string());
                }
            }
        }

        // MAC: `ether aa:bb:...` (macOS/FreeBSD/Linux) or `lladdr aa:bb:...` (OpenBSD)
        if let Some(idx) = parts
            .iter()
            .position(|p| *p == "ether" || *p == "lladdr" || *p == "HWaddr")
        {
            if let Some(mac) = parts.get(idx + 1) {
                if !mac_map.contains_key(name) {
                    mac_map.insert(name.clone(), (*mac).to_string());
                }
            }
        }
    }

    let mut names: BTreeSet<String> = BTreeSet::new();
    for k in ipv4_map.keys() {
        names.insert(k.clone());
    }
    for k in mac_map.keys() {
        if ipv4_map.contains_key(k) {
            names.insert(k.clone());
        }
    }
    // If no interface had an IPv4 (e.g. IPv6-only or disconnected), still show MAC-bearing NICs.
    if names.is_empty() {
        for k in mac_map.keys() {
            names.insert(k.clone());
        }
    }

    names
        .into_iter()
        .map(|name| NicInfo {
            ipv4: ipv4_map.get(&name).cloned(),
            mac: mac_map.get(&name).cloned(),
            name,
        })
        .collect()
}

// ---- macOS Parsers ----

/// Parse macOS `top -l 2 -n 0 -s 1` CPU usage line:
/// `CPU usage: 12.34% user, 5.67% sys, 81.99% idle`
pub fn parse_macos_cpu_usage(text: &str) -> Option<(f64, f64, f64)> {
    let line = text.lines().rev().find(|l| l.contains("CPU usage:"))?;
    let mut user = 0.0_f64;
    let mut sys = 0.0_f64;
    let mut idle: Option<f64> = None;

    let body = line.split_once("CPU usage:")?.1;
    for part in body.split(',') {
        let p = part.trim();
        let num = p
            .split('%')
            .next()
            .and_then(|n| n.trim().parse::<f64>().ok())?;
        if p.contains("user") {
            user = num;
        } else if p.contains("sys") {
            sys = num;
        } else if p.contains("idle") {
            idle = Some(num);
        }
    }
    let total = match idle {
        Some(i) => (100.0 - i).clamp(0.0, 100.0),
        None => (user + sys).clamp(0.0, 100.0),
    };
    Some((total, user.clamp(0.0, 100.0), sys.clamp(0.0, 100.0)))
}

fn parse_size_unit_bytes(token: &str) -> u64 {
    let trimmed = token.trim().trim_end_matches(&[';', ',', ')'][..]);
    if trimmed.is_empty() {
        return 0;
    }
    let split_at = trimmed
        .find(|c: char| !c.is_ascii_digit() && c != '.')
        .unwrap_or(trimmed.len());
    let num: f64 = trimmed[..split_at].parse().unwrap_or(0.0);
    let unit = trimmed[split_at..].trim().to_ascii_uppercase();
    let mult: f64 = match unit.as_str() {
        "K" | "KB" | "KIB" => 1024.0,
        "M" | "MB" | "MIB" => 1024.0 * 1024.0,
        "G" | "GB" | "GIB" => 1024.0 * 1024.0 * 1024.0,
        "T" | "TB" | "TIB" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => 1.0,
    };
    (num * mult).max(0.0) as u64
}

/// Parse macOS `sysctl -n vm.swapusage` (`total = 2048.00M  used = 512.00M  free = 1536.00M`).
pub fn parse_macos_swapusage(text: &str) -> (u64, u64) {
    let mut total = 0u64;
    let mut used = 0u64;
    let tokens: Vec<&str> = text.split_ascii_whitespace().collect();
    for i in 0..tokens.len() {
        if tokens[i] == "total" && tokens.get(i + 1) == Some(&"=") {
            if let Some(val) = tokens.get(i + 2) {
                total = parse_size_unit_bytes(val);
            }
        } else if tokens[i] == "used" && tokens.get(i + 1) == Some(&"=") {
            if let Some(val) = tokens.get(i + 2) {
                used = parse_size_unit_bytes(val);
            }
        }
    }
    (total, used)
}

/// Parse macOS `hw.memsize` + `vm_stat` + `vm.swapusage` into `MemStats`.
/// Used memory matches Activity Monitor: `(active + wired + occupied_by_compressor) * page_size`.
pub fn parse_macos_mem(memsize_text: &str, vmstat_text: &str, swap_text: &str) -> Option<MemStats> {
    let total_bytes: u64 = memsize_text.trim().parse().ok()?;
    let mut page_size: u64 = 4096;
    let mut active: u64 = 0;
    let mut wired: u64 = 0;
    let mut compressed: u64 = 0;
    let mut free: u64 = 0;

    for line in vmstat_text.lines() {
        if let Some(idx) = line.find("page size of ") {
            let after = &line[idx + 13..];
            let digits: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
            if let Ok(ps) = digits.parse::<u64>() {
                if ps > 0 {
                    page_size = ps;
                }
            }
            continue;
        }
        let Some((k, v)) = line.split_once(':') else {
            continue;
        };
        let pages: u64 = v.trim().trim_end_matches('.').parse().unwrap_or(0);
        match k.trim() {
            "Pages active" => active = pages,
            "Pages wired down" => wired = pages,
            "Pages occupied by compressor" => compressed = pages,
            "Pages free" => free = pages,
            _ => {}
        }
    }

    let used_pages = active.saturating_add(wired).saturating_add(compressed);
    let mem_used_bytes = if used_pages > 0 {
        used_pages.saturating_mul(page_size).min(total_bytes)
    } else {
        total_bytes.saturating_sub(free.saturating_mul(page_size))
    };
    let (swap_total_bytes, swap_used_bytes) = parse_macos_swapusage(swap_text);

    Some(MemStats {
        mem_total_bytes: total_bytes,
        mem_used_bytes,
        swap_total_bytes,
        swap_used_bytes,
    })
}

/// On macOS APFS, `df -kP /System/Volumes/Data` shows total container size,
/// used data volume, and shared container available space. `total - avail`
/// reflects real APFS container usage much more accurately than `Used` alone.
pub fn parse_macos_df(text: &str) -> Option<DiskStats> {
    let line = text.lines().nth(1)?;
    let cols: Vec<&str> = line.split_whitespace().collect();
    if cols.len() < 6 {
        return None;
    }
    let total_kb: u64 = cols[1].parse().ok()?;
    let used_kb: u64 = cols[2].parse().ok()?;
    let avail_kb: u64 = cols[3].parse().ok()?;
    let mount = cols[cols.len() - 1].to_string();
    let effective_used_kb = if mount == "/System/Volumes/Data" || mount == "/" {
        total_kb.saturating_sub(avail_kb).max(used_kb)
    } else {
        used_kb
    };
    Some(DiskStats {
        total_bytes: total_kb.saturating_mul(1024),
        used_bytes: effective_used_kb.saturating_mul(1024),
        mount: if mount == "/System/Volumes/Data" {
            "/".to_string()
        } else {
            mount
        },
    })
}

// ---- BSD Parsers ----

/// Parse FreeBSD/OpenBSD `kern.cp_time` (5 integers: `user nice sys intr idle`).
pub fn parse_bsd_cp_time(text: &str) -> Option<CpuTimes> {
    let nums: Vec<u64> = text
        .split_ascii_whitespace()
        .filter_map(|s| s.parse().ok())
        .collect();
    if nums.len() < 5 {
        return None;
    }
    Some(CpuTimes {
        user: nums[0],
        nice: nums[1],
        system: nums[2],
        irq: nums[3],
        idle: nums[4],
        ..Default::default()
    })
}

/// Parse FreeBSD `kern.cp_times` (N * 5 integers: per-core `user nice sys intr idle`).
pub fn parse_bsd_cp_times(text: &str) -> Vec<CpuTimes> {
    let nums: Vec<u64> = text
        .split_ascii_whitespace()
        .filter_map(|s| s.parse().ok())
        .collect();
    nums.chunks_exact(5)
        .map(|c| CpuTimes {
            user: c[0],
            nice: c[1],
            system: c[2],
            irq: c[3],
            idle: c[4],
            ..Default::default()
        })
        .collect()
}

/// Parse FreeBSD `sysctl -n hw.physmem hw.pagesize vm.stats.vm.v_free_count ...`
/// and `swapinfo -k` / `swapctl -sk` into `MemStats`.
pub fn parse_bsd_mem(mem_text: &str, swap_text: &str) -> Option<MemStats> {
    let nums: Vec<u64> = mem_text
        .lines()
        .filter_map(|l| l.trim().parse::<u64>().ok())
        .collect();
    if nums.len() < 2 {
        return None;
    }
    let total_bytes = nums[0];
    let page_size = nums[1].max(1);
    let free_pages = *nums.get(2).unwrap_or(&0);
    let inactive_pages = *nums.get(3).unwrap_or(&0);
    let cache_pages = *nums.get(4).unwrap_or(&0);
    let avail_bytes = free_pages
        .saturating_add(inactive_pages)
        .saturating_add(cache_pages)
        .saturating_mul(page_size);
    let used_bytes = total_bytes.saturating_sub(avail_bytes);

    let (swap_total_bytes, swap_used_bytes) = parse_bsd_swap(swap_text);
    Some(MemStats {
        mem_total_bytes: total_bytes,
        mem_used_bytes: used_bytes,
        swap_total_bytes,
        swap_used_bytes,
    })
}

pub fn parse_bsd_swap(text: &str) -> (u64, u64) {
    let mut total_kb = 0u64;
    let mut used_kb = 0u64;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("Device") {
            continue;
        }
        // `swapctl -sk`: `total: 1048576 1K-blocks allocated, 12345 used, ...`
        if trimmed.starts_with("total:") {
            let parts: Vec<&str> = trimmed.split_ascii_whitespace().collect();
            if let Some(t) = parts.get(1).and_then(|s| s.parse::<u64>().ok()) {
                total_kb = t;
            }
            for (i, p) in parts.iter().enumerate() {
                if *p == "used," || *p == "used" {
                    if let Some(u) = i
                        .checked_sub(1)
                        .and_then(|idx| parts.get(idx))
                        .and_then(|s| s.parse::<u64>().ok())
                    {
                        used_kb = u;
                    }
                }
            }
            return (total_kb.saturating_mul(1024), used_kb.saturating_mul(1024));
        }
        // `swapinfo -k`: `/dev/ada0p3  2097152  102400  1994752  5%`
        let cols: Vec<&str> = trimmed.split_ascii_whitespace().collect();
        if cols.len() >= 3 {
            if let (Ok(t), Ok(u)) = (cols[1].parse::<u64>(), cols[2].parse::<u64>()) {
                total_kb = total_kb.saturating_add(t);
                used_kb = used_kb.saturating_add(u);
            }
        }
    }
    (total_kb.saturating_mul(1024), used_kb.saturating_mul(1024))
}

// ---- Windows Parsers ----

pub fn parse_windows_cpu(text: &str) -> Option<CpuStats> {
    let mut total: Option<(f64, f64, f64)> = None;
    let mut cores: Vec<(usize, f64)> = Vec::new();

    for line in text.lines() {
        let parts: Vec<&str> = line.trim().split('|').collect();
        if parts.len() < 4 {
            continue;
        }
        let name = parts[0].trim();
        let pct = parts[1]
            .trim()
            .parse::<f64>()
            .unwrap_or(0.0)
            .clamp(0.0, 100.0);
        let user = parts[2]
            .trim()
            .parse::<f64>()
            .unwrap_or(0.0)
            .clamp(0.0, 100.0);
        let sys = parts[3]
            .trim()
            .parse::<f64>()
            .unwrap_or(0.0)
            .clamp(0.0, 100.0);
        if name == "_Total" {
            total = Some((pct, user, sys));
        } else if let Ok(idx) = name.parse::<usize>() {
            cores.push((idx, pct));
        }
    }

    cores.sort_by_key(|(idx, _)| *idx);
    let per_core: Vec<f64> = cores.into_iter().map(|(_, p)| p).collect();
    let (total_percent, user_percent, system_percent) = match total {
        Some(t) => t,
        None if !per_core.is_empty() => {
            let avg = per_core.iter().sum::<f64>() / per_core.len() as f64;
            (avg, avg, 0.0)
        }
        None => return None,
    };

    Some(CpuStats {
        total_percent,
        user_percent,
        system_percent,
        iowait_percent: 0.0,
        per_core,
        loadavg_1m: 0.0,
        loadavg_5m: 0.0,
        loadavg_15m: 0.0,
    })
}

pub fn parse_windows_mem_and_uptime(text: &str) -> Option<(MemStats, u64)> {
    let line = text.lines().find(|l| l.contains('|'))?;
    let parts: Vec<&str> = line.trim().split('|').collect();
    if parts.len() < 5 {
        return None;
    }
    let total_kb: u64 = parts[0].trim().parse().ok()?;
    let free_kb: u64 = parts[1].trim().parse().unwrap_or(0);
    let page_total_kb: u64 = parts[2].trim().parse().unwrap_or(0);
    let page_free_kb: u64 = parts[3].trim().parse().unwrap_or(0);
    let uptime_sec: u64 = parts[4].trim().parse().unwrap_or(0);
    Some((
        MemStats {
            mem_total_bytes: total_kb.saturating_mul(1024),
            mem_used_bytes: total_kb.saturating_sub(free_kb).saturating_mul(1024),
            swap_total_bytes: page_total_kb.saturating_mul(1024),
            swap_used_bytes: page_total_kb
                .saturating_sub(page_free_kb)
                .saturating_mul(1024),
        },
        uptime_sec,
    ))
}

pub fn parse_windows_disk(text: &str) -> Option<DiskStats> {
    let line = text.lines().find(|l| l.contains('|'))?;
    let parts: Vec<&str> = line.trim().split('|').collect();
    if parts.len() < 3 {
        return None;
    }
    let mount = parts[0].trim().to_string();
    let total_bytes: u64 = parts[1].trim().parse().ok()?;
    let free_bytes: u64 = parts[2].trim().parse().unwrap_or(0);
    Some(DiskStats {
        total_bytes,
        used_bytes: total_bytes.saturating_sub(free_bytes),
        mount: if mount.is_empty() {
            "C:".to_string()
        } else {
            mount
        },
    })
}

pub fn parse_windows_net(text: &str) -> HashMap<String, (u64, u64)> {
    let mut out = HashMap::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.trim().split('|').collect();
        if parts.len() < 3 {
            continue;
        }
        let name = parts[0].trim();
        if name.is_empty() || name.to_ascii_lowercase().contains("loopback") {
            continue;
        }
        let rx: u64 = parts[1].trim().parse().unwrap_or(0);
        let tx: u64 = parts[2].trim().parse().unwrap_or(0);
        out.insert(name.to_string(), (rx, tx));
    }
    out
}

pub fn parse_windows_procs(text: &str) -> Vec<ProcInfo> {
    text.lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.trim().split('|').collect();
            if parts.len() < 5 {
                return None;
            }
            let pid: u32 = parts[0].trim().parse().ok()?;
            let cpu: f64 = parts[1].trim().parse().unwrap_or(0.0);
            let mem: f64 = parts[2].trim().parse().unwrap_or(0.0);
            let rss: u64 = parts[3].trim().parse().unwrap_or(0);
            let comm = parts[4..].join("|").trim().to_string();
            if comm.is_empty() {
                return None;
            }
            Some(ProcInfo {
                pid,
                comm,
                cpu_percent: cpu.min(100.0),
                mem_percent: mem,
                rss_kb: rss,
            })
        })
        .take(20)
        .collect()
}

pub fn parse_windows_nics(text: &str) -> Vec<NicInfo> {
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut out = Vec::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.trim().split('|').collect();
        if parts.len() < 2 {
            continue;
        }
        let name = parts[0].trim().to_string();
        let ip = parts[1].trim();
        if name.is_empty() || ip.is_empty() || ip == "127.0.0.1" {
            continue;
        }
        if !seen.insert(format!("{}:{}", name, ip)) {
            continue;
        }
        let mac = parts
            .get(2)
            .map(|m| m.trim().replace('-', ":").to_ascii_lowercase())
            .filter(|m| !m.is_empty());
        out.push(NicInfo {
            name,
            ipv4: Some(ip.to_string()),
            mac,
        });
    }
    out
}

// ---- Unified Multi-Platform Snapshot Builder ----

fn compute_net_stats(
    new_net: &HashMap<String, (u64, u64)>,
    prev: Option<&LastSample>,
    now: Instant,
) -> Option<NetStats> {
    if new_net.is_empty() {
        return None;
    }
    let mut total_rx: u64 = 0;
    let mut total_tx: u64 = 0;
    for (rx, tx) in new_net.values() {
        total_rx = total_rx.saturating_add(*rx);
        total_tx = total_tx.saturating_add(*tx);
    }
    let (rx_rate, tx_rate) = match prev {
        Some(p) => {
            let dt = now
                .saturating_duration_since(p.taken_at)
                .as_secs_f64()
                .max(0.001);
            let mut prx: u64 = 0;
            let mut ptx: u64 = 0;
            for (rx, tx) in p.net_bytes.values() {
                prx = prx.saturating_add(*rx);
                ptx = ptx.saturating_add(*tx);
            }
            let rx_d = total_rx.saturating_sub(prx) as f64 / dt;
            let tx_d = total_tx.saturating_sub(ptx) as f64 / dt;
            (rx_d.max(0.0), tx_d.max(0.0))
        }
        None => (0.0, 0.0),
    };
    Some(NetStats {
        total_rx_bytes: total_rx,
        total_tx_bytes: total_tx,
        rx_bytes_per_sec: rx_rate,
        tx_bytes_per_sec: tx_rate,
    })
}

fn parse_ps_sorted(text: &str) -> Vec<ProcInfo> {
    let mut procs = parse_ps(text);
    // Fallback for BusyBox `ps w` (`PID USER VSZ STAT COMMAND`) when standard
    // `ps -eo pid,%cpu,%mem,rss,comm` yielded nothing.
    if procs.is_empty() {
        for line in text.lines().skip(1) {
            let mut parts = line.split_ascii_whitespace();
            let Some(pid) = parts.next().and_then(|s| s.parse::<u32>().ok()) else {
                continue;
            };
            let _user = parts.next();
            let vsz_str = parts.next().unwrap_or("0");
            let rss_kb = if let Some(m) = vsz_str.strip_suffix('m') {
                m.parse::<u64>().unwrap_or(0).saturating_mul(1024)
            } else {
                vsz_str.parse::<u64>().unwrap_or(0)
            };
            let _stat = parts.next();
            let comm = parts.collect::<Vec<_>>().join(" ");
            if comm.is_empty() {
                continue;
            }
            procs.push(ProcInfo {
                pid,
                comm,
                cpu_percent: 0.0,
                mem_percent: 0.0,
                rss_kb,
            });
            if procs.len() >= 20 {
                break;
            }
        }
    } else {
        procs.sort_by(|a, b| {
            b.cpu_percent
                .partial_cmp(&a.cpu_percent)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| b.rss_kb.cmp(&a.rss_kb))
        });
        procs.truncate(20);
    }
    procs
}

pub fn build_platform_snapshot(
    platform: RemotePlatform,
    text: &str,
    session_id: &str,
    last: &Arc<Mutex<HashMap<String, LastSample>>>,
    static_host: &Arc<Mutex<HashMap<String, HostInfo>>>,
) -> MetricsSnapshot {
    let sections = split_sections(text);
    let now = Instant::now();
    let mut prev_lock = last.lock();
    let prev = prev_lock.remove(session_id);

    let (cpu, mem, new_net, disk, procs, nics, uptime_override, new_cpu_total, new_cpu_per_core) =
        match platform {
            RemotePlatform::Linux => {
                let (cpu_stats, c_tot, c_cores) = match sections.get("STAT") {
                    Some(stat_text) => match parse_proc_stat(stat_text) {
                        Some((total, per_core)) => {
                            let (cpu_pct, user_pct, sys_pct, iowait_pct, per_core_pct) = match &prev
                            {
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
                let net_map = sections
                    .get("NET")
                    .map(|t| parse_net_dev(t))
                    .unwrap_or_default();
                let disk_stats = sections.get("DISK").and_then(|t| parse_df(t));
                let proc_list = sections.get("PROC").map(|t| parse_ps_sorted(t));

                let nic_list = {
                    let ipv4 = sections
                        .get("NIC4")
                        .map(|t| parse_ip_addr(t))
                        .unwrap_or_default();
                    let macs = sections
                        .get("NICLINK")
                        .map(|t| parse_ip_link(t))
                        .unwrap_or_default();
                    if !ipv4.is_empty() || !macs.is_empty() {
                        let mut names: BTreeSet<String> = BTreeSet::new();
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
                    } else {
                        sections
                            .get("IFCFG")
                            .map(|t| parse_ifconfig(t))
                            .filter(|v| !v.is_empty())
                    }
                };

                let uptime = sections
                    .get("UPT")
                    .and_then(|u| u.split_ascii_whitespace().next())
                    .and_then(|s| s.parse::<f64>().ok())
                    .map(|s| s as u64);

                (
                    cpu_stats, mem_stats, net_map, disk_stats, proc_list, nic_list, uptime, c_tot,
                    c_cores,
                )
            }

            RemotePlatform::MacOs => {
                let (l1, l5, l15) = sections
                    .get("LOAD")
                    .map(|s| parse_sysctl_loadavg(s))
                    .unwrap_or((0.0, 0.0, 0.0));
                let proc_list = sections.get("PROC").map(|t| parse_ps_sorted(t));
                let cpu_stats = sections
                    .get("MACCPU")
                    .and_then(|s| parse_macos_cpu_usage(s))
                    .map(|(tot, user, sys)| CpuStats {
                        total_percent: tot,
                        user_percent: user,
                        system_percent: sys,
                        iowait_percent: 0.0,
                        per_core: Vec::new(),
                        loadavg_1m: l1,
                        loadavg_5m: l5,
                        loadavg_15m: l15,
                    })
                    .or_else(|| {
                        // Fallback if `top` is unavailable: estimate total CPU from process sum.
                        let cores = static_host
                            .lock()
                            .get(session_id)
                            .map(|h| h.cpu_cores.max(1) as f64)
                            .unwrap_or(1.0);
                        let sum: f64 = proc_list
                            .as_ref()
                            .map(|ps| ps.iter().map(|p| p.cpu_percent).sum())
                            .unwrap_or(0.0);
                        Some(CpuStats {
                            total_percent: (sum / cores).clamp(0.0, 100.0),
                            user_percent: (sum / cores).clamp(0.0, 100.0),
                            system_percent: 0.0,
                            iowait_percent: 0.0,
                            per_core: Vec::new(),
                            loadavg_1m: l1,
                            loadavg_5m: l5,
                            loadavg_15m: l15,
                        })
                    });

                let mem_stats = parse_macos_mem(
                    sections.get("MEMSIZE").map(String::as_str).unwrap_or(""),
                    sections.get("VMSTAT").map(String::as_str).unwrap_or(""),
                    sections.get("SWAP").map(String::as_str).unwrap_or(""),
                );
                let net_map = sections
                    .get("NETSTAT")
                    .map(|t| parse_netstat_ibn(t))
                    .unwrap_or_default();
                let disk_stats = sections.get("DISK").and_then(|t| parse_macos_df(t));
                let nic_list = sections
                    .get("IFCFG")
                    .map(|t| parse_ifconfig(t))
                    .filter(|v| !v.is_empty());
                let uptime = sections.get("BOOT").and_then(|t| parse_boottime_uptime(t));

                (
                    cpu_stats,
                    mem_stats,
                    net_map,
                    disk_stats,
                    proc_list,
                    nic_list,
                    uptime,
                    CpuTimes::default(),
                    Vec::new(),
                )
            }

            RemotePlatform::Bsd => {
                let (cpu_stats, c_tot, c_cores) =
                    match sections.get("BSDCPU").and_then(|t| parse_bsd_cp_time(t)) {
                        Some(total) => {
                            let per_core = sections
                                .get("BSDCORES")
                                .map(|t| parse_bsd_cp_times(t))
                                .unwrap_or_default();
                            let (cpu_pct, user_pct, sys_pct, iowait_pct, per_core_pct) = match &prev
                            {
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
                                .map(|s| parse_sysctl_loadavg(s))
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
                    };

                let mem_stats = parse_bsd_mem(
                    sections.get("BSDMEM").map(String::as_str).unwrap_or(""),
                    sections.get("BSDSWAP").map(String::as_str).unwrap_or(""),
                );
                let net_map = sections
                    .get("NETSTAT")
                    .map(|t| parse_netstat_ibn(t))
                    .unwrap_or_default();
                let disk_stats = sections.get("DISK").and_then(|t| parse_df(t));
                let proc_list = sections.get("PROC").map(|t| parse_ps_sorted(t));
                let nic_list = sections
                    .get("IFCFG")
                    .map(|t| parse_ifconfig(t))
                    .filter(|v| !v.is_empty());
                let uptime = sections.get("BOOT").and_then(|t| parse_boottime_uptime(t));

                (
                    cpu_stats, mem_stats, net_map, disk_stats, proc_list, nic_list, uptime, c_tot,
                    c_cores,
                )
            }

            RemotePlatform::Windows => {
                let cpu_stats = sections.get("WINCPU").and_then(|t| parse_windows_cpu(t));
                let (mem_stats, uptime) = match sections
                    .get("WINMEM")
                    .and_then(|t| parse_windows_mem_and_uptime(t))
                {
                    Some((m, u)) => (Some(m), Some(u)),
                    None => (None, None),
                };
                let disk_stats = sections.get("WINDISK").and_then(|t| parse_windows_disk(t));
                let net_map = sections
                    .get("WINNET")
                    .map(|t| parse_windows_net(t))
                    .unwrap_or_default();
                let proc_list = sections.get("WINPROC").map(|t| parse_windows_procs(t));
                let nic_list = sections
                    .get("WINNIC")
                    .map(|t| parse_windows_nics(t))
                    .filter(|v| !v.is_empty());

                (
                    cpu_stats,
                    mem_stats,
                    net_map,
                    disk_stats,
                    proc_list,
                    nic_list,
                    uptime,
                    CpuTimes::default(),
                    Vec::new(),
                )
            }
        };

    let net = compute_net_stats(&new_net, prev.as_ref(), now);

    let host = static_host.lock().get(session_id).cloned().map(|mut h| {
        if let Some(upt) = uptime_override {
            h.uptime_seconds = upt;
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
        cpu,
        mem,
        net,
        disk,
        procs,
        nics,
        collected_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_all_supported_platforms() {
        assert_eq!(
            detect_platform_from_text("---PLATFORM---\nLinux\n---HOST---\n"),
            Some(RemotePlatform::Linux)
        );
        assert_eq!(
            detect_platform_from_text("---PLATFORM---\nDarwin\n---HOST---\n"),
            Some(RemotePlatform::MacOs)
        );
        assert_eq!(
            detect_platform_from_text("---PLATFORM---\nFreeBSD\n---HOST---\n"),
            Some(RemotePlatform::Bsd)
        );
        assert_eq!(
            detect_platform_from_text("---PLATFORM---\nOpenBSD\n---HOST---\n"),
            Some(RemotePlatform::Bsd)
        );
        assert_eq!(
            detect_platform_from_text("---PLATFORM---\nWindows\n---HOST---\n"),
            Some(RemotePlatform::Windows)
        );
        assert_eq!(
            detect_platform_from_text("---PLATFORM---\nMINGW64_NT-10.0\n---HOST---\n"),
            Some(RemotePlatform::Windows)
        );
    }

    #[test]
    fn parses_macos_full_probe() {
        let sample = r#"---MACCPU---
CPU usage: 14.50% user, 5.50% sys, 80.00% idle
---LOAD---
{ 2.41 2.73 2.63 }
---MEMSIZE---
34359738368
---VMSTAT---
Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                   120225.
Pages active:                                 559093.
Pages wired down:                             209080.
Pages occupied by compressor:                 616759.
---SWAP---
total = 2048.00M  used = 512.00M  free = 1536.00M  (encrypted)
---BOOT---
{ sec = 1795040995, usec = 367717 } Thu Nov 19 06:29:55 2026
1795359435
---DISK---
Filesystem     1024-blocks      Used Available Capacity  Mounted on
/dev/disk3s5     482797652 150000000 283600000    35%    /System/Volumes/Data
---NETSTAT---
Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll
lo0        16384 <Link#1>                       2196717     0 1264699206  2196717     0 1264699206     0
gif0*      1280  <Link#2>                             0     0          0        0     0          0     0
en0        1500  <Link#7>    d0:11:e5:cb:dc:7c    50000     0   80000000    40000     0   40000000     0
en0        1500  192.168.1   192.168.1.50         50000     -   80000000    40000     -   40000000     -
---PROC---
  PID  %CPU %MEM    RSS COMM
 1234  12.4  2.1 204800 /Applications/Safari.app
  567   3.2  0.8  81920 node
---IFCFG---
lo0: flags=8049<UP,LOOPBACK,RUNNING,MULTICAST> mtu 16384
	inet 127.0.0.1 netmask 0xff000000
en0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500
	ether d0:11:e5:cb:dc:7c
	inet 192.168.1.50 netmask 0xffffff00 broadcast 192.168.1.255
---END---
"#;
        let last = Arc::new(Mutex::new(HashMap::new()));
        let static_host = Arc::new(Mutex::new(HashMap::new()));
        static_host.lock().insert(
            "mac".to_string(),
            HostInfo {
                platform: "macos".to_string(),
                hostname: "macbook".to_string(),
                os_pretty: "macOS 15.2".to_string(),
                cpu_cores: 10,
                ..Default::default()
            },
        );
        let snap =
            build_platform_snapshot(RemotePlatform::MacOs, sample, "mac", &last, &static_host);
        let cpu = snap.cpu.unwrap();
        assert!((cpu.total_percent - 20.0).abs() < 1e-6);
        assert!((cpu.user_percent - 14.5).abs() < 1e-6);
        assert!((cpu.loadavg_1m - 2.41).abs() < 1e-6);

        let mem = snap.mem.unwrap();
        assert_eq!(mem.mem_total_bytes, 34359738368);
        assert_eq!(mem.mem_used_bytes, (559093 + 209080 + 616759) * 16384);
        assert_eq!(mem.swap_total_bytes, 2048 * 1024 * 1024);
        assert_eq!(mem.swap_used_bytes, 512 * 1024 * 1024);

        let disk = snap.disk.unwrap();
        assert_eq!(disk.mount, "/");
        assert_eq!(disk.used_bytes, (482797652 - 283600000) * 1024);

        let net = snap.net.unwrap();
        assert_eq!(net.total_rx_bytes, 80_000_000);
        assert_eq!(net.total_tx_bytes, 40_000_000);

        assert_eq!(snap.host.unwrap().uptime_seconds, 1795359435 - 1795040995);
        assert_eq!(snap.procs.unwrap().len(), 2);
        let nics = snap.nics.unwrap();
        assert_eq!(nics.len(), 1);
        assert_eq!(nics[0].name, "en0");
        assert_eq!(nics[0].ipv4.as_deref(), Some("192.168.1.50"));
        assert_eq!(nics[0].mac.as_deref(), Some("d0:11:e5:cb:dc:7c"));
    }

    #[test]
    fn parses_bsd_two_sample_delta() {
        let s1 = r#"---BSDCPU---
100 10 50 5 800
---BSDCORES---
50 5 25 2 400 50 5 25 3 400
---LOAD---
{ 0.42 0.35 0.28 }
---BSDMEM---
8589934592
4096
200000
100000
50000
---BSDSWAP---
Device          1K-blocks     Used    Avail Capacity
/dev/ada0p3       2097152   102400  1994752     5%
---BOOT---
{ sec = 1700000000, usec = 0 }
1700003600
---DISK---
Filesystem  1024-blocks    Used   Avail Capacity Mounted on
/dev/ada0p2    20000000 5000000 14000000    26%  /
---NETSTAT---
Name    Mtu Network       Address              Ipkts Ierrs Idrop     Ibytes    Opkts Oerrs     Obytes  Coll
em0    1500 <Link#1>      00:11:22:33:44:55     1000     0     0    1000000      900     0     500000     0
---PROC---
  PID %CPU %MEM   RSS COMM
  101  4.5  1.0 16384 nginx
---IFCFG---
em0: flags=8843<UP,BROADCAST,RUNNING,SIMPLEX,MULTICAST> metric 0 mtu 1500
	ether 00:11:22:33:44:55
	inet 10.0.0.10 netmask 0xffffff00 broadcast 10.0.0.255
---END---
"#;
        let s2 = s1
            .replace("100 10 50 5 800", "160 10 70 5 820")
            .replace("50 5 25 2 400 50 5 25 3 400", "80 5 35 2 410 80 5 35 3 410");
        let last = Arc::new(Mutex::new(HashMap::new()));
        let static_host = Arc::new(Mutex::new(HashMap::new()));
        static_host.lock().insert(
            "bsd".to_string(),
            HostInfo {
                platform: "bsd".to_string(),
                os_pretty: "FreeBSD 14.1".to_string(),
                cpu_cores: 2,
                ..Default::default()
            },
        );
        let _ = build_platform_snapshot(RemotePlatform::Bsd, s1, "bsd", &last, &static_host);
        let snap = build_platform_snapshot(RemotePlatform::Bsd, &s2, "bsd", &last, &static_host);
        let cpu = snap.cpu.unwrap();
        assert!(cpu.total_percent > 70.0 && cpu.total_percent < 90.0);
        assert_eq!(cpu.per_core.len(), 2);
        assert!((cpu.loadavg_1m - 0.42).abs() < 1e-6);
        let mem = snap.mem.unwrap();
        assert_eq!(mem.mem_total_bytes, 8589934592);
        assert_eq!(mem.swap_used_bytes, 102400 * 1024);
        assert_eq!(snap.host.unwrap().uptime_seconds, 3600);
        assert_eq!(snap.nics.unwrap()[0].ipv4.as_deref(), Some("10.0.0.10"));
    }

    #[test]
    fn parses_windows_full_probe() {
        let sample = "---WINCPU---\r\n\
0|25|20|5\r\n\
1|35|25|10\r\n\
_Total|30|22|8\r\n\
---WINMEM---\r\n\
16777216|8388608|4194304|3145728|86400\r\n\
---WINDISK---\r\n\
C:|512000000000|256000000000\r\n\
---WINNET---\r\n\
Ethernet|10485760|5242880\r\n\
---WINPROC---\r\n\
4321|12.5|4.2|262144|pwsh\r\n\
888|0.5|1.1|65536|sshd\r\n\
---WINNIC---\r\n\
Ethernet|192.168.10.8|AA-BB-CC-DD-EE-FF\r\n\
---END---\r\n";

        let last = Arc::new(Mutex::new(HashMap::new()));
        let static_host = Arc::new(Mutex::new(HashMap::new()));
        static_host.lock().insert(
            "win".to_string(),
            HostInfo {
                platform: "windows".to_string(),
                hostname: "WIN-SRV".to_string(),
                os_pretty: "Microsoft Windows Server 2022".to_string(),
                cpu_cores: 2,
                ..Default::default()
            },
        );
        let snap =
            build_platform_snapshot(RemotePlatform::Windows, sample, "win", &last, &static_host);
        let cpu = snap.cpu.unwrap();
        assert!((cpu.total_percent - 30.0).abs() < 1e-6);
        assert_eq!(cpu.per_core, vec![25.0, 35.0]);
        let mem = snap.mem.unwrap();
        assert_eq!(mem.mem_total_bytes, 16777216 * 1024);
        assert_eq!(mem.mem_used_bytes, 8388608 * 1024);
        assert_eq!(mem.swap_used_bytes, 1048576 * 1024);
        let disk = snap.disk.unwrap();
        assert_eq!(disk.mount, "C:");
        assert_eq!(disk.used_bytes, 256000000000);
        assert_eq!(snap.host.unwrap().uptime_seconds, 86400);
        let nics = snap.nics.unwrap();
        assert_eq!(nics[0].name, "Ethernet");
        assert_eq!(nics[0].ipv4.as_deref(), Some("192.168.10.8"));
        assert_eq!(nics[0].mac.as_deref(), Some("aa:bb:cc:dd:ee:ff"));
    }

    #[test]
    fn parses_openwrt_busybox_ifconfig() {
        let cfg = r#"br-lan    Link encap:Ethernet  HWaddr 10:20:30:40:50:60
          inet addr:192.168.1.1  Bcast:192.168.1.255  Mask:255.255.255.0
lo        Link encap:Local Loopback
          inet addr:127.0.0.1  Mask:255.0.0.0
"#;
        let nics = parse_ifconfig(cfg);
        assert_eq!(nics.len(), 1);
        assert_eq!(nics[0].name, "br-lan");
        assert_eq!(nics[0].ipv4.as_deref(), Some("192.168.1.1"));
        assert_eq!(nics[0].mac.as_deref(), Some("10:20:30:40:50:60"));
    }
}
