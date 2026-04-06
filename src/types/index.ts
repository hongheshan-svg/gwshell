export interface SessionConfig {
  id: string;
  name: string;
  session_type: 'ssh' | 'sftp' | 'localshell' | 'docker' | 'serial';
  group?: string;
  host?: string;
  port?: number;
  username?: string;
  auth_method: 'password' | 'publickey' | 'keyboardinteractive';
  password?: string;
  private_key_path?: string;
  latency?: number | null;
  created_at?: string;
  expired_at?: string;
  remark?: string;
  color_label?: string;
  environment?: string;
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
