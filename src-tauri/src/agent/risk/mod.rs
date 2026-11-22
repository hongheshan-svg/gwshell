mod paths;
mod rules;
mod shell;

use super::types::{AgentRisk, AgentToolCall, AgentToolName};
use paths::{
    classify_read_file_payload, classify_sensitive_paths_in_command_text,
    classify_stream_log_payload,
};
use rules::{
    classify_blocked_sensitive_read_segment, classify_interpreter_command,
    classify_proc_cat_command, classify_sensitive_read_command,
    classify_wrapped_destructive_command, contains_blocked_destructive_command,
    contains_blocked_passwd_command, contains_destructive_dd_command,
    contains_root_destructive_rm_command, is_mutating_journalctl_command, is_mutating_ss_command,
    stronger_risk,
};
use shell::{
    has_shell_control_syntax, has_unquoted_shell_expansion, matches_normalized_command,
    uses_env_assignment,
};

pub use shell::{command_matches_prefix, systemctl_unit};

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
        AgentToolName::StreamLog => classify_stream_log_payload(&call.payload),
        AgentToolName::DockerLogs => AgentRisk::ReadOnly,
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
    if contains_blocked_passwd_command(&c) {
        return AgentRisk::Blocked;
    }
    if contains_blocked_destructive_command(&c) {
        return AgentRisk::Blocked;
    }
    if c.contains("rm -rf /")
        || c.contains("mkfs")
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
    if let Some(risk) = classify_interpreter_command(&c) {
        return risk;
    }
    if let Some(AgentRisk::Blocked) = classify_blocked_sensitive_read_segment(&c) {
        return AgentRisk::Blocked;
    }
    // Check sensitive paths across ALL commands (not just cat/tail/grep) so
    // utilities like `head`, `base64`, `awk`, `sed`, `strings`, or `xxd`
    // cannot bypass secret-file protection.
    let any_sensitive_path_risk = classify_sensitive_paths_in_command_text(&c);
    if any_sensitive_path_risk == Some(AgentRisk::Blocked) {
        return AgentRisk::Blocked;
    }
    if has_shell_control_syntax(&c) {
        return AgentRisk::High;
    }
    if has_unquoted_shell_expansion(&c) {
        return any_sensitive_path_risk
            .map(|r| stronger_risk(Some(AgentRisk::Medium), r))
            .unwrap_or(AgentRisk::Medium);
    }
    if uses_env_assignment(&c) {
        return any_sensitive_path_risk
            .map(|r| stronger_risk(Some(AgentRisk::Medium), r))
            .unwrap_or(AgentRisk::Medium);
    }
    if is_mutating_journalctl_command(&c) {
        return AgentRisk::Medium;
    }
    if is_mutating_ss_command(command.trim()) {
        return AgentRisk::Medium;
    }
    if let Some(risk) = classify_sensitive_read_command(&c) {
        return risk;
    }
    if let Some(risk) = any_sensitive_path_risk {
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
            classify_tool_call(&read_file_call("/etc/shadow")),
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
    fn stream_log_path_uses_file_read_path_risk() {
        assert_eq!(
            classify_tool_call(&stream_log_path_call("/var/log/nginx/error.log")),
            AgentRisk::ReadOnly
        );
        assert_eq!(
            classify_tool_call(&stream_log_path_call("/etc/shadow")),
            AgentRisk::Blocked
        );
        assert_eq!(
            classify_tool_call(&stream_log_path_call("~/.kube/config")),
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
        assert_eq!(classify_command("cat /etc/shadow"), AgentRisk::Blocked);
        assert_eq!(classify_command("cat /proc/cpuinfo"), AgentRisk::ReadOnly);
    }

    #[test]
    fn path_alias_sensitive_reads_are_not_read_only() {
        assert_eq!(classify_command("tail /etc/./shadow"), AgentRisk::Blocked);
        assert_eq!(classify_command("tail /etc//shadow"), AgentRisk::Blocked);
        assert_eq!(
            classify_command("tail /etc/../etc/shadow"),
            AgentRisk::Blocked
        );
        assert_eq!(
            classify_tool_call(&read_file_call("/etc/./shadow")),
            AgentRisk::Blocked
        );
        assert_eq!(
            classify_command("cat /home/me/.ssh/./id_rsa"),
            AgentRisk::Blocked
        );
        assert_eq!(
            classify_command("tail /home/me/.bash_history/../.bash_history"),
            AgentRisk::Blocked
        );
    }

    #[test]
    fn composed_system_credential_reads_remain_blocked() {
        assert_eq!(
            classify_command("cat /etc/shadow; echo ok"),
            AgentRisk::Blocked
        );
        assert_eq!(
            classify_command("echo ok && cat /etc/gshadow"),
            AgentRisk::Blocked
        );
    }

    #[test]
    fn quote_spliced_sensitive_paths_are_not_read_only() {
        assert_eq!(
            classify_command("cat ~/'.aws'/credentials"),
            AgentRisk::High
        );
        assert_eq!(classify_command("cat ~/'.kube'/config"), AgentRisk::High);
        assert_eq!(classify_command("cat ~/'.ssh'/config"), AgentRisk::Blocked);
        assert_eq!(
            classify_command("cat ~/'.docker'/config.json"),
            AgentRisk::High
        );
        assert_eq!(
            classify_command("cat ~/'.config'/app/token"),
            AgentRisk::High
        );
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
    fn proc_root_and_cwd_sensitive_aliases_are_not_read_only() {
        assert_eq!(
            classify_command("cat /proc/self/root/etc/shadow"),
            AgentRisk::Blocked
        );
        assert_eq!(
            classify_command("tail /proc/self/root/../etc/shadow"),
            AgentRisk::Blocked
        );
        assert_eq!(
            classify_command("grep x /proc/self/root/../etc/sudoers"),
            AgentRisk::Blocked
        );
        assert_eq!(
            classify_command("tail /proc/1/root/etc/shadow"),
            AgentRisk::Blocked
        );
        assert_eq!(
            classify_command("grep x /proc/self/cwd/.ssh/id_rsa"),
            AgentRisk::Blocked
        );
        assert_eq!(
            classify_command("grep x /proc/self/cwd/.aws/credentials"),
            AgentRisk::High
        );
    }

    #[test]
    fn shell_escaped_sensitive_paths_are_not_read_only() {
        assert_eq!(classify_command(r"tail /et\c/shadow"), AgentRisk::Blocked);
        assert_eq!(
            classify_command(r"grep x ~/.s\sh/id_rsa"),
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
    fn shell_interpreter_wrappers_preserve_sensitive_read_risk() {
        assert_eq!(
            classify_command("sh -c 'cat /proc/self/environ'"),
            AgentRisk::Blocked
        );
        assert_eq!(
            classify_command("bash -lc 'cat ~/.ssh/id_rsa'"),
            AgentRisk::Blocked
        );
        assert_eq!(
            classify_command("zsh -c 'tail /proc/self/environ'"),
            AgentRisk::Blocked
        );
        assert_eq!(
            classify_command("cmd /c type C:\\Users\\me\\.ssh\\id_rsa"),
            AgentRisk::Blocked
        );
        assert_eq!(
            classify_command("pwsh -Command 'Get-Content C:\\Users\\me\\.aws\\credentials'"),
            AgentRisk::High
        );
    }

    #[test]
    fn opaque_powershell_encoded_commands_are_high_risk() {
        for command in [
            "powershell -EncodedCommand abc",
            "pwsh -EncodedCommand abc",
            "powershell -enc abc",
            "pwsh -e abc",
            "pwsh -ec abc",
            "powershell -ec abc",
            "powershell /encodedcommand abc",
            "pwsh /enc abc",
            "powershell /e abc",
            "pwsh /ec abc",
        ] {
            assert_eq!(classify_command(command), AgentRisk::High, "{command}");
        }
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
                "path": "../../etc/shadow"
            }))),
            AgentRisk::Blocked
        );
        assert_eq!(
            classify_tool_call(&read_file_call_payload(serde_json::json!({
                "path": "../var/log/app.log"
            }))),
            AgentRisk::High
        );
        assert_eq!(
            classify_tool_call(&read_file_call_payload(serde_json::json!({
                "path": "foo/../../../../etc/shadow"
            }))),
            AgentRisk::Blocked
        );
        assert_eq!(
            classify_tool_call(&read_file_call_payload(serde_json::json!({
                "path": "foo/../../var/log/app.log"
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
        assert_eq!(classify_command("passwd"), AgentRisk::Blocked);
        assert_eq!(classify_command("/usr/bin/passwd"), AgentRisk::Blocked);
        assert_eq!(classify_command("sudo passwd root"), AgentRisk::Blocked);
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
    fn blocked_destructive_commands_allow_shell_whitespace_and_bare_forms() {
        for command in [
            "userdel\tbob",
            "iptables\t-F",
            "ufw\tenable",
            "chmod -r\t777 /",
            "userdel",
            "iptables",
            "ufw",
        ] {
            assert_eq!(classify_command(command), AgentRisk::Blocked, "{command:?}");
        }
    }

    #[test]
    fn composed_passwd_commands_are_blocked() {
        assert_eq!(classify_command("true; passwd"), AgentRisk::Blocked);
        assert_eq!(classify_command("true; pas''wd"), AgentRisk::Blocked);
        assert_eq!(
            classify_command("echo ok && /usr/bin/passwd"),
            AgentRisk::Blocked
        );
        assert_eq!(classify_command("echo ok && p'a'sswd"), AgentRisk::Blocked);
        assert_eq!(
            classify_command("sudo sh -c 'passwd root'"),
            AgentRisk::Blocked
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
            "rm -r -f //",
            "rm --recursive --force /var/..",
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
    fn backslash_spliced_command_words_are_blocked() {
        assert_eq!(classify_command(r"r\m -rf /"), AgentRisk::Blocked);
        assert_eq!(classify_command(r"pa\sswd"), AgentRisk::Blocked);
        assert_eq!(classify_command(r"sh -c 'r\m -rf /'"), AgentRisk::Blocked);
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
        for (command, expected) in [
            ("df -h; shutdown now", AgentRisk::High),
            ("docker ps && docker restart web", AgentRisk::High),
            ("journalctl -u nginx || shutdown now", AgentRisk::High),
            ("df -h | sh", AgentRisk::High),
            ("df -h\nshutdown now", AgentRisk::High),
            ("df -h $(shutdown now)", AgentRisk::High),
            ("df -h `shutdown now`", AgentRisk::High),
            ("grep x file > /etc/app.conf", AgentRisk::High),
            ("cat /proc/cpuinfo < /tmp/input", AgentRisk::High),
            ("df -h & shutdown now", AgentRisk::High),
            ("cat /proc/cpuinfo&true", AgentRisk::High),
            ("cat /proc/cpuinfo&rm -rf /tmp/x", AgentRisk::Blocked),
        ] {
            assert_eq!(classify_command(command), expected, "{command}");
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

    fn stream_log_path_call(path: &str) -> AgentToolCall {
        AgentToolCall {
            id: "c1".into(),
            tool: AgentToolName::StreamLog,
            target_session_id: "s1".into(),
            payload: serde_json::json!({ "path": path }),
            risk: AgentRisk::ReadOnly,
            reason: "stream log".into(),
            expected_result: None,
            verify: None,
        }
    }

    #[test]
    fn shell_expansion_cannot_smuggle_sensitive_paths_into_read_only() {
        for command in [
            "tail -n 50 /etc/shado[w]",
            "tail -n 50 /etc/shad*",
            "grep -h . /root/.ss?/id_*",
            "tail /etc/{shadow,}",
            "tail /etc/s${x}hadow",
            "tail 'unterminated",
        ] {
            assert!(
                !matches!(
                    classify_command(command),
                    AgentRisk::ReadOnly | AgentRisk::Low
                ),
                "{command} must not be auto-executable"
            );
        }
        assert_eq!(
            classify_command("grep 'err.*[0-9]' /var/log/syslog"),
            AgentRisk::ReadOnly
        );
        assert_eq!(
            classify_command("journalctl -u nginx --since \"1 hour ago\""),
            AgentRisk::ReadOnly
        );
    }

    #[test]
    fn mutating_variants_of_read_only_tools_are_not_read_only() {
        for command in [
            "ss -K dst 10.0.0.5",
            "ss -tK",
            "ss --kill",
            "ss -D /tmp/dump",
            "ss --diag=/tmp/dump",
            "env LD_PRELOAD=/tmp/x.so df",
            "sudo env PATH=/tmp df -h",
            "journalctl --setup-keys",
            "journalctl --update-catalog",
            "journalctl --vacuum-size=1M",
            "journalctl --relinquish-var",
        ] {
            assert!(
                !matches!(
                    classify_command(command),
                    AgentRisk::ReadOnly | AgentRisk::Low
                ),
                "{command} must not be auto-executable"
            );
        }
        assert_eq!(classify_command("ss -tulpn"), AgentRisk::ReadOnly);
        assert_eq!(classify_command("env -i df -h"), AgentRisk::ReadOnly);
    }

    #[test]
    fn private_keys_and_credential_files_are_blocked() {
        for path in [
            "/etc/ssl/private/server.key",
            "/etc/pki/tls/private/x",
            "/root/.git-credentials",
            "/home/a/.netrc",
            "/var/lib/postgresql/.pgpass",
            "/opt/app/cert.p12",
        ] {
            assert_eq!(
                classify_command(&format!("tail -n 20 {path}")),
                AgentRisk::Blocked,
                "{path}"
            );
            assert_eq!(
                classify_tool_call(&read_file_call(path)),
                AgentRisk::Blocked
            );
        }
        assert_eq!(classify_command("grep -r . /srv/app/.env"), AgentRisk::High);
    }

    #[test]
    fn command_prefix_matching_is_word_based() {
        assert!(command_matches_prefix(
            "systemctl status nginx",
            "systemctl status"
        ));
        assert!(command_matches_prefix(
            "sudo systemctl status nginx",
            "systemctl status"
        ));
        assert!(command_matches_prefix("df -h", "df"));
        assert!(!command_matches_prefix(
            "echo systemctl status",
            "systemctl status"
        ));
        assert!(!command_matches_prefix("dfx", "df"));
        assert!(!command_matches_prefix(
            "systemctl stop x",
            "systemctl status"
        ));
        assert!(!command_matches_prefix("df", ""));
    }

    #[test]
    fn systemctl_unit_extraction() {
        assert_eq!(
            systemctl_unit("systemctl reload --no-block nginx", &["reload", "restart"]),
            Some("nginx".into())
        );
        assert_eq!(
            systemctl_unit(
                "sudo systemctl restart sshd.service",
                &["reload", "restart"]
            ),
            Some("sshd.service".into())
        );
        assert_eq!(systemctl_unit("systemctl status nginx", &["reload"]), None);
        assert_eq!(systemctl_unit("df -h", &["reload"]), None);
    }

    #[test]
    fn non_cat_sensitive_file_reads_and_script_interpreters_are_blocked_or_high() {
        assert_eq!(
            classify_command("head -n 50 /etc/shadow"),
            AgentRisk::Blocked
        );
        assert_eq!(classify_command("base64 ~/.ssh/id_rsa"), AgentRisk::Blocked);
        assert_eq!(
            classify_command("strings ~/.ssh/id_rsa"),
            AgentRisk::Blocked
        );
        assert_eq!(classify_command("awk 1 /etc/shadow"), AgentRisk::Blocked);
        assert_eq!(
            classify_command("python3 -c \"print(open('/etc/shadow').read())\""),
            AgentRisk::Blocked
        );
        assert_eq!(
            classify_command("python3 -c \"print('hello')\""),
            AgentRisk::High
        );
        assert_eq!(
            classify_command("node -e \"console.log(1)\""),
            AgentRisk::High
        );
    }
}
