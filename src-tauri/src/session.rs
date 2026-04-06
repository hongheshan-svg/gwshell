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
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionGroup {
    pub name: String,
    pub sessions: Vec<SessionConfig>,
}
