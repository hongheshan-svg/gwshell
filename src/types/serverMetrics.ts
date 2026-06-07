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

export interface DiskStats {
  total_bytes: number;
  used_bytes: number;
  mount: string;
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
  disk: DiskStats | null;
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
