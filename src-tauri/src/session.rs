use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub compression: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SessionType {
    Ssh,
    Sftp,
    LocalShell,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AuthMethod {
    Password,
    PublicKey,
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
            compression: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionGroup {
    pub name: String,
    pub sessions: Vec<SessionConfig>,
}
