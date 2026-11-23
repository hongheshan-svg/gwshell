// Pure JSON & RFC 4180 CSV serialization/parsing helpers for Asset List
// import and export. Exports ALWAYS strip all secret fields (passwords, TOTP).

use crate::session::{AuthMethod, SessionConfig, SessionType};
use std::collections::HashMap;

const UTF8_BOM: &str = "\u{FEFF}";

const CSV_HEADERS: &[&str] = &[
    "name",
    "session_type",
    "group",
    "host",
    "port",
    "username",
    "auth_method",
    "private_key_path",
    "jump_host",
    "jump_port",
    "jump_username",
    "color_label",
    "expired_at",
    "remark",
];

pub fn strip_secrets(sessions: &mut [SessionConfig]) {
    for s in sessions {
        s.password = None;
        s.jump_password = None;
        s.proxy_password = None;
        s.totp_code = None;
    }
}

pub fn export_sessions_to_json(sessions: &[SessionConfig]) -> Result<String, String> {
    let mut sanitized: Vec<SessionConfig> = sessions.to_vec();
    strip_secrets(&mut sanitized);
    serde_json::to_string_pretty(&sanitized).map_err(|e| e.to_string())
}

fn csv_escape(field: &str) -> String {
    if field.contains([',', '"', '\n', '\r']) {
        let escaped = field.replace('"', "\"\"");
        format!("\"{}\"", escaped)
    } else {
        field.to_string()
    }
}

fn session_type_str(t: &SessionType) -> &'static str {
    match t {
        SessionType::Ssh => "ssh",
        SessionType::LocalShell => "localshell",
        SessionType::Docker => "docker",
        SessionType::Serial => "serial",
    }
}

fn auth_method_str(m: &AuthMethod) -> &'static str {
    match m {
        AuthMethod::Password => "password",
        AuthMethod::PublicKey => "publickey",
        AuthMethod::KeyboardInteractive => "keyboardinteractive",
        AuthMethod::Agent => "agent",
        AuthMethod::None => "none",
    }
}

fn parse_session_type(s: &str) -> SessionType {
    match s.trim().to_ascii_lowercase().as_str() {
        "localshell" | "local" | "shell" | "本地" | "本地终端" => SessionType::LocalShell,
        "docker" | "容器" => SessionType::Docker,
        "serial" | "串口" => SessionType::Serial,
        _ => SessionType::Ssh,
    }
}

fn parse_auth_method(s: &str, has_key_path: bool) -> AuthMethod {
    match s.trim().to_ascii_lowercase().as_str() {
        "publickey" | "key" | "sshkey" | "privatekey" | "公钥" | "密钥" => {
            AuthMethod::PublicKey
        }
        "keyboardinteractive" | "keyboard-interactive" | "2fa" | "totp" => {
            AuthMethod::KeyboardInteractive
        }
        "agent" | "ssh-agent" => AuthMethod::Agent,
        "none" | "无" => AuthMethod::None,
        "password" | "密码" => AuthMethod::Password,
        "" => {
            if has_key_path {
                AuthMethod::PublicKey
            } else {
                AuthMethod::Password
            }
        }
        _ => AuthMethod::Password,
    }
}

/// Export sessions as UTF-8 BOM RFC 4180 CSV (opens cleanly in Excel with CJK
/// text). Passwords and TOTP secrets are never included.
pub fn export_sessions_to_csv(sessions: &[SessionConfig]) -> String {
    let mut out = String::from(UTF8_BOM);
    out.push_str(&CSV_HEADERS.join(","));
    out.push('\n');

    for s in sessions {
        let port = s.port.map(|p| p.to_string()).unwrap_or_default();
        let jump_port = s.jump_port.map(|p| p.to_string()).unwrap_or_default();
        let row = [
            s.name.as_str(),
            session_type_str(&s.session_type),
            s.group.as_deref().unwrap_or(""),
            s.host.as_deref().unwrap_or(""),
            port.as_str(),
            s.username.as_deref().unwrap_or(""),
            auth_method_str(&s.auth_method),
            s.private_key_path.as_deref().unwrap_or(""),
            s.jump_host.as_deref().unwrap_or(""),
            jump_port.as_str(),
            s.jump_username.as_deref().unwrap_or(""),
            s.color_label.as_deref().unwrap_or(""),
            s.expired_at.as_deref().unwrap_or(""),
            s.remark.as_deref().unwrap_or(""),
        ];
        let line: Vec<String> = row.iter().map(|f| csv_escape(f)).collect();
        out.push_str(&line.join(","));
        out.push('\n');
    }
    out
}

pub fn csv_template() -> String {
    let mut out = String::from(UTF8_BOM);
    out.push_str(&CSV_HEADERS.join(","));
    out.push('\n');
    out.push_str(
        "prod-web-01,ssh,Production,10.0.1.10,22,root,publickey,~/.ssh/id_ed25519,,,,,2027-12-31,Primary web node\n",
    );
    out.push_str(
        "internal-db,ssh,Database,10.0.2.20,22,ubuntu,password,,bastion.example.com,22,ops,#3b82f6,,Access via jump host\n",
    );
    out
}

/// Parse JSON export (supports both bare `[SessionConfig, ...]` and
/// `{"sessions": [...]}` wrapper).
pub fn parse_sessions_from_json(raw: &str) -> Result<Vec<SessionConfig>, String> {
    let content = raw.strip_prefix(UTF8_BOM).unwrap_or(raw).trim();
    if content.is_empty() {
        return Err("Import file is empty".to_string());
    }

    let mut sessions: Vec<SessionConfig> = if content.starts_with('[') {
        serde_json::from_str(content).map_err(|e| format!("Invalid JSON array: {}", e))?
    } else if content.starts_with('{') {
        #[derive(serde::Deserialize)]
        struct Wrapper {
            sessions: Vec<SessionConfig>,
        }
        let wrapped: Wrapper =
            serde_json::from_str(content).map_err(|e| format!("Invalid JSON object: {}", e))?;
        wrapped.sessions
    } else {
        return Err("Unrecognized JSON asset format".to_string());
    };

    for s in &mut sessions {
        if s.id.trim().is_empty() {
            s.id = uuid::Uuid::new_v4().to_string();
        }
        if s.name.trim().is_empty() {
            s.name = s
                .host
                .clone()
                .filter(|h| !h.trim().is_empty())
                .unwrap_or_else(|| "Imported Session".to_string());
        }
    }
    Ok(sessions)
}

/// RFC 4180 CSV parser supporting quoted fields, `""` escapes, and embedded
/// newlines inside quoted values.
fn parse_csv_records(input: &str) -> Vec<Vec<String>> {
    let input = input.strip_prefix(UTF8_BOM).unwrap_or(input);
    let mut records: Vec<Vec<String>> = Vec::new();
    let mut row: Vec<String> = Vec::new();
    let mut field = String::new();
    let mut in_quotes = false;
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        if in_quotes {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    field.push('"');
                } else {
                    in_quotes = false;
                }
            } else {
                field.push(c);
            }
        } else {
            match c {
                '"' if field.is_empty() => {
                    in_quotes = true;
                }
                ',' => {
                    row.push(std::mem::take(&mut field));
                }
                '\r' => {
                    if chars.peek() == Some(&'\n') {
                        chars.next();
                    }
                    row.push(std::mem::take(&mut field));
                    records.push(std::mem::take(&mut row));
                }
                '\n' => {
                    row.push(std::mem::take(&mut field));
                    records.push(std::mem::take(&mut row));
                }
                _ => field.push(c),
            }
        }
    }

    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        records.push(row);
    }
    records
}

fn canonical_header(raw: &str) -> Option<&'static str> {
    let norm = raw.trim().to_ascii_lowercase().replace([' ', '-'], "_");
    match norm.as_str() {
        "name" | "alias" | "title" | "名称" | "标题" | "会话名称" => Some("name"),
        "session_type" | "type" | "protocol" | "类型" | "协议" => Some("session_type"),
        "group" | "folder" | "category" | "分组" | "组" => Some("group"),
        "host" | "hostname" | "ip" | "address" | "server" | "主机" | "地址" | "服务器" => {
            Some("host")
        }
        "port" | "端口" => Some("port"),
        "username" | "user" | "login" | "用户" | "用户名" => Some("username"),
        "auth_method" | "auth" | "认证" | "认证方式" => Some("auth_method"),
        "private_key_path" | "key_path" | "identity_file" | "key" | "私钥" | "私钥路径" => {
            Some("private_key_path")
        }
        "jump_host" | "bastion" | "跳板机" | "跳板主机" => Some("jump_host"),
        "jump_port" | "跳板端口" => Some("jump_port"),
        "jump_username" | "jump_user" | "跳板用户" => Some("jump_username"),
        "color_label" | "color" | "颜色" | "标签颜色" => Some("color_label"),
        "expired_at" | "expire" | "expires" | "到期时间" | "过期时间" => Some("expired_at"),
        "remark" | "note" | "notes" | "description" | "comment" | "备注" | "说明" => {
            Some("remark")
        }
        _ => None,
    }
}

fn non_empty(s: Option<&String>) -> Option<String> {
    s.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

pub fn parse_sessions_from_csv(raw: &str, today: &str) -> Result<Vec<SessionConfig>, String> {
    let records = parse_csv_records(raw);
    let mut iter = records.into_iter().filter(|row| {
        let all_empty = row.iter().all(|c| c.trim().is_empty());
        let is_comment = row
            .first()
            .is_some_and(|first| first.trim_start().starts_with('#'));
        !all_empty && !is_comment
    });

    let header_row = iter
        .next()
        .ok_or_else(|| "CSV file has no header row".to_string())?;
    let mut col_map: HashMap<&'static str, usize> = HashMap::new();
    for (idx, col) in header_row.iter().enumerate() {
        if let Some(canon) = canonical_header(col) {
            col_map.entry(canon).or_insert(idx);
        }
    }
    if !col_map.contains_key("name") && !col_map.contains_key("host") {
        return Err(
            "CSV header must include at least a 'name' or 'host' column (e.g. name,host,port,username)"
                .to_string(),
        );
    }

    let mut sessions = Vec::new();
    for row in iter {
        let get = |key: &str| col_map.get(key).and_then(|&idx| row.get(idx));
        let session_type = get("session_type")
            .map(|s| parse_session_type(s))
            .unwrap_or(SessionType::Ssh);
        let host = non_empty(get("host"));
        let name = non_empty(get("name")).or_else(|| host.clone());
        let Some(name) = name else {
            continue;
        };
        if session_type == SessionType::Ssh && host.is_none() {
            continue;
        }
        let port = non_empty(get("port"))
            .and_then(|p| p.parse::<u16>().ok())
            .or(if session_type == SessionType::Ssh {
                Some(22)
            } else {
                None
            });
        let private_key_path = non_empty(get("private_key_path"));
        let auth_method = parse_auth_method(
            get("auth_method").map(String::as_str).unwrap_or(""),
            private_key_path.is_some(),
        );
        let jump_port = non_empty(get("jump_port")).and_then(|p| p.parse::<u16>().ok());

        sessions.push(SessionConfig {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            session_type,
            group: non_empty(get("group")),
            host,
            port,
            username: non_empty(get("username")),
            auth_method,
            private_key_path,
            jump_host: non_empty(get("jump_host")),
            jump_port,
            jump_username: non_empty(get("jump_username")),
            color_label: non_empty(get("color_label")),
            expired_at: non_empty(get("expired_at")),
            remark: non_empty(get("remark")),
            created_at: Some(today.to_string()),
            ..Default::default()
        });
    }

    if sessions.is_empty() {
        return Err("No valid asset rows found in CSV file".to_string());
    }
    Ok(sessions)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_ssh() -> SessionConfig {
        SessionConfig {
            id: "s-1".to_string(),
            name: "prod, web \"01\"".to_string(),
            session_type: SessionType::Ssh,
            group: Some("生产环境".to_string()),
            host: Some("10.0.1.10".to_string()),
            port: Some(2222),
            username: Some("admin".to_string()),
            auth_method: AuthMethod::PublicKey,
            password: Some("super-secret".to_string()),
            private_key_path: Some("~/.ssh/id_ed25519".to_string()),
            totp_code: Some("JBSWY3DPEHPK3PXP".to_string()),
            jump_host: Some("bastion.example.com".to_string()),
            jump_port: Some(22),
            jump_username: Some("ops".to_string()),
            jump_password: Some("jump-secret".to_string()),
            proxy_password: Some("proxy-secret".to_string()),
            color_label: Some("#10b981".to_string()),
            expired_at: Some("2027-01-01".to_string()),
            remark: Some("Line 1\nLine 2".to_string()),
            ..Default::default()
        }
    }

    #[test]
    fn json_export_strips_all_secrets_and_roundtrips() {
        let json = export_sessions_to_json(&[sample_ssh()]).unwrap();
        assert!(!json.contains("super-secret"));
        assert!(!json.contains("jump-secret"));
        assert!(!json.contains("proxy-secret"));
        assert!(!json.contains("JBSWY3DPEHPK3PXP"));

        let parsed = parse_sessions_from_json(&json).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].id, "s-1");
        assert_eq!(parsed[0].host.as_deref(), Some("10.0.1.10"));
        assert_eq!(parsed[0].port, Some(2222));
    }

    #[test]
    fn json_import_accepts_wrapped_object_and_generates_missing_id() {
        let wrapped = r#"{"sessions":[{"id":"","name":"web","host":"1.2.3.4","port":22}]}"#;
        let parsed = parse_sessions_from_json(wrapped).unwrap();
        assert_eq!(parsed.len(), 1);
        assert!(!parsed[0].id.is_empty());
        assert_eq!(parsed[0].name, "web");
    }

    #[test]
    fn csv_export_strips_secrets_and_roundtrips_quoted_fields() {
        let csv = export_sessions_to_csv(&[sample_ssh()]);
        assert!(csv.starts_with(UTF8_BOM));
        assert!(!csv.contains("super-secret"));
        assert!(!csv.contains("JBSWY3DPEHPK3PXP"));

        let parsed = parse_sessions_from_csv(&csv, "2026-11-23").unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].name, "prod, web \"01\"");
        assert_eq!(parsed[0].group.as_deref(), Some("生产环境"));
        assert_eq!(parsed[0].host.as_deref(), Some("10.0.1.10"));
        assert_eq!(parsed[0].port, Some(2222));
        assert_eq!(parsed[0].remark.as_deref(), Some("Line 1\nLine 2"));
        assert_eq!(parsed[0].jump_host.as_deref(), Some("bastion.example.com"));
        assert_eq!(parsed[0].created_at.as_deref(), Some("2026-11-23"));
    }

    #[test]
    fn csv_import_supports_chinese_headers_and_skips_blank_or_comment_rows() {
        let csv = "\u{FEFF}名称,分组,主机,端口,用户名,备注\n\
# comment row\n\
\n\
网关节点,边缘,192.168.1.1,22,root,OpenWrt\n\
,默认,10.0.0.8,,ubuntu,\n";
        let parsed = parse_sessions_from_csv(csv, "2026-11-23").unwrap();
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].name, "网关节点");
        assert_eq!(parsed[0].group.as_deref(), Some("边缘"));
        assert_eq!(parsed[1].name, "10.0.0.8");
        assert_eq!(parsed[1].port, Some(22));
    }

    #[test]
    fn csv_template_parses_cleanly() {
        let tpl = csv_template();
        let parsed = parse_sessions_from_csv(&tpl, "2026-11-23").unwrap();
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].name, "prod-web-01");
        assert_eq!(parsed[1].jump_host.as_deref(), Some("bastion.example.com"));
    }
}
