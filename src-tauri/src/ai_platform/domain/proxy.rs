use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyServerRecord {
    pub running: bool,
    pub listen_host: String,
    pub listen_port: u16,
    pub log_requests: bool,
    pub connect_timeout_seconds: u32,
    pub request_timeout_seconds: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProxyAppSwitchesRecord {
    pub claude: bool,
    pub codex: bool,
    pub gemini: bool,
    pub opencode: bool,
    pub openclaw: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FailoverPolicyRecord {
    pub enabled: bool,
    pub consecutive_failures: u32,
    pub cooldown_seconds: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyControlPlaneRecord {
    pub server: ProxyServerRecord,
    pub takeover: ProxyAppSwitchesRecord,
    pub failover: ProxyAppSwitchesRecord,
    pub failover_policy: FailoverPolicyRecord,
    pub expose_proxy_toggle: bool,
    pub expose_failover_toggle: bool,
}

impl Default for ProxyControlPlaneRecord {
    fn default() -> Self {
        Self {
            server: ProxyServerRecord {
                running: false,
                listen_host: "127.0.0.1".to_string(),
                listen_port: 8787,
                log_requests: false,
                connect_timeout_seconds: 15,
                request_timeout_seconds: 90,
            },
            takeover: ProxyAppSwitchesRecord::default(),
            failover: ProxyAppSwitchesRecord::default(),
            failover_policy: FailoverPolicyRecord {
                enabled: false,
                consecutive_failures: 3,
                cooldown_seconds: 60,
            },
            expose_proxy_toggle: true,
            expose_failover_toggle: false,
        }
    }
}