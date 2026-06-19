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
        AgentToolName::StreamLog | AgentToolName::ReadFile | AgentToolName::DockerLogs => {
            AgentRisk::ReadOnly
        }
        AgentToolName::RestartService => AgentRisk::Medium,
    }
}

pub fn classify_command(command: &str) -> AgentRisk {
    let c = command.trim().to_ascii_lowercase();
    if c.is_empty() {
        return AgentRisk::Blocked;
    }
    if c.contains("rm -rf /")
        || c.contains("mkfs")
        || c.contains("dd if=")
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
    fn dangerous_commands_are_blocked_or_high() {
        assert_eq!(classify_command("rm -rf /"), AgentRisk::Blocked);
        assert_eq!(classify_command("iptables -F"), AgentRisk::Blocked);
        assert_eq!(classify_command("rm /tmp/file"), AgentRisk::High);
        assert_eq!(
            classify_command("systemctl restart nginx"),
            AgentRisk::Medium
        );
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
        ] {
            assert_ne!(classify_command(command), AgentRisk::ReadOnly, "{command}");
        }
    }

    #[test]
    fn read_only_matching_respects_command_boundaries() {
        assert_eq!(classify_command("docker psx"), AgentRisk::Medium);
    }
}
