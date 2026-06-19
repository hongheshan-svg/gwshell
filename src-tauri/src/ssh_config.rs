//! Minimal OpenSSH client-config (`~/.ssh/config`) parser for asset import.
//!
//! Scope: extracts per-`Host` blocks with the directives that map onto
//! `SessionConfig` (HostName, Port, User, IdentityFile, ProxyJump). Wildcard
//! host patterns (`*`/`?`) and negations (`!`) are skipped — they are matching
//! rules, not concrete assets. `Match` blocks and `Include` directives are
//! ignored. Within a block the first occurrence of a directive wins (OpenSSH
//! semantics); cross-block wildcard merging is intentionally out of scope.

use serde::Serialize;

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct SshConfigHost {
    pub alias: String,
    pub host_name: Option<String>,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub identity_file: Option<String>,
    pub jump_host: Option<String>,
    pub jump_port: Option<u16>,
    pub jump_user: Option<String>,
}

#[derive(Default)]
struct Block {
    patterns: Vec<String>,
    host_name: Option<String>,
    port: Option<u16>,
    user: Option<String>,
    identity_file: Option<String>,
    jump: Option<(Option<String>, String, Option<u16>)>, // (user, host, port)
}

fn strip_quotes(s: &str) -> &str {
    let s = s.trim();
    if s.len() >= 2 && s.starts_with('"') && s.ends_with('"') {
        &s[1..s.len() - 1]
    } else {
        s
    }
}

/// Split a config line into (keyword, argument). OpenSSH accepts both
/// `Key Value` and `Key=Value` forms.
fn split_directive(line: &str) -> Option<(String, String)> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let split_at = line.find(|c: char| c.is_whitespace() || c == '=')?;
    let key = line[..split_at].to_ascii_lowercase();
    let value = line[split_at..].trim_start_matches(['=', ' ', '\t']).trim();
    if value.is_empty() {
        return None;
    }
    Some((key, value.to_string()))
}

/// Parse the first hop of a ProxyJump value: `[user@]host[:port]`.
/// Comma-separated multi-hop chains use only the first hop; `none` is ignored.
fn parse_proxy_jump(value: &str) -> Option<(Option<String>, String, Option<u16>)> {
    let first = value.split(',').next()?.trim();
    if first.is_empty() || first.eq_ignore_ascii_case("none") {
        return None;
    }
    let (user, rest) = match first.split_once('@') {
        Some((u, r)) => (Some(u.to_string()), r),
        None => (None, first),
    };
    // Bracketed IPv6 ([::1]:port) is rare in configs; handle the simple form only.
    let (host, port) = match rest.rsplit_once(':') {
        Some((h, p)) if !h.contains(':') => (h, p.parse::<u16>().ok()),
        _ => (rest, None),
    };
    if host.is_empty() {
        return None;
    }
    Some((user, host.to_string(), port))
}

fn flush(block: Block, out: &mut Vec<SshConfigHost>) {
    for pattern in &block.patterns {
        if pattern.contains('*') || pattern.contains('?') || pattern.starts_with('!') {
            continue;
        }
        let (jump_user, jump_host, jump_port) = match &block.jump {
            Some((u, h, p)) => (u.clone(), Some(h.clone()), *p),
            None => (None, None, None),
        };
        out.push(SshConfigHost {
            alias: pattern.clone(),
            host_name: block.host_name.clone(),
            port: block.port,
            user: block.user.clone(),
            identity_file: block.identity_file.clone(),
            jump_host,
            jump_port,
            jump_user,
        });
    }
}

pub fn parse_ssh_config(content: &str) -> Vec<SshConfigHost> {
    let mut out = Vec::new();
    let mut current: Option<Block> = None;
    // Directives under a Match block don't belong to any Host asset.
    let mut in_match = false;

    for line in content.lines() {
        let Some((key, value)) = split_directive(line) else {
            continue;
        };
        match key.as_str() {
            "host" => {
                if let Some(block) = current.take() {
                    flush(block, &mut out);
                }
                in_match = false;
                current = Some(Block {
                    patterns: value
                        .split_whitespace()
                        .map(|p| strip_quotes(p).to_string())
                        .collect(),
                    ..Default::default()
                });
            }
            "match" => {
                if let Some(block) = current.take() {
                    flush(block, &mut out);
                }
                in_match = true;
            }
            _ if in_match => {}
            _ => {
                let Some(block) = current.as_mut() else {
                    continue; // global directive before any Host block
                };
                match key.as_str() {
                    "hostname" => {
                        block
                            .host_name
                            .get_or_insert_with(|| strip_quotes(&value).to_string());
                    }
                    "port" => {
                        if block.port.is_none() {
                            block.port = strip_quotes(&value).parse::<u16>().ok();
                        }
                    }
                    "user" => {
                        block
                            .user
                            .get_or_insert_with(|| strip_quotes(&value).to_string());
                    }
                    "identityfile" => {
                        // OpenSSH allows several IdentityFile lines; keep the first.
                        block
                            .identity_file
                            .get_or_insert_with(|| strip_quotes(&value).to_string());
                    }
                    "proxyjump" => {
                        if block.jump.is_none() {
                            block.jump = parse_proxy_jump(strip_quotes(&value));
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    if let Some(block) = current.take() {
        flush(block, &mut out);
    }
    out
}

/// Expand a leading `~/` (or `~\`) to the user's home directory so that the
/// stored key path is usable by the connection layer as-is.
pub fn expand_tilde(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")) {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest).to_string_lossy().to_string();
        }
    }
    path.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_basic_block() {
        let cfg = "Host web\n  HostName 10.0.0.5\n  Port 2222\n  User deploy\n  IdentityFile ~/.ssh/id_ed25519\n";
        let hosts = parse_ssh_config(cfg);
        assert_eq!(hosts.len(), 1);
        let h = &hosts[0];
        assert_eq!(h.alias, "web");
        assert_eq!(h.host_name.as_deref(), Some("10.0.0.5"));
        assert_eq!(h.port, Some(2222));
        assert_eq!(h.user.as_deref(), Some("deploy"));
        assert_eq!(h.identity_file.as_deref(), Some("~/.ssh/id_ed25519"));
    }

    #[test]
    fn skips_wildcards_and_negations() {
        let cfg = "Host *\n  User root\nHost db !db-old\n  HostName db.internal\nHost cache-?\n  Port 6379\n";
        let hosts = parse_ssh_config(cfg);
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].alias, "db");
        assert_eq!(hosts[0].host_name.as_deref(), Some("db.internal"));
    }

    #[test]
    fn multiple_patterns_emit_multiple_hosts() {
        let cfg = "Host alpha beta\n  HostName shared.example.com\n";
        let hosts = parse_ssh_config(cfg);
        assert_eq!(hosts.len(), 2);
        assert_eq!(hosts[0].alias, "alpha");
        assert_eq!(hosts[1].alias, "beta");
        assert_eq!(hosts[1].host_name.as_deref(), Some("shared.example.com"));
    }

    #[test]
    fn supports_equals_form_and_comments() {
        let cfg = "# comment\nHost=eq\nHostName=eq.example.com\nPort = 22\n";
        let hosts = parse_ssh_config(cfg);
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].host_name.as_deref(), Some("eq.example.com"));
        assert_eq!(hosts[0].port, Some(22));
    }

    #[test]
    fn parses_proxy_jump_forms() {
        assert_eq!(
            parse_proxy_jump("bastion"),
            Some((None, "bastion".to_string(), None))
        );
        assert_eq!(
            parse_proxy_jump("ops@bastion:2200"),
            Some((Some("ops".to_string()), "bastion".to_string(), Some(2200)))
        );
        assert_eq!(
            parse_proxy_jump("hop1,hop2"),
            Some((None, "hop1".to_string(), None))
        );
        assert_eq!(parse_proxy_jump("none"), None);
    }

    #[test]
    fn first_directive_wins_within_block() {
        let cfg = "Host a\n  HostName first\n  HostName second\n";
        let hosts = parse_ssh_config(cfg);
        assert_eq!(hosts[0].host_name.as_deref(), Some("first"));
    }

    #[test]
    fn match_block_directives_are_ignored() {
        let cfg = "Host real\n  HostName real.example.com\nMatch user root\n  HostName should-not-leak\nHost after\n  HostName after.example.com\n";
        let hosts = parse_ssh_config(cfg);
        assert_eq!(hosts.len(), 2);
        assert_eq!(hosts[0].host_name.as_deref(), Some("real.example.com"));
        assert_eq!(hosts[1].host_name.as_deref(), Some("after.example.com"));
    }

    #[test]
    fn quoted_values_are_unwrapped() {
        let cfg = "Host q\n  IdentityFile \"C:\\Users\\me\\my key\"\n";
        let hosts = parse_ssh_config(cfg);
        assert_eq!(
            hosts[0].identity_file.as_deref(),
            Some("C:\\Users\\me\\my key")
        );
    }
}
