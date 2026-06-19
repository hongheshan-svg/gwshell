use super::types::{AgentRisk, AgentToolCall, AgentToolName};

pub fn classify_tool_call(call: &AgentToolCall) -> AgentRisk {
    match call.tool {
        AgentToolName::RunCommand => {
            let command = call
                .payload
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            classify_command(command)
        }
        AgentToolName::StreamLog | AgentToolName::DockerLogs => AgentRisk::ReadOnly,
        AgentToolName::ReadFile => classify_read_file_payload(&call.payload),
        AgentToolName::RestartService => AgentRisk::Medium,
    }
}

pub fn classify_command(command: &str) -> AgentRisk {
    let c = command.trim().to_ascii_lowercase();
    if c.is_empty() {
        return AgentRisk::Blocked;
    }
    if contains_destructive_dd_command(&c) {
        return AgentRisk::Blocked;
    }
    if c.contains("rm -rf /")
        || c.contains("mkfs")
        || c.contains("passwd ")
        || c.contains("userdel ")
        || c.contains("chmod -r 777 /")
        || c.contains("iptables ")
        || c.contains("ufw ")
        || c.contains("firewall-cmd")
    {
        return AgentRisk::Blocked;
    }
    if has_shell_control_syntax(&c) {
        return AgentRisk::High;
    }
    if is_mutating_journalctl_command(&c) {
        return AgentRisk::Medium;
    }
    if let Some(risk) = classify_sensitive_read_command(&c) {
        return risk;
    }
    if matches_command(&c, "df")
        || matches_command(&c, "free")
        || matches_command(&c, "journalctl")
        || matches_command(&c, "systemctl status")
        || matches_command(&c, "ss")
        || matches_command(&c, "ps")
        || matches_command(&c, "docker logs")
        || matches_command(&c, "docker ps")
        || c.starts_with("cat /proc/")
        || matches_command(&c, "tail")
        || matches_command(&c, "grep")
    {
        return AgentRisk::ReadOnly;
    }
    if matches_command(&c, "systemctl reload") {
        return AgentRisk::Low;
    }
    if matches_command(&c, "systemctl restart")
        || matches_command(&c, "docker restart")
        || matches_command(&c, "kill")
    {
        return AgentRisk::Medium;
    }
    if matches_command(&c, "rm")
        || matches_command(&c, "truncate")
        || matches_command(&c, "reboot")
        || matches_command(&c, "shutdown")
        || matches_command(&c, "systemctl stop")
    {
        return AgentRisk::High;
    }
    AgentRisk::Medium
}

fn has_shell_control_syntax(command: &str) -> bool {
    command.contains(';')
        || command.contains("&&")
        || command.contains("||")
        || command.contains('|')
        || command.contains('&')
        || command.contains('\n')
        || command.contains('\r')
        || command.contains("$(")
        || command.contains('`')
        || command.contains('>')
        || command.contains('<')
}

fn matches_command(command: &str, prefix: &str) -> bool {
    command == prefix
        || command
            .strip_prefix(prefix)
            .and_then(|rest| rest.chars().next())
            .is_some_and(char::is_whitespace)
}

fn contains_destructive_dd_command(command: &str) -> bool {
    command
        .split(is_shell_segment_separator)
        .any(segment_contains_destructive_dd)
}

fn is_shell_segment_separator(ch: char) -> bool {
    matches!(ch, ';' | '|' | '&' | '\n' | '\r' | '>' | '<')
}

fn segment_contains_destructive_dd(segment: &str) -> bool {
    let mut saw_dd = false;
    for part in segment.split_whitespace() {
        if command_word_name(part) == "dd" {
            saw_dd = true;
            continue;
        }
        if saw_dd && (part.starts_with("if=") || part.starts_with("of=")) {
            return true;
        }
    }
    false
}

fn command_word_name(word: &str) -> &str {
    let trimmed = word.trim_matches(|ch| ch == '\'' || ch == '"');
    trimmed.rsplit('/').next().unwrap_or(trimmed)
}

fn is_mutating_journalctl_command(command: &str) -> bool {
    matches_command(command, "journalctl")
        && command.split_whitespace().skip(1).any(|part| {
            part == "--rotate"
                || part == "--flush"
                || part.starts_with("--vacuum-time")
                || part.starts_with("--vacuum-size")
                || part.starts_with("--vacuum-files")
        })
}

fn classify_read_file_payload(payload: &serde_json::Value) -> AgentRisk {
    for key in [
        "path",
        "file",
        "filepath",
        "file_path",
        "target",
        "target_path",
    ] {
        if let Some(path) = payload.get(key).and_then(|value| value.as_str()) {
            return classify_file_read_path(path);
        }
    }
    AgentRisk::ReadOnly
}

fn classify_file_read_path(path: &str) -> AgentRisk {
    sensitive_path_risk(path).unwrap_or(AgentRisk::ReadOnly)
}

fn classify_sensitive_read_command(command: &str) -> Option<AgentRisk> {
    if !(matches_command(command, "tail") || matches_command(command, "grep")) {
        return None;
    }

    let mut risk = None;
    for token in command.split_whitespace().skip(1) {
        let token = token.trim_matches(|ch| ch == '\'' || ch == '"');
        if let Some(path_risk) = sensitive_path_risk(token) {
            risk = Some(stronger_risk(risk, path_risk));
        } else if matches_command(command, "grep") && is_sensitive_search_token(token) {
            risk = Some(stronger_risk(risk, AgentRisk::High));
        }
    }
    risk
}

fn sensitive_path_risk(path: &str) -> Option<AgentRisk> {
    let path = path
        .trim_matches(|ch| ch == '\'' || ch == '"')
        .to_ascii_lowercase();
    let file_name = path.rsplit('/').next().unwrap_or(&path);

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

fn is_sensitive_search_token(token: &str) -> bool {
    let token = token.to_ascii_lowercase();
    matches!(
        token.as_str(),
        "aws_secret_access_key" | "client_secret" | "secret_key" | "private_key"
    ) || token.ends_with("_secret")
        || token.ends_with("_secret_key")
        || token.ends_with("_access_key")
        || token.ends_with("_private_key")
}

fn stronger_risk(current: Option<AgentRisk>, next: AgentRisk) -> AgentRisk {
    match (current, next) {
        (Some(AgentRisk::Blocked), _) | (_, AgentRisk::Blocked) => AgentRisk::Blocked,
        (Some(AgentRisk::High), _) | (_, AgentRisk::High) => AgentRisk::High,
        (Some(AgentRisk::Medium), _) | (_, AgentRisk::Medium) => AgentRisk::Medium,
        (Some(AgentRisk::Low), _) | (_, AgentRisk::Low) => AgentRisk::Low,
        _ => AgentRisk::ReadOnly,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_only_commands_are_read_only() {
        assert_eq!(classify_command("df -hP"), AgentRisk::ReadOnly);
        assert_eq!(
            classify_command("journalctl -u nginx -n 50"),
            AgentRisk::ReadOnly
        );
        assert_eq!(
            classify_command("docker logs --tail=100 web"),
            AgentRisk::ReadOnly
        );
    }

    #[test]
    fn read_file_secret_targets_are_not_read_only() {
        assert_eq!(
            classify_tool_call(&read_file_call("~/.ssh/id_rsa")),
            AgentRisk::Blocked
        );
        assert_eq!(
            classify_tool_call(&read_file_call("~/.bash_history")),
            AgentRisk::Blocked
        );
        assert_eq!(
            classify_tool_call(&read_file_call(
                "~/.config/gcloud/configurations/config_default"
            )),
            AgentRisk::High
        );
    }

    #[test]
    fn tail_and_grep_secret_targets_are_not_read_only() {
        assert_eq!(classify_command("tail ~/.bash_history"), AgentRisk::Blocked);
        assert_eq!(
            classify_command("grep -R AWS_SECRET_ACCESS_KEY ~/.config"),
            AgentRisk::High
        );
        assert_eq!(
            classify_command("tail -n 100 /var/log/app.log"),
            AgentRisk::ReadOnly
        );
        assert_eq!(
            classify_command("grep error /var/log/app.log"),
            AgentRisk::ReadOnly
        );
    }

    #[test]
    fn dangerous_commands_are_blocked_or_high() {
        assert_eq!(classify_command("rm -rf /"), AgentRisk::Blocked);
        assert_eq!(classify_command("iptables -F"), AgentRisk::Blocked);
        assert_eq!(
            classify_command("dd bs=1M of=/dev/sda if=/dev/zero"),
            AgentRisk::Blocked
        );
        assert_eq!(classify_command("rm /tmp/file"), AgentRisk::High);
        assert_eq!(
            classify_command("systemctl restart nginx"),
            AgentRisk::Medium
        );
    }

    #[test]
    fn wrapped_or_segmented_destructive_dd_is_blocked() {
        for command in [
            "sudo dd of=/dev/sda",
            "env X=1 dd of=/dev/sda",
            "true; dd of=/dev/sda",
            "/bin/dd of=/dev/sda",
            "sudo /bin/dd of=/dev/sda",
            "sh -c 'dd of=/dev/sda'",
            "'dd' of=/dev/sda",
        ] {
            assert_eq!(classify_command(command), AgentRisk::Blocked, "{command}");
        }
    }

    #[test]
    fn mutating_journalctl_commands_are_not_read_only() {
        for command in [
            "journalctl --vacuum-time=1d",
            "journalctl --vacuum-size=1G",
            "journalctl --vacuum-files=1",
            "journalctl --rotate",
            "journalctl --flush",
        ] {
            assert_eq!(classify_command(command), AgentRisk::Medium, "{command}");
        }
    }

    #[test]
    fn shell_composition_is_not_read_only() {
        for command in [
            "df -h; shutdown now",
            "docker ps && docker restart web",
            "journalctl -u nginx || shutdown now",
            "df -h | sh",
            "df -h\nshutdown now",
            "df -h $(shutdown now)",
            "df -h `shutdown now`",
            "grep x file > /etc/app.conf",
            "cat /proc/cpuinfo < /tmp/input",
            "df -h & shutdown now",
            "cat /proc/cpuinfo&true",
            "cat /proc/cpuinfo&rm -rf /tmp/x",
        ] {
            assert_ne!(classify_command(command), AgentRisk::ReadOnly, "{command}");
        }
    }

    #[test]
    fn read_only_matching_respects_command_boundaries() {
        assert_eq!(classify_command("docker psx"), AgentRisk::Medium);
    }

    fn read_file_call(path: &str) -> AgentToolCall {
        AgentToolCall {
            id: "c1".into(),
            tool: AgentToolName::ReadFile,
            target_session_id: "s1".into(),
            payload: serde_json::json!({ "path": path }),
            risk: AgentRisk::ReadOnly,
            reason: "read file".into(),
            expected_result: None,
            verify: None,
        }
    }
}
