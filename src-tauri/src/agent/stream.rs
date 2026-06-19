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

pub fn file_tail_command(path: &str, lines: u32) -> String {
    let lines = lines.clamp(20, 500);
    format!("tail -n {} -F {}", lines, shell_escape(path))
}

fn shell_escape(input: &str) -> String {
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

        assert_eq!(command, "tail -n 20 -F '/var/log/app'\\''s.log'");
    }

    #[test]
    fn builds_docker_logs_tail_command() {
        assert_eq!(
            docker_logs_tail_command("web'app", 600),
            "docker logs --tail=500 -f 'web'\\''app'"
        );
    }
}
