use crate::ai_platform::domain::sessions::{SessionAssetRecord, SessionGroupRecord};
use crate::ai_platform::interfaces::dto::sessions::SessionsSnapshotDto;
use crate::database::Database;
use crate::session::{SessionConfig, SessionType};

pub fn get_sessions_snapshot() -> Result<SessionsSnapshotDto, String> {
    let db = Database::new()?;
    let mut sessions = db.get_sessions()?;
    sessions.sort_by(|left, right| {
        right
            .created_at
            .cmp(&left.created_at)
            .then_with(|| left.name.cmp(&right.name))
    });

    let groups = db
        .get_groups()?
        .into_iter()
        .map(|group| SessionGroupRecord {
            count: group.sessions.len(),
            name: group.name,
        })
        .collect::<Vec<_>>();

    let session_items = sessions.iter().map(to_asset_record).collect::<Vec<_>>();

    Ok(SessionsSnapshotDto {
        sessions: session_items,
        groups,
        deeplink_template: "gwshell://ai/session/open?sessionId=<id>&sessionType=<type>".to_string(),
        source: "gwshell.db".to_string(),
    })
}

pub fn delete_session_record(session_id: String) -> Result<SessionsSnapshotDto, String> {
    let db = Database::new()?;
    db.delete_session(&session_id)?;
    get_sessions_snapshot()
}

fn to_asset_record(session: &SessionConfig) -> SessionAssetRecord {
    let session_type = session_type_label(&session.session_type);
    let target = session_target(session);
    let project_dir = session.working_dir.clone();
    let summary = session_summary(session);
    let resume_command = build_resume_command(session);

    SessionAssetRecord {
        id: session.id.clone(),
        name: session.name.clone(),
        session_type,
        group: session.group.clone(),
        target,
        project_dir,
        summary,
        resume_command,
        created_at: session.created_at.clone(),
        expired_at: session.expired_at.clone(),
        proxy_enabled: session.proxy_type.as_deref().is_some_and(|value| value != "none"),
        tunnel_enabled: session.tunnel_enabled.unwrap_or(false),
    }
}

fn session_type_label(session_type: &SessionType) -> String {
    match session_type {
        SessionType::Ssh => "ssh".to_string(),
        SessionType::Sftp => "sftp".to_string(),
        SessionType::LocalShell => "localshell".to_string(),
        SessionType::Docker => "docker".to_string(),
        SessionType::Serial => "serial".to_string(),
    }
}

fn session_target(session: &SessionConfig) -> String {
    match session.session_type {
        SessionType::Ssh | SessionType::Sftp => {
            let host = session.host.as_deref().unwrap_or("unknown-host");
            let port = session.port.unwrap_or(22);
            match session.username.as_deref() {
                Some(username) if !username.is_empty() => format!("{}@{}:{}", username, host, port),
                _ => format!("{}:{}", host, port),
            }
        }
        SessionType::LocalShell => session
            .working_dir
            .clone()
            .or_else(|| session.shell_name.clone())
            .unwrap_or_else(|| "local shell".to_string()),
        SessionType::Docker => session
            .docker_unix_path
            .clone()
            .or_else(|| session.docker_protocol.clone())
            .unwrap_or_else(|| "docker context".to_string()),
        SessionType::Serial => session
            .serial_port
            .clone()
            .unwrap_or_else(|| "serial port".to_string()),
    }
}

fn session_summary(session: &SessionConfig) -> String {
    let mut parts = Vec::new();
    if let Some(remark) = session.remark.as_deref().filter(|value| !value.trim().is_empty()) {
        parts.push(remark.trim().to_string());
    }
    if let Some(environment) = session.environment.as_deref().filter(|value| !value.trim().is_empty()) {
        parts.push(format!("env: {}", environment.trim()));
    }
    if session.proxy_type.as_deref().is_some_and(|value| value != "none") {
        parts.push("via proxy".to_string());
    }
    if session.tunnel_enabled.unwrap_or(false) {
        parts.push("with tunnel".to_string());
    }
    if parts.is_empty() {
        session_target(session)
    } else {
        parts.join(" · ")
    }
}

fn build_resume_command(session: &SessionConfig) -> Option<String> {
    match session.session_type {
        SessionType::Ssh | SessionType::Sftp => Some(build_ssh_resume(session)),
        SessionType::LocalShell => Some(build_local_shell_resume(session)),
        SessionType::Docker => build_docker_resume(session),
        SessionType::Serial => None,
    }
}

fn build_ssh_resume(session: &SessionConfig) -> String {
    let mut parts = vec!["ssh".to_string()];
    if let Some(private_key_path) = session.private_key_path.as_deref().filter(|value| !value.is_empty()) {
        parts.push(format!("-i \"{}\"", private_key_path));
    }
    if let Some(port) = session.port.filter(|port| *port != 22) {
        parts.push(format!("-p {}", port));
    }
    if let Some(jump_host) = session.jump_host.as_deref().filter(|value| !value.is_empty()) {
        let jump_port = session.jump_port.unwrap_or(22);
        let jump_prefix = session
            .jump_username
            .as_deref()
            .filter(|value| !value.is_empty())
            .map(|username| format!("{}@", username))
            .unwrap_or_default();
        parts.push(format!("-J {}{}:{}", jump_prefix, jump_host, jump_port));
    }
    let host = session.host.as_deref().unwrap_or("host");
    let user_prefix = session
        .username
        .as_deref()
        .filter(|value| !value.is_empty())
        .map(|username| format!("{}@", username))
        .unwrap_or_default();
    parts.push(format!("{}{}", user_prefix, host));
    parts.join(" ")
}

fn build_local_shell_resume(session: &SessionConfig) -> String {
    let shell = session
        .shell_name
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("powershell");
    match session.working_dir.as_deref().filter(|value| !value.trim().is_empty()) {
        Some(working_dir) => format!("{} -NoExit -Command \"Set-Location -LiteralPath '{}'\"", shell, working_dir.replace('"', "''")),
        None => shell.to_string(),
    }
}

fn build_docker_resume(session: &SessionConfig) -> Option<String> {
    if let Some(path) = session.docker_unix_path.as_deref().filter(|value| !value.is_empty()) {
        return Some(format!("docker -H unix://{} ps", path));
    }
    if let Some(protocol) = session.docker_protocol.as_deref().filter(|value| !value.is_empty()) {
        return Some(format!("docker --context {} ps", protocol));
    }
    None
}