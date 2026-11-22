//! Remote-OS & installed-command detection for command-completion.
//!
//! `probe_remote_env` / `detect_command_table` (in `mod.rs`) run short exec
//! probes on the live SSH connection; `classify_command_table` and
//! `parse_posix_env_probe` are pure decision functions so they can be
//! unit-tested without a network.

use serde::Serialize;
use std::collections::BTreeSet;

pub const CMD_MARKER: &str = "---GWSHELL-CMDS---";

/// Single POSIX-portable exec snippet (works on BusyBox/ash/OpenWrt, dash,
/// bash, zsh, Alpine, macOS) that fetches both `uname -s` and every command
/// name present in `$PATH`.
pub const POSIX_ENV_PROBE_CMD: &str =
    "uname -s 2>/dev/null; printf '\\n---GWSHELL-CMDS---\\n'; IFS=:; for d in $PATH; do [ -d \"$d\" ] && ls -1 \"$d\" 2>/dev/null; done";

const MAX_PROBED_COMMANDS: usize = 4000;

#[derive(Debug, Clone, Serialize)]
pub struct RemoteEnvProbe {
    pub table: String,
    pub commands: Vec<String>,
}

fn is_posix_kernel(uname_out: &str) -> bool {
    let kernel = uname_out.trim().to_lowercase();
    kernel.contains("linux")
        || kernel.contains("darwin")
        || kernel.contains("bsd")
        || kernel.contains("sunos")
        || kernel.contains("aix")
}

/// Decide the completion table ("unix" | "cmd" | "powershell") from the stdout
/// of `uname -s` and `echo %COMSPEC%`.
///
/// - A recognizable POSIX kernel name from `uname -s` => "unix".
/// - Otherwise it is Windows: cmd.exe expands `%COMSPEC%` to a path containing
///   "cmd.exe"; PowerShell leaves the literal `%COMSPEC%` token intact.
/// - Anything ambiguous falls back to "unix" (today's behavior).
pub fn classify_command_table(uname_out: &str, comspec_out: &str) -> &'static str {
    if is_posix_kernel(uname_out) {
        return "unix";
    }
    let comspec = comspec_out.to_lowercase();
    if comspec.contains("cmd.exe") {
        return "cmd";
    }
    if comspec.contains("%comspec%") {
        return "powershell";
    }
    "unix"
}

fn is_valid_command_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 64 || name.starts_with('.') {
        return false;
    }
    name.bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'+' | b':'))
}

/// Parse stdout of `POSIX_ENV_PROBE_CMD` into `(is_posix, sorted_unique_commands)`.
pub fn parse_posix_env_probe(raw: &str) -> (bool, Vec<String>) {
    let (head, tail) = match raw.split_once(CMD_MARKER) {
        Some((h, t)) => (h, t),
        None => (raw, ""),
    };
    if !is_posix_kernel(head) {
        return (false, Vec::new());
    }

    let mut set = BTreeSet::new();
    for line in tail.lines() {
        let name = line.trim();
        if is_valid_command_name(name) {
            set.insert(name.to_string());
            if set.len() >= MAX_PROBED_COMMANDS {
                break;
            }
        }
    }
    (true, set.into_iter().collect())
}

#[cfg(test)]
mod tests {
    use super::{classify_command_table, parse_posix_env_probe, CMD_MARKER};

    #[test]
    fn linux_uname_wins() {
        assert_eq!(classify_command_table("Linux", ""), "unix");
        assert_eq!(classify_command_table("Darwin", ""), "unix");
        assert_eq!(classify_command_table("FreeBSD", ""), "unix");
    }

    #[test]
    fn windows_cmd_via_comspec() {
        assert_eq!(
            classify_command_table("", r"C:\WINDOWS\system32\cmd.exe"),
            "cmd"
        );
    }

    #[test]
    fn windows_powershell_literal_comspec() {
        // PowerShell echoes the unexpanded token.
        assert_eq!(classify_command_table("", "%COMSPEC%"), "powershell");
    }

    #[test]
    fn ambiguous_falls_back_to_unix() {
        assert_eq!(classify_command_table("", ""), "unix");
        assert_eq!(classify_command_table("garbage", "garbage"), "unix");
    }

    #[test]
    fn parses_openwrt_busybox_commands_and_filters_noise() {
        let raw = format!(
            "Linux\n{}\nuci\nopkg\nlogread\nls\nls\n.hidden\nnot a cmd\n/abs/path\nvi\n",
            CMD_MARKER
        );
        let (is_posix, cmds) = parse_posix_env_probe(&raw);
        assert!(is_posix);
        assert_eq!(cmds, vec!["logread", "ls", "opkg", "uci", "vi"]);
    }

    #[test]
    fn non_posix_output_returns_false_and_empty() {
        let (is_posix, cmds) = parse_posix_env_probe("'uname' is not recognized");
        assert!(!is_posix);
        assert!(cmds.is_empty());
    }
}
