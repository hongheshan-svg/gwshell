use crate::session::{AuthMethod, SessionConfig};

#[derive(Clone, Debug)]
pub struct ConnectParams {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub auth_method: String,
    pub totp_code: Option<String>,
    pub jump_host: Option<String>,
    pub jump_port: u16,
    pub jump_username: Option<String>,
    pub jump_password: Option<String>,
    pub jump_private_key_path: Option<String>,
    pub proxy_type: Option<String>,
    pub proxy_host: Option<String>,
    pub proxy_port: u16,
    pub proxy_username: Option<String>,
    pub proxy_password: Option<String>,
    pub connection_timeout: u32,
    pub idle_disconnect_minutes: u32,
    /// Enable SSH agent forwarding (`-A`): let the remote host use the local
    /// agent for onward authentication hops. Off by default.
    pub agent_forward: bool,
    /// How often (in seconds) to send SSH keepalive packets. `None` uses the
    /// compiled-in default (30 s). Set to `0` to disable keepalives.
    pub keepalive_interval: Option<u64>,
    /// Max consecutive unanswered keepalives before closing the connection.
    /// `None` uses the compiled-in default (3).
    pub server_alive_count_max: Option<u32>,
    /// Enable SSH zlib compression (`-C`).
    pub compression: bool,
    /// Optional newline-separated `KEY=VALUE` environment variables sent via
    /// SSH `env` channel requests before starting the shell.
    pub env_vars: Option<String>,
}

/// Build SSH `ConnectParams` from a saved SSH `SessionConfig`.
pub fn connect_params_from_session(s: &SessionConfig) -> ConnectParams {
    let auth_method = match s.auth_method {
        AuthMethod::Password => "password".to_string(),
        AuthMethod::PublicKey => "publickey".to_string(),
        AuthMethod::KeyboardInteractive => "keyboardinteractive".to_string(),
        AuthMethod::Agent => "agent".to_string(),
        AuthMethod::None => "none".to_string(),
    };

    ConnectParams {
        host: s.host.clone().unwrap_or_default(),
        port: s.port.unwrap_or(22),
        username: s.username.clone().unwrap_or_default(),
        password: s.password.clone(),
        private_key_path: s.private_key_path.clone(),
        auth_method,
        totp_code: s.totp_code.clone(),
        jump_host: s.jump_host.clone(),
        jump_port: s.jump_port.unwrap_or(22),
        jump_username: s.jump_username.clone(),
        jump_password: s.jump_password.clone(),
        jump_private_key_path: s.jump_private_key_path.clone(),
        proxy_type: s.proxy_type.clone(),
        proxy_host: s.proxy_host.clone(),
        proxy_port: s.proxy_port.unwrap_or(1080),
        proxy_username: s.proxy_username.clone(),
        proxy_password: s.proxy_password.clone(),
        connection_timeout: s.connection_timeout.unwrap_or(30),
        idle_disconnect_minutes: s.idle_disconnect_minutes.unwrap_or(0),
        agent_forward: s.agent_forward.unwrap_or(false),
        keepalive_interval: s.keepalive_interval.map(|v| v as u64),
        server_alive_count_max: s.server_alive_count_max,
        compression: s.compression.unwrap_or(false),
        env_vars: s.env_vars.clone(),
    }
}
