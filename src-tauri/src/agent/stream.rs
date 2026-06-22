pub fn journal_tail_command(unit: Option<&str>, lines: u32) -> String {
    let lines = lines.clamp(20, 500);
    match unit.filter(|u| !u.trim().is_empty()) {
        Some(unit) => format!(
            "journalctl -u {} -n {} -f --no-pager",
            shell_escape(unit),
            lines
        ),
        None => format!("journalctl -n {} -f --no-pager", lines),
    }
}

pub fn docker_logs_tail_command(container: &str, lines: u32) -> String {
    let lines = lines.clamp(20, 500);
    format!(
        "docker logs --tail={} -f {}",
        lines,
        shell_escape(container)
    )
}

pub fn read_file_head_command(path: &str, lines: u32) -> String {
    let lines = lines.clamp(20, 1000);
    format!("head -n {} -- {}", lines, shell_escape(path))
}

pub fn file_tail_command(path: &str, lines: u32) -> String {
    let lines = lines.clamp(20, 500);
    format!("tail -n {} -F -- {}", lines, shell_escape(path))
}

pub fn restart_service_command(service: &str) -> String {
    format!("systemctl restart {}", shell_escape(service))
}

pub fn service_status_command(service: &str) -> String {
    format!("systemctl status --no-pager {}", shell_escape(service))
}

pub fn shell_escape(input: &str) -> String {
    format!("'{}'", input.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_journal_tail_command_with_unit() {
        assert_eq!(
            journal_tail_command(Some("nginx.service"), 50),
            "journalctl -u 'nginx.service' -n 50 -f --no-pager"
        );
    }

    #[test]
    fn escapes_file_tail_path() {
        let command = file_tail_command("/var/log/app's.log", 10);

        assert_eq!(command, "tail -n 20 -F -- '/var/log/app'\\''s.log'");
    }

    #[test]
    fn terminates_tail_options_before_option_style_path() {
        assert_eq!(
            file_tail_command("-n10000", 20),
            "tail -n 20 -F -- '-n10000'"
        );
    }

    #[test]
    fn builds_docker_logs_tail_command() {
        assert_eq!(
            docker_logs_tail_command("web'app", 600),
            "docker logs --tail=500 -f 'web'\\''app'"
        );
    }

    #[test]
    fn builds_read_file_head_command() {
        assert_eq!(
            read_file_head_command("/var/log/app.log", 0),
            "head -n 20 -- '/var/log/app.log'"
        );
        assert_eq!(
            read_file_head_command("/var/log/app.log", 2_000),
            "head -n 1000 -- '/var/log/app.log'"
        );
    }

    #[test]
    fn builds_restart_and_status_commands() {
        assert_eq!(
            restart_service_command("nginx.service"),
            "systemctl restart 'nginx.service'"
        );
        assert_eq!(
            service_status_command("nginx.service"),
            "systemctl status --no-pager 'nginx.service'"
        );
    }

    #[test]
    fn escapes_journal_unit_metacharacters_as_one_argument() {
        assert_eq!(
            journal_tail_command(Some("nginx;$(touch /tmp/pwn)`whoami`\nnext"), 20),
            "journalctl -u 'nginx;$(touch /tmp/pwn)`whoami`\nnext' -n 20 -f --no-pager"
        );
    }

    #[test]
    fn escapes_docker_container_metacharacters_as_one_argument() {
        assert_eq!(
            docker_logs_tail_command("web'app;$(id)`whoami`", 20),
            "docker logs --tail=20 -f 'web'\\''app;$(id)`whoami`'"
        );
    }

    #[test]
    fn escapes_file_path_metacharacters_as_one_argument() {
        assert_eq!(
            file_tail_command("/var/log/$(id)\napp.log", 20),
            "tail -n 20 -F -- '/var/log/$(id)\napp.log'"
        );
    }

    #[test]
    fn clamps_journal_lines_to_supported_range() {
        assert_eq!(
            journal_tail_command(None, 0),
            "journalctl -n 20 -f --no-pager"
        );
        assert_eq!(
            journal_tail_command(None, 999),
            "journalctl -n 500 -f --no-pager"
        );
    }

    #[test]
    fn clamps_docker_lines_to_supported_range() {
        assert_eq!(
            docker_logs_tail_command("web", 0),
            "docker logs --tail=20 -f 'web'"
        );
        assert_eq!(
            docker_logs_tail_command("web", 999),
            "docker logs --tail=500 -f 'web'"
        );
    }

    #[test]
    fn clamps_file_lines_to_supported_range() {
        assert_eq!(
            file_tail_command("/var/log/app.log", 0),
            "tail -n 20 -F -- '/var/log/app.log'"
        );
        assert_eq!(
            file_tail_command("/var/log/app.log", 999),
            "tail -n 500 -F -- '/var/log/app.log'"
        );
    }
}
