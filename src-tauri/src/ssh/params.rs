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
}
