export interface SessionConfig {
  id: string;
  name: string;
  session_type: 'ssh' | 'sftp' | 'localshell' | 'docker' | 'serial';
  group?: string;
  host?: string;
  port?: number;
  username?: string;
  auth_method: 'password' | 'publickey' | 'keyboardinteractive' | 'agent' | 'none';
  password?: string;
  private_key_path?: string;
  totp_code?: string;
  latency?: number | null;
  created_at?: string;
  expired_at?: string;
  remark?: string;
  color_label?: string;
  environment?: string;
  // Jump host (ProxyJump -J)
  jump_host?: string;
  jump_port?: number;
  jump_username?: string;
  jump_password?: string;
  jump_private_key_path?: string;
  // Proxy
  proxy_type?: 'none' | 'socks5' | 'http';
  proxy_host?: string;
  proxy_port?: number;
  proxy_username?: string;
  proxy_password?: string;
  // Tunnel (local/remote port forwarding)
  tunnel_enabled?: boolean;
  tunnel_type?: 'local' | 'remote';
  tunnel_local_port?: number;
  tunnel_remote_host?: string;
  tunnel_remote_port?: number;
  // Advanced
  keepalive_interval?: number;
  connection_timeout?: number;
  server_alive_count_max?: number;
  compression?: boolean;
  // Docker-specific
  docker_protocol?: 'unix' | 'tcp' | 'http' | 'https';
  docker_unix_path?: string;
  docker_connect_method?: string;
  docker_ssh_tunnel?: string;
  // Serial-specific
  serial_port?: string;
  serial_baud_rate?: string;
  serial_data_bits?: string;
  serial_stop_bits?: string;
  serial_parity?: string;
  serial_encoding?: string;
  serial_init_commands?: string;
  // Local shell
  working_dir?: string;
  shell_name?: string;
  charset?: string;
  init_command?: string;
  // Environment variables (key=value lines)
  env_vars?: string;
  // Internal: temporary sessions created by split-screen cloning (not persisted)
  _temporary?: boolean;
}

export interface SessionGroup {
  name: string;
  sessions: SessionConfig[];
}

export interface TabInfo {
  id: string;
  sessionId: string;
  title: string;
  type: 'ssh' | 'sftp' | 'localshell' | 'docker' | 'serial' | 'asset-list';
  connected: boolean;
}

export type ThemeMode = 'dark' | 'light';
export type MainView = 'asset-list' | 'terminal';

// ─── Auto Mode ───────────────────────────────────────────────
export interface AutoModeDetectionContext {
  /** Rendered visible lines (top→bottom), already stripped of ANSI by xterm */
  visibleLines: string[];
  cursorRow: number;
  cursorCol: number;
  /** Terminal is in alt-screen mode (alt buffer active) */
  inAltScreen: boolean;
  /** ms since last onWriteParsed */
  idleMs: number;
  /** ms timestamp of last user keypress (for suppression gate) */
  lastUserInputAt: number;
  /** Date.now() at time of detection */
  now: number;
}

export interface AutoModeMatchResult {
  /** Raw bytes to send to the PTY/SSH, e.g. "2\r" or "y\r" */
  response: string;
  /** Human-readable label shown in the log panel */
  label: string;
  /** Name of the rule that matched */
  ruleName: string;
}

export interface AutoModeRule {
  id: string;
  name: string;
  /** Higher priority rules try first; first non-null match wins */
  priority: number;
  match: (ctx: AutoModeDetectionContext) => AutoModeMatchResult | null;
}

export interface AutoModeCustomRule {
  id: string;
  enabled: boolean;
  priority: number;
  /** regex source string */
  pattern: string;
  /** regex flags, e.g. "im" */
  flags: string;
  /** raw bytes to send; backslash escapes (\r \n \t \xHH) are decoded at load time */
  response: string;
  /** log label */
  label: string;
}

export interface AutoModeLogEntry {
  id: string;
  time: number;
  kind: 'info' | 'warning' | 'error';
  label: string;
  ruleName?: string;
  response?: string;
}
