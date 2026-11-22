use super::classify_command;
use super::paths::{
    classify_sensitive_paths_in_command_text, is_sensitive_search_token, normalize_path_variants,
    sensitive_path_risk,
};
use super::shell::{
    clean_token, command_word_name, normalized_command, segment_tokens, shell_segments,
};
use crate::agent::types::AgentRisk;

pub(super) fn stronger_risk(current: Option<AgentRisk>, next: AgentRisk) -> AgentRisk {
    match (current, next) {
        (Some(AgentRisk::Blocked), _) | (_, AgentRisk::Blocked) => AgentRisk::Blocked,
        (Some(AgentRisk::High), _) | (_, AgentRisk::High) => AgentRisk::High,
        (Some(AgentRisk::Medium), _) | (_, AgentRisk::Medium) => AgentRisk::Medium,
        (Some(AgentRisk::Low), _) | (_, AgentRisk::Low) => AgentRisk::Low,
        _ => AgentRisk::ReadOnly,
    }
}

pub(super) fn at_least_high(risk: AgentRisk) -> AgentRisk {
    match risk {
        AgentRisk::Blocked => AgentRisk::Blocked,
        _ => AgentRisk::High,
    }
}

/// `ss -K`/`--kill` closes sockets and `-D`/`--diag=FILE` writes a file.
pub(super) fn is_mutating_ss_command(command: &str) -> bool {
    normalized_command(command).is_some_and(|command| {
        command.name == "ss"
            && command.args.iter().any(|arg| {
                arg.starts_with("--kill")
                    || arg.starts_with("--diag")
                    || (arg.starts_with('-')
                        && !arg.starts_with("--")
                        && arg.chars().skip(1).any(|ch| ch == 'K' || ch == 'D'))
            })
    })
}

pub(super) fn is_mutating_journalctl_command(command: &str) -> bool {
    normalized_command(command).is_some_and(|command| {
        command.name == "journalctl"
            && command.args.iter().any(|part| {
                *part == "--rotate"
                    || *part == "--flush"
                    || *part == "--sync"
                    || *part == "--relinquish-var"
                    || *part == "--smart-relinquish-var"
                    || *part == "--update-catalog"
                    || part.starts_with("--setup-keys")
                    || part.starts_with("--vacuum-")
            })
    })
}

pub(super) fn contains_destructive_dd_command(command: &str) -> bool {
    shell_segments(command).any(segment_contains_destructive_dd)
}

pub(super) fn contains_root_destructive_rm_command(command: &str) -> bool {
    shell_segments(command).any(segment_contains_root_destructive_rm)
}

pub(super) fn contains_blocked_passwd_command(command: &str) -> bool {
    shell_segments(command).any(segment_contains_blocked_passwd)
}

pub(super) fn contains_blocked_destructive_command(command: &str) -> bool {
    shell_segments(command).any(segment_contains_blocked_destructive)
}

pub(super) fn classify_wrapped_destructive_command(command: &str) -> Option<AgentRisk> {
    for segment in shell_segments(command) {
        let tokens = segment_tokens(segment);
        for (idx, token) in tokens.iter().enumerate() {
            match command_word_name(token).as_str() {
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

pub(super) fn classify_interpreter_command(command: &str) -> Option<AgentRisk> {
    let command = normalized_command(command)?;
    if is_powershell_command(&command.name) && has_powershell_encoded_command(&command.args) {
        return Some(AgentRisk::High);
    }

    if is_script_interpreter(&command.name) {
        let args_text = command.args.join(" ");
        let path_risk = classify_sensitive_paths_in_command_text(&args_text);
        return Some(at_least_high(path_risk.unwrap_or(AgentRisk::High)));
    }

    let inner = match command.name.as_str() {
        "sh" | "bash" | "zsh" | "dash" | "ash" | "ksh" => shell_c_command(&command.args),
        "cmd" | "cmd.exe" => command_after_flag(&command.args, &["/c"]),
        "pwsh" | "pwsh.exe" | "powershell" | "powershell.exe" => {
            command_after_flag(&command.args, &["-command", "-c"])
        }
        _ => None,
    }?;

    let inner = inner.trim();
    if inner.is_empty() {
        return Some(AgentRisk::High);
    }

    let inner_risk = classify_command(inner);
    let path_risk = classify_sensitive_paths_in_command_text(inner);
    let strongest = path_risk
        .map(|risk| stronger_risk(Some(inner_risk), risk))
        .unwrap_or(inner_risk);
    Some(at_least_high(strongest))
}

pub(super) fn classify_sensitive_read_command(command: &str) -> Option<AgentRisk> {
    let command = normalized_command(command)?;
    if !matches!(
        command.name.as_str(),
        "cat" | "tail" | "grep" | "type" | "get-content"
    ) {
        return None;
    }

    let is_grep = command.name == "grep";
    let mut risk = None;
    for token in command.args {
        let token = clean_token(token);
        if let Some(path_risk) = sensitive_path_risk(token) {
            risk = Some(stronger_risk(risk, path_risk));
        } else if is_grep && is_sensitive_search_token(token) {
            risk = Some(stronger_risk(risk, AgentRisk::High));
        }
    }
    risk
}

pub(super) fn classify_blocked_sensitive_read_segment(command: &str) -> Option<AgentRisk> {
    shell_segments(command)
        .filter_map(classify_sensitive_read_command)
        .find(|risk| *risk == AgentRisk::Blocked)
}

pub(super) fn classify_proc_cat_command(command: &str) -> Option<AgentRisk> {
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

fn segment_contains_destructive_dd(segment: &str) -> bool {
    let mut saw_dd = false;
    for part in segment_tokens(segment) {
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

fn segment_contains_blocked_passwd(segment: &str) -> bool {
    normalized_command(segment).is_some_and(|command| command.name == "passwd")
}

fn segment_contains_blocked_destructive(segment: &str) -> bool {
    normalized_command(segment).is_some_and(|command| match command.name.as_str() {
        "userdel" | "iptables" | "ufw" | "firewall-cmd" => true,
        "chmod" => is_root_recursive_world_writable_chmod(&command.args),
        _ => false,
    })
}

fn is_root_recursive_world_writable_chmod(args: &[&str]) -> bool {
    let recursive = args.iter().any(|arg| is_chmod_recursive_flag(arg));
    let mode_777 = args.contains(&"777");
    let root = args.contains(&"/");
    recursive && mode_777 && root
}

fn is_chmod_recursive_flag(arg: &str) -> bool {
    arg == "--recursive"
        || (arg.starts_with('-')
            && !arg.starts_with("--")
            && arg.chars().skip(1).any(|ch| ch == 'r' || ch == 'R'))
}

fn segment_contains_root_destructive_rm(segment: &str) -> bool {
    let tokens = segment_tokens(segment);
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
    normalize_path_variants(arg)
        .iter()
        .any(|path| matches!(path.as_str(), "/" | "/*"))
}

fn is_script_interpreter(name: &str) -> bool {
    matches!(
        name,
        "python" | "python2" | "python3" | "perl" | "ruby" | "node" | "nodejs" | "php"
    ) || name.starts_with("python3.")
}

fn is_powershell_command(name: &str) -> bool {
    matches!(name, "pwsh" | "pwsh.exe" | "powershell" | "powershell.exe")
}

fn has_powershell_encoded_command(args: &[&str]) -> bool {
    args.iter().any(|arg| {
        matches!(
            clean_token(arg),
            "-encodedcommand" | "-enc" | "-ec" | "-e" | "/encodedcommand" | "/enc" | "/ec" | "/e"
        )
    })
}

fn shell_c_command(args: &[&str]) -> Option<String> {
    for (idx, arg) in args.iter().enumerate() {
        let arg = clean_token(arg);
        if arg.starts_with('-') && arg.contains('c') {
            return Some(join_command_args(args, idx + 1));
        }
    }
    None
}

fn command_after_flag(args: &[&str], flags: &[&str]) -> Option<String> {
    args.iter()
        .position(|arg| flags.iter().any(|flag| clean_token(arg) == *flag))
        .map(|idx| join_command_args(args, idx + 1))
}

fn join_command_args(args: &[&str], start: usize) -> String {
    let joined = args.get(start..).unwrap_or_default().join(" ");
    clean_token(&joined).to_string()
}
