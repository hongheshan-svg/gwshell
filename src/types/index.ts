export interface SessionConfig {
  id: string;
  name: string;
  session_type: 'ssh' | 'sftp' | 'localshell';
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
}

export interface SessionGroup {
  name: string;
  sessions: SessionConfig[];
}

export interface TabInfo {
  id: string;
  sessionId: string;
  title: string;
  type: 'ssh' | 'sftp' | 'localshell' | 'asset-list';
  connected: boolean;
}

export type ThemeMode = 'dark' | 'light';
export type MainView = 'asset-list' | 'terminal';
