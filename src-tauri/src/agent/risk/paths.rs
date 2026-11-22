use super::rules::stronger_risk;
use crate::agent::types::AgentRisk;

pub(super) fn classify_sensitive_paths_in_command_text(command: &str) -> Option<AgentRisk> {
    let mut risk = None;
    for token in command.split(|ch: char| {
        ch.is_whitespace()
            || matches!(
                ch,
                '\'' | '"' | ';' | ',' | ')' | '(' | '[' | ']' | '{' | '}' | '=' | '`'
            )
    }) {
        if token.is_empty() {
            continue;
        }
        if let Some(path_risk) = sensitive_path_risk(token) {
            risk = Some(stronger_risk(risk, path_risk));
        }
    }
    risk
}

pub(super) fn classify_read_file_payload(payload: &serde_json::Value) -> AgentRisk {
    let mut saw_recognized_field = false;
    let mut risk = None;
    let mut paths = Vec::new();

    for key in [
        "path",
        "file",
        "filepath",
        "file_path",
        "target",
        "target_path",
    ] {
        if let Some(value) = payload.get(key) {
            saw_recognized_field = true;
            let field_risk = value
                .as_str()
                .map(|path| {
                    let normalized = normalize_path(path);
                    if !paths.contains(&normalized) {
                        paths.push(normalized);
                    }
                    classify_file_read_path(path)
                })
                .unwrap_or(AgentRisk::High);
            risk = Some(stronger_risk(risk, field_risk));
        }
    }

    if !saw_recognized_field {
        return AgentRisk::High;
    }

    let risk = risk.unwrap_or(AgentRisk::High);
    if risk == AgentRisk::ReadOnly && paths.len() > 1 {
        AgentRisk::High
    } else {
        risk
    }
}

pub(super) fn classify_stream_log_payload(payload: &serde_json::Value) -> AgentRisk {
    if payload.get("path").is_some() {
        return classify_read_file_payload(payload);
    }
    AgentRisk::ReadOnly
}

pub(super) fn sensitive_path_risk(path: &str) -> Option<AgentRisk> {
    let mut risk = None;
    for path in normalize_path_variants(path) {
        if let Some(path_risk) = sensitive_normalized_path_risk(&path) {
            risk = Some(stronger_risk(risk, path_risk));
        }
    }
    risk
}

pub(super) fn normalize_path_variants(path: &str) -> Vec<String> {
    let unquoted: String = path
        .trim_matches(|ch| ch == '\'' || ch == '"')
        .chars()
        .filter(|ch| *ch != '\'' && *ch != '"')
        .collect();
    let windows_raw = unquoted.replace('\\', "/").to_ascii_lowercase();
    let shell_escaped_raw = unquoted.replace('\\', "").to_ascii_lowercase();
    let windows_collapsed = collapse_path_aliases(&windows_raw);
    let shell_escaped_collapsed = collapse_path_aliases(&shell_escaped_raw);

    let mut paths = Vec::new();
    push_unique_path(&mut paths, windows_raw);
    push_unique_path(&mut paths, windows_collapsed);
    push_unique_path(&mut paths, shell_escaped_raw);
    push_unique_path(&mut paths, shell_escaped_collapsed);
    paths
}

pub(super) fn is_sensitive_search_token(token: &str) -> bool {
    let token = token.to_ascii_lowercase();
    matches!(
        token.as_str(),
        "aws_secret_access_key" | "client_secret" | "secret_key" | "private_key"
    ) || token.ends_with("_secret")
        || token.ends_with("_secret_key")
        || token.ends_with("_access_key")
        || token.ends_with("_private_key")
}

fn classify_file_read_path(path: &str) -> AgentRisk {
    sensitive_path_risk(path).unwrap_or(AgentRisk::ReadOnly)
}

fn sensitive_normalized_path_risk(path: &str) -> Option<AgentRisk> {
    if let Some(rest) = relative_traversal_suffix(path) {
        if rest.is_empty() {
            return Some(AgentRisk::High);
        }
        let suffix_risk = sensitive_normalized_path_risk(&format!("/{rest}"));
        return Some(
            suffix_risk
                .map(|risk| stronger_risk(Some(AgentRisk::High), risk))
                .unwrap_or(AgentRisk::High),
        );
    }

    if let Some(rest) = proc_symlink_alias_suffix(path) {
        if rest.is_empty() {
            return Some(AgentRisk::High);
        }
        let target = if rest.split('/').any(|part| part == "..") {
            rest
        } else {
            format!("/{rest}")
        };
        let target_risk = sensitive_normalized_path_risk(&target);
        return Some(target_risk.unwrap_or(AgentRisk::High));
    }

    let file_name = path.rsplit('/').next().unwrap_or(path);
    if path.starts_with("/proc/")
        && (path.contains("/../") || path.ends_with("/..") || path.contains("/environ"))
    {
        return Some(AgentRisk::Blocked);
    }

    if matches!(
        path,
        "/etc/shadow" | "/etc/gshadow" | "/etc/sudoers" | "/etc/shadow-" | "/etc/gshadow-"
    ) {
        return Some(AgentRisk::Blocked);
    }

    if path.starts_with("/etc/ssl/private")
        || path.starts_with("/etc/pki/tls/private")
        || path.starts_with("/etc/letsencrypt/")
        || path.starts_with("/etc/sudoers.d")
        || [".key", ".p12", ".pfx", ".jks", ".keystore", ".kdbx"]
            .iter()
            .any(|ext| file_name.ends_with(ext))
        || matches!(
            file_name,
            ".git-credentials" | ".netrc" | "_netrc" | ".pgpass"
        )
    {
        return Some(AgentRisk::Blocked);
    }

    if file_name == ".env"
        || file_name.starts_with(".env.")
        || matches!(
            file_name,
            ".my.cnf" | "debian.cnf" | ".npmrc" | ".pypirc" | "admin.conf" | "kubeconfig"
        )
        || path.starts_with("/etc/kubernetes/")
    {
        return Some(AgentRisk::High);
    }

    if path.starts_with("/etc/security/") {
        return Some(AgentRisk::High);
    }

    if path.contains("/.ssh/")
        || path.starts_with("~/.ssh")
        || path == ".ssh"
        || path.starts_with(".ssh/")
        || file_name == "id_rsa"
        || file_name == "id_dsa"
        || file_name == "id_ecdsa"
        || file_name == "id_ed25519"
        || file_name.contains("private_key")
        || file_name.ends_with(".pem")
    {
        return Some(AgentRisk::Blocked);
    }

    if file_name == ".bash_history" || file_name == ".zsh_history" || file_name == ".history" {
        return Some(AgentRisk::Blocked);
    }

    if path.contains("/.config")
        || path.starts_with("~/.config")
        || path == ".config"
        || path.starts_with(".config/")
        || path.contains("/.aws")
        || path.starts_with("~/.aws")
        || path == ".aws"
        || path.starts_with(".aws/")
        || path.contains("/.kube")
        || path.starts_with("~/.kube")
        || path == ".kube"
        || path.starts_with(".kube/")
        || path.contains("/.docker")
        || path.starts_with("~/.docker")
        || path == ".docker"
        || path.starts_with(".docker/")
    {
        return Some(AgentRisk::High);
    }

    None
}

fn relative_traversal_suffix(path: &str) -> Option<String> {
    if path.starts_with('/') || path.starts_with("~/") || is_windows_drive_path(path) {
        return None;
    }

    let mut saw_traversal = false;
    let mut rest = Vec::new();
    for part in path.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            saw_traversal = true;
            rest.pop();
            continue;
        }
        rest.push(part);
    }

    saw_traversal.then(|| rest.join("/"))
}

fn proc_symlink_alias_suffix(path: &str) -> Option<String> {
    let rest = path.strip_prefix("/proc/")?;
    let mut parts = rest.split('/');
    let pid = parts.next()?;
    if pid.is_empty() {
        return None;
    }
    let alias = parts.next()?;
    if !matches!(alias, "root" | "cwd") {
        return None;
    }
    Some(parts.collect::<Vec<_>>().join("/"))
}

fn normalize_path(path: &str) -> String {
    let unquoted: String = path
        .trim_matches(|ch| ch == '\'' || ch == '"')
        .chars()
        .filter(|ch| *ch != '\'' && *ch != '"')
        .collect();
    collapse_path_aliases(&unquoted.replace('\\', "/").to_ascii_lowercase())
}

fn push_unique_path(paths: &mut Vec<String>, path: String) {
    if !paths.contains(&path) {
        paths.push(path);
    }
}

fn collapse_path_aliases(path: &str) -> String {
    let (prefix, rest) = if let Some(rest) = path.strip_prefix("~/") {
        ("~", rest)
    } else if path.starts_with('/') {
        ("", path.trim_start_matches('/'))
    } else if is_windows_drive_path(path) {
        (&path[..2], &path[3..])
    } else {
        return path
            .split('/')
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join("/");
    };

    let mut parts = Vec::new();
    for part in rest.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(part),
        }
    }

    let joined = parts.join("/");
    match prefix {
        "" => format!("/{joined}"),
        "~" => {
            if joined.is_empty() {
                "~".to_string()
            } else {
                format!("~/{joined}")
            }
        }
        drive => {
            if joined.is_empty() {
                format!("{drive}/")
            } else {
                format!("{drive}/{joined}")
            }
        }
    }
}

fn is_windows_drive_path(path: &str) -> bool {
    path.len() >= 3
        && path.as_bytes()[1] == b':'
        && path.as_bytes()[2] == b'/'
        && path.as_bytes()[0].is_ascii_alphabetic()
}
