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
    if contains_root_destructive_rm_command(&c) {
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
    if let Some(risk) = classify_wrapped_destructive_command(&c) {
        return risk;
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
    if let Some(risk) = classify_proc_cat_command(&c) {
        return risk;
    }
    if matches_normalized_command(&c, &["df"])
        || matches_normalized_command(&c, &["free"])
        || matches_normalized_command(&c, &["journalctl"])
        || matches_normalized_command(&c, &["systemctl", "status"])
        || matches_normalized_command(&c, &["ss"])
        || matches_normalized_command(&c, &["ps"])
        || matches_normalized_command(&c, &["docker", "logs"])
        || matches_normalized_command(&c, &["docker", "ps"])
        || matches_normalized_command(&c, &["tail"])
        || matches_normalized_command(&c, &["grep"])
    {
        return AgentRisk::ReadOnly;
    }
    if matches_normalized_command(&c, &["systemctl", "reload"]) {
        return AgentRisk::Low;
    }
    if matches_normalized_command(&c, &["systemctl", "restart"])
        || matches_normalized_command(&c, &["docker", "restart"])
        || matches_normalized_command(&c, &["kill"])
    {
        return AgentRisk::Medium;
    }
    if matches_normalized_command(&c, &["rm"])
        || matches_normalized_command(&c, &["truncate"])
        || matches_normalized_command(&c, &["reboot"])
        || matches_normalized_command(&c, &["shutdown"])
        || matches_normalized_command(&c, &["systemctl", "stop"])
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

struct NormalizedCommand<'a> {
    name: &'a str,
    args: Vec<&'a str>,
}

fn normalized_command(command: &str) -> Option<NormalizedCommand<'_>> {
    let tokens: Vec<&str> = command.split_whitespace().map(clean_token).collect();
    let mut idx = 0;

    while idx < tokens.len() {
        match command_word_name(tokens[idx]) {
            "sudo" => idx = skip_sudo_prefix(&tokens, idx + 1),
            "command" => idx += 1,
            "env" => {
                idx = skip_env_prefix(&tokens, idx + 1);
            }
            _ => break,
        }
    }

    let token = tokens.get(idx)?;
    Some(NormalizedCommand {
        name: command_word_name(token),
        args: tokens[idx + 1..].to_vec(),
    })
}

fn matches_normalized_command(command: &str, words: &[&str]) -> bool {
    let Some((name, args)) = words.split_first() else {
        return false;
    };
    let Some(command) = normalized_command(command) else {
        return false;
    };
    command.name == *name
        && args
            .iter()
            .enumerate()
            .all(|(idx, expected)| command.args.get(idx).is_some_and(|arg| arg == expected))
}

fn is_env_assignment(token: &str) -> bool {
    token
        .split_once('=')
        .is_some_and(|(key, _)| !key.is_empty() && key.chars().all(is_env_key_char))
}

fn skip_sudo_prefix(tokens: &[&str], mut idx: usize) -> usize {
    while let Some(token) = tokens.get(idx) {
        match *token {
            "--" => return idx + 1,
            "-n" | "--non-interactive" => idx += 1,
            "-u" | "--user" | "-g" | "--group" | "-h" | "--host" | "-p" | "--prompt" => idx += 2,
            _ if token.starts_with("--user=")
                || token.starts_with("--group=")
                || token.starts_with("--host=")
                || token.starts_with("--prompt=") =>
            {
                idx += 1
            }
            _ if short_sudo_option_with_attached_value(token) => idx += 1,
            _ if token.starts_with('-') => idx += 1,
            _ => break,
        }
    }
    idx
}

fn short_sudo_option_with_attached_value(token: &str) -> bool {
    token.len() > 2
        && ["-u", "-g", "-h", "-p"]
            .iter()
            .any(|prefix| token.starts_with(prefix))
}

fn skip_env_prefix(tokens: &[&str], mut idx: usize) -> usize {
    while let Some(token) = tokens.get(idx) {
        match *token {
            "-i" | "--ignore-environment" => idx += 1,
            "-u" | "--unset" | "-C" | "--chdir" => idx += 2,
            _ if token.starts_with("--unset=") || token.starts_with("--chdir=") => idx += 1,
            _ if is_env_assignment(token) => idx += 1,
            _ => break,
        }
    }
    idx
}

fn is_env_key_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_'
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
    let trimmed = clean_token(word);
    trimmed
        .rsplit(|ch| ch == '/' || ch == '\\')
        .next()
        .unwrap_or(trimmed)
}

fn clean_token(token: &str) -> &str {
    token.trim_matches(|ch| ch == '\'' || ch == '"')
}

fn contains_root_destructive_rm_command(command: &str) -> bool {
    command
        .split(is_shell_segment_separator)
        .any(segment_contains_root_destructive_rm)
}

fn segment_contains_root_destructive_rm(segment: &str) -> bool {
    let tokens: Vec<&str> = segment.split_whitespace().map(clean_token).collect();
    for (idx, token) in tokens.iter().enumerate() {
        if command_word_name(token) != "rm" {
            continue;
        }
        let args = &tokens[idx + 1..];
        if has_recursive_force_flags(args) && args.iter().any(|arg| is_root_rm_target(arg)) {
            return true;
        }
    }
    false
}

fn has_recursive_force_flags(args: &[&str]) -> bool {
    let mut recursive = false;
    let mut force = false;
    for arg in args {
        match *arg {
            "--recursive" => recursive = true,
            "--force" => force = true,
            _ if arg.starts_with('-') => {
                recursive |= arg.contains('r') || arg.contains('R');
                force |= arg.contains('f');
            }
            _ => {}
        }
    }
    recursive && force
}

fn is_root_rm_target(arg: &str) -> bool {
    matches!(arg, "/" | "/*")
}

fn classify_wrapped_destructive_command(command: &str) -> Option<AgentRisk> {
    for segment in command.split(is_shell_segment_separator) {
        let tokens: Vec<&str> = segment.split_whitespace().map(clean_token).collect();
        for (idx, token) in tokens.iter().enumerate() {
            match command_word_name(token) {
                "rm" | "shutdown" | "reboot" | "truncate" => return Some(AgentRisk::High),
                "systemctl" if tokens.get(idx + 1).is_some_and(|arg| *arg == "stop") => {
                    return Some(AgentRisk::High);
                }
                _ => {}
            }
        }
    }
    None
}

fn is_mutating_journalctl_command(command: &str) -> bool {
    normalized_command(command).is_some_and(|command| {
        command.name == "journalctl"
            && command.args.iter().any(|part| {
                *part == "--rotate"
                    || *part == "--flush"
                    || part.starts_with("--vacuum-time")
                    || part.starts_with("--vacuum-size")
                    || part.starts_with("--vacuum-files")
            })
    })
}

fn classify_read_file_payload(payload: &serde_json::Value) -> AgentRisk {
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

fn classify_file_read_path(path: &str) -> AgentRisk {
    sensitive_path_risk(path).unwrap_or(AgentRisk::ReadOnly)
}

fn classify_sensitive_read_command(command: &str) -> Option<AgentRisk> {
    let command = normalized_command(command)?;
    if !matches!(command.name, "cat" | "tail" | "grep") {
        return None;
    }

    let is_grep = command.name == "grep";
    let mut risk = None;
    for token in command.args {
        let token = token.trim_matches(|ch| ch == '\'' || ch == '"');
        if let Some(path_risk) = sensitive_path_risk(token) {
            risk = Some(stronger_risk(risk, path_risk));
        } else if is_grep && is_sensitive_search_token(token) {
            risk = Some(stronger_risk(risk, AgentRisk::High));
        }
    }
    risk
}

fn classify_proc_cat_command(command: &str) -> Option<AgentRisk> {
    let command = normalized_command(command)?;
    if command.name != "cat" {
        return None;
    }

    let mut proc_risk = None;
    for token in command.args {
        let token = clean_token(token);
        if !token.starts_with("/proc/") {
            continue;
        }
        let risk = if token.contains("/../") || token.ends_with("/..") || token.contains("/environ")
        {
            AgentRisk::Blocked
        } else {
            AgentRisk::ReadOnly
        };
        proc_risk = Some(stronger_risk(proc_risk, risk));
    }
    proc_risk
}

fn sensitive_path_risk(path: &str) -> Option<AgentRisk> {
    let path = normalize_path(path);
    let file_name = path.rsplit('/').next().unwrap_or(path.as_str());

    if path.starts_with("/proc/")
        && (path.contains("/../") || path.ends_with("/..") || path.contains("/environ"))
    {
        return Some(AgentRisk::Blocked);
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

fn normalize_path(path: &str) -> String {
    path.trim_matches(|ch| ch == '\'' || ch == '"')
        .replace('\\', "/")
        .to_ascii_lowercase()
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
    fn cat_secret_targets_are_not_read_only() {
        assert_eq!(classify_command("cat ~/.ssh/id_rsa"), AgentRisk::Blocked);
        assert_eq!(
            classify_command("cat /home/app/.aws/credentials"),
            AgentRisk::High
        );
        assert_eq!(classify_command("cat /proc/cpuinfo"), AgentRisk::ReadOnly);
    }

    #[test]
    fn proc_environ_and_traversal_reads_are_blocked() {
        assert_eq!(classify_command("cat /proc/cpuinfo"), AgentRisk::ReadOnly);
        assert_eq!(
            classify_command("cat /proc/self/environ"),
            AgentRisk::Blocked
        );
        assert_eq!(classify_command("cat /proc/1/environ"), AgentRisk::Blocked);
        assert_eq!(
            classify_command("cat /proc/../../etc/shadow"),
            AgentRisk::Blocked
        );
    }

    #[test]
    fn tail_and_grep_proc_sensitive_paths_are_not_read_only() {
        assert_eq!(
            classify_command("tail /proc/self/environ"),
            AgentRisk::Blocked
        );
        assert_eq!(
            classify_command("grep PATH /proc/self/environ"),
            AgentRisk::Blocked
        );
        assert_eq!(
            classify_command("tail /proc/../../etc/shadow"),
            AgentRisk::Blocked
        );
        assert_eq!(
            classify_command("grep cpu /proc/cpuinfo"),
            AgentRisk::ReadOnly
        );
    }

    #[test]
    fn wrapped_read_commands_use_sensitive_path_policy() {
        assert_eq!(
            classify_command("sudo cat /proc/self/environ"),
            AgentRisk::Blocked
        );
        assert_eq!(
            classify_command("/bin/tail /proc/self/environ"),
            AgentRisk::Blocked
        );
        assert_eq!(
            classify_command("sudo grep AWS_SECRET_ACCESS_KEY ~/.config"),
            AgentRisk::High
        );
        assert_eq!(
            classify_command("/usr/bin/cat ~/.ssh/id_rsa"),
            AgentRisk::Blocked
        );
        assert_eq!(classify_command("cat /proc/cpuinfo"), AgentRisk::ReadOnly);
        assert_eq!(
            classify_command("grep cpu /proc/cpuinfo"),
            AgentRisk::ReadOnly
        );
    }

    #[test]
    fn wrapper_options_do_not_bypass_sensitive_read_policy() {
        assert_eq!(
            classify_command("sudo -n cat ~/.ssh/id_rsa"),
            AgentRisk::Blocked
        );
        assert_eq!(
            classify_command("sudo -u app cat /proc/self/environ"),
            AgentRisk::Blocked
        );
        assert_eq!(
            classify_command("sudo -- cat ~/.ssh/id_rsa"),
            AgentRisk::Blocked
        );
        assert_eq!(
            classify_command("env -i cat ~/.ssh/id_rsa"),
            AgentRisk::Blocked
        );
        assert_eq!(
            classify_command("sudo systemctl reload nginx"),
            AgentRisk::Low
        );
        assert_eq!(
            classify_command("sudo systemctl stop sshd"),
            AgentRisk::High
        );
    }

    #[test]
    fn read_file_payloads_fail_closed_and_use_strongest_path_risk() {
        assert_eq!(
            classify_tool_call(&read_file_call_payload(serde_json::json!({}))),
            AgentRisk::High
        );
        assert_eq!(
            classify_tool_call(&read_file_call_payload(serde_json::json!({
                "path": "/var/log/a",
                "target_path": "/var/log/b"
            }))),
            AgentRisk::High
        );
        assert_eq!(
            classify_tool_call(&read_file_call_payload(serde_json::json!({
                "path": "/var/log/app.log",
                "target_path": "~/.ssh/id_rsa"
            }))),
            AgentRisk::Blocked
        );
        assert_eq!(
            classify_tool_call(&read_file_call_payload(serde_json::json!({
                "path": ["~/.ssh/id_rsa"]
            }))),
            AgentRisk::High
        );
        assert_eq!(
            classify_tool_call(&read_file_call_payload(serde_json::json!({
                "path": "/var/log/app.log"
            }))),
            AgentRisk::ReadOnly
        );
    }

    #[test]
    fn windows_secret_paths_are_not_read_only() {
        assert_eq!(
            classify_command("cat C:\\Users\\me\\.ssh\\id_rsa"),
            AgentRisk::Blocked
        );
        assert_eq!(
            classify_command("cat C:\\Users\\me\\.aws\\credentials"),
            AgentRisk::High
        );
        assert_eq!(
            classify_tool_call(&read_file_call_payload(serde_json::json!({
                "path": "C:\\Users\\me\\.kube\\config"
            }))),
            AgentRisk::High
        );
    }

    #[test]
    fn windows_path_qualified_read_commands_use_basename() {
        assert_eq!(
            classify_command("C:\\Windows\\System32\\cat C:\\Users\\me\\.ssh\\id_rsa"),
            AgentRisk::Blocked
        );
        assert_eq!(
            classify_command("C:\\Windows\\System32\\tail /proc/self/environ"),
            AgentRisk::Blocked
        );
        assert_eq!(
            classify_command("C:\\Windows\\System32\\grep cpu /proc/cpuinfo"),
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
    fn root_destructive_rm_variants_are_blocked() {
        for command in [
            "rm -fr /",
            "rm -r -f /",
            "rm --recursive --force /",
            "sh -c 'rm -fr /'",
            "rm -rf /*",
            "/bin/rm -rf /",
            "sudo rm -rf /",
        ] {
            assert_eq!(classify_command(command), AgentRisk::Blocked, "{command}");
        }
    }

    #[test]
    fn command_wrappers_preserve_destructive_risk() {
        assert_eq!(classify_command("sudo rm /tmp/file"), AgentRisk::High);
        assert_eq!(classify_command("/bin/rm /tmp/file"), AgentRisk::High);
        assert_eq!(classify_command("sudo shutdown now"), AgentRisk::High);
        assert_eq!(
            classify_command("sudo systemctl stop sshd"),
            AgentRisk::High
        );
    }

    #[test]
    fn wrapped_reload_commands_remain_low_risk() {
        assert_eq!(
            classify_command("sudo systemctl reload nginx"),
            AgentRisk::Low
        );
        assert_eq!(
            classify_command("/bin/systemctl reload nginx"),
            AgentRisk::Low
        );
        assert_eq!(
            classify_command("sudo systemctl stop sshd"),
            AgentRisk::High
        );
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
        read_file_call_payload(serde_json::json!({ "path": path }))
    }

    fn read_file_call_payload(payload: serde_json::Value) -> AgentToolCall {
        AgentToolCall {
            id: "c1".into(),
            tool: AgentToolName::ReadFile,
            target_session_id: "s1".into(),
            payload,
            risk: AgentRisk::ReadOnly,
            reason: "read file".into(),
            expected_result: None,
            verify: None,
        }
    }
}
