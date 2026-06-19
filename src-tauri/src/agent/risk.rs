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
    if c.starts_with("df ")
        || c == "df"
        || c.starts_with("free ")
        || c == "free"
        || c.starts_with("journalctl ")
        || c.starts_with("systemctl status ")
        || c.starts_with("ss ")
        || c.starts_with("ps ")
        || c.starts_with("docker logs ")
        || c.starts_with("docker ps")
        || c.starts_with("cat /proc/")
        || c.starts_with("tail ")
        || c.starts_with("grep ")
    {
        return AgentRisk::ReadOnly;
    }
    if c.starts_with("systemctl reload ") {
        return AgentRisk::Low;
    }
    if c.starts_with("systemctl restart ")
        || c.starts_with("docker restart ")
        || c.starts_with("kill ")
    {
        return AgentRisk::Medium;
    }
    if c.starts_with("rm ")
        || c.starts_with("truncate ")
        || c.starts_with("reboot")
        || c.starts_with("shutdown")
        || c.starts_with("systemctl stop ")
    {
        return AgentRisk::High;
    }
    AgentRisk::Medium
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
}
