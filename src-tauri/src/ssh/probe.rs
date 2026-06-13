//! Remote-OS detection for command-completion table selection.
//!
//! `detect_command_table` (in `mod.rs`) runs at most two short exec probes on
//! the live SSH connection; `classify_command_table` is the pure decision
//! function so it can be unit-tested without a network.

/// Decide the completion table ("unix" | "cmd" | "powershell") from the stdout
/// of `uname -s` and `echo %COMSPEC%`.
///
/// - A recognizable POSIX kernel name from `uname -s` => "unix".
/// - Otherwise it is Windows: cmd.exe expands `%COMSPEC%` to a path containing
///   "cmd.exe"; PowerShell leaves the literal `%COMSPEC%` token intact.
/// - Anything ambiguous falls back to "unix" (today's behavior).
pub fn classify_command_table(uname_out: &str, comspec_out: &str) -> &'static str {
    let kernel = uname_out.trim().to_lowercase();
    if kernel.contains("linux")
        || kernel.contains("darwin")
        || kernel.contains("bsd")
        || kernel.contains("sunos")
        || kernel.contains("aix")
    {
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

#[cfg(test)]
mod tests {
    use super::classify_command_table;

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
}
