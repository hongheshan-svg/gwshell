use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
// `#[serde(default)]` makes deserialization forward/backward compatible: a row
// written by an older or newer build that is missing fields falls back to
// `Default` instead of failing to load (which would make the session vanish).
#[serde(default)]
pub struct SessionConfig {
    pub id: String,
    pub name: String,
    pub session_type: SessionType,
    pub group: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
    pub auth_method: AuthMethod,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub totp_code: Option<String>,
    pub latency: Option<f64>,
    pub created_at: Option<String>,
    pub expired_at: Option<String>,
    pub remark: Option<String>,
    pub color_label: Option<String>,
    pub environment: Option<String>,
    // Jump host
    pub jump_host: Option<String>,
    pub jump_port: Option<u16>,
    pub jump_username: Option<String>,
    pub jump_password: Option<String>,
    pub jump_private_key_path: Option<String>,
    // Proxy
    pub proxy_type: Option<String>,
    pub proxy_host: Option<String>,
    pub proxy_port: Option<u16>,
    pub proxy_username: Option<String>,
    pub proxy_password: Option<String>,
    // Tunnel (local/remote port forwarding)
    pub tunnel_enabled: Option<bool>,
    pub tunnel_type: Option<String>,
    pub tunnel_local_port: Option<u16>,
    pub tunnel_remote_host: Option<String>,
    pub tunnel_remote_port: Option<u16>,
    // Advanced
    pub keepalive_interval: Option<u32>,
    pub connection_timeout: Option<u32>,
    pub server_alive_count_max: Option<u32>,
    pub idle_disconnect_minutes: Option<u32>,
    pub compression: Option<bool>,
    /// SSH agent forwarding (`-A`): allow the remote host to use the local
    /// agent for onward authentication hops. `#[serde(default)]` on the struct
    /// makes this load as `None` for rows written before the field existed.
    pub agent_forward: Option<bool>,
    /// Manual override for command-completion table selection on SSH sessions:
    /// "auto" (or None) probes the remote, else "linux" | "cmd" | "powershell".
    pub remote_shell: Option<String>,
    // Docker-specific
    pub docker_protocol: Option<String>,
    pub docker_unix_path: Option<String>,
    pub docker_connect_method: Option<String>,
    pub docker_ssh_tunnel: Option<String>,
    // Serial-specific
    pub serial_port: Option<String>,
    pub serial_baud_rate: Option<String>,
    pub serial_data_bits: Option<String>,
    pub serial_stop_bits: Option<String>,
    pub serial_parity: Option<String>,
    pub serial_encoding: Option<String>,
    pub serial_flow_control: Option<String>, // "none" | "software" | "hardware"
    pub serial_init_commands: Option<String>,
    // Local shell
    pub working_dir: Option<String>,
    pub shell_name: Option<String>,
    pub charset: Option<String>,
    pub init_command: Option<String>,
    // Environment variables
    pub env_vars: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SessionType {
    Ssh,
    #[serde(alias = "localshell")]
    LocalShell,
    Docker,
    Serial,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AuthMethod {
    Password,
    #[serde(alias = "publickey")]
    PublicKey,
    #[serde(alias = "keyboardinteractive")]
    KeyboardInteractive,
    Agent,
    None,
}

impl Default for SessionConfig {
    fn default() -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name: String::from("New Session"),
            session_type: SessionType::Ssh,
            group: None,
            host: None,
            port: Some(22),
            username: None,
            auth_method: AuthMethod::Password,
            password: None,
            private_key_path: None,
            totp_code: None,
            latency: None,
            created_at: None,
            expired_at: None,
            remark: None,
            color_label: None,
            environment: None,
            jump_host: None,
            jump_port: None,
            jump_username: None,
            jump_password: None,
            jump_private_key_path: None,
            proxy_type: None,
            proxy_host: None,
            proxy_port: None,
            proxy_username: None,
            proxy_password: None,
            tunnel_enabled: None,
            tunnel_type: None,
            tunnel_local_port: None,
            tunnel_remote_host: None,
            tunnel_remote_port: None,
            keepalive_interval: None,
            connection_timeout: None,
            server_alive_count_max: None,
            idle_disconnect_minutes: None,
            compression: None,
            agent_forward: None,
            remote_shell: None,
            docker_protocol: None,
            docker_unix_path: None,
            docker_connect_method: None,
            docker_ssh_tunnel: None,
            serial_port: None,
            serial_baud_rate: None,
            serial_data_bits: None,
            serial_stop_bits: None,
            serial_parity: None,
            serial_encoding: None,
            serial_flow_control: None,
            serial_init_commands: None,
            working_dir: None,
            shell_name: None,
            charset: None,
            init_command: None,
            env_vars: None,
        }
    }
}

impl SessionConfig {
    /// Reconcile the secret fields of an incoming save with the stored copy.
    ///
    /// The WebView only ever receives REDACTED sessions (secrets are `None`), so
    /// an edit/rename/regroup round-trips with every secret unset. Treating that
    /// as "clear" silently wiped saved credentials. Semantics per field:
    ///   - `None`      → keep the existing stored value (field left untouched)
    ///   - `Some("")`  → explicitly clear the stored value
    ///   - `Some(v)`   → replace with `v`
    pub fn merge_secrets_from(&mut self, existing: Option<&SessionConfig>) {
        fn merge(incoming: &mut Option<String>, existing: Option<&Option<String>>) {
            match incoming {
                None => *incoming = existing.and_then(Clone::clone),
                Some(v) if v.is_empty() => *incoming = None,
                Some(_) => {}
            }
        }
        merge(&mut self.password, existing.map(|e| &e.password));
        merge(&mut self.jump_password, existing.map(|e| &e.jump_password));
        merge(
            &mut self.proxy_password,
            existing.map(|e| &e.proxy_password),
        );
        merge(&mut self.totp_code, existing.map(|e| &e.totp_code));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stored() -> SessionConfig {
        SessionConfig {
            id: "s1".into(),
            password: Some("pw".into()),
            jump_password: Some("jpw".into()),
            proxy_password: Some("ppw".into()),
            totp_code: Some("JBSWY3DPEHPK3PXP".into()),
            ..Default::default()
        }
    }

    #[test]
    fn redacted_edit_keeps_every_stored_secret() {
        let mut edit = SessionConfig {
            id: "s1".into(),
            name: "renamed".into(),
            ..Default::default()
        };
        edit.merge_secrets_from(Some(&stored()));
        assert_eq!(edit.password.as_deref(), Some("pw"));
        assert_eq!(edit.jump_password.as_deref(), Some("jpw"));
        assert_eq!(edit.proxy_password.as_deref(), Some("ppw"));
        assert_eq!(edit.totp_code.as_deref(), Some("JBSWY3DPEHPK3PXP"));
        assert_eq!(edit.name, "renamed");
    }

    #[test]
    fn empty_string_clears_and_value_replaces() {
        let mut edit = SessionConfig {
            id: "s1".into(),
            password: Some(String::new()),
            jump_password: Some("new".into()),
            ..Default::default()
        };
        edit.merge_secrets_from(Some(&stored()));
        assert_eq!(edit.password, None);
        assert_eq!(edit.jump_password.as_deref(), Some("new"));
        assert_eq!(edit.proxy_password.as_deref(), Some("ppw"));
    }

    #[test]
    fn new_session_without_existing_stays_unset() {
        let mut fresh = SessionConfig {
            id: "new".into(),
            password: Some(String::new()),
            ..Default::default()
        };
        fresh.merge_secrets_from(None);
        assert_eq!(fresh.password, None);
        assert_eq!(fresh.totp_code, None);
    }
}
