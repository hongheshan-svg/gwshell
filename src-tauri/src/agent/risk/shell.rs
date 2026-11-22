pub(super) struct NormalizedCommand<'a> {
    pub(super) name: String,
    pub(super) args: Vec<&'a str>,
}

/// Split a shell command string into top-level command segments delimited by
/// shell separators (`;`, `|`, `&`, redirects, newlines).
pub(super) fn shell_segments(command: &str) -> impl Iterator<Item = &str> {
    command.split(is_shell_segment_separator)
}

/// Split a command segment into cleaned whitespace tokens.
pub(super) fn segment_tokens(segment: &str) -> Vec<&str> {
    segment.split_whitespace().map(clean_token).collect()
}

pub(super) fn is_shell_segment_separator(ch: char) -> bool {
    matches!(ch, ';' | '|' | '&' | '\n' | '\r' | '>' | '<')
}

pub(super) fn has_shell_control_syntax(command: &str) -> bool {
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

/// Whether the shell would expand part of `command` before running it: `$`
/// anywhere outside single quotes, glob/brace characters outside any quotes,
/// or unbalanced quotes.
pub(super) fn has_unquoted_shell_expansion(command: &str) -> bool {
    let mut in_single = false;
    let mut in_double = false;
    for ch in command.chars() {
        match ch {
            '\'' if !in_double => in_single = !in_single,
            '"' if !in_single => in_double = !in_double,
            _ if in_single => {}
            '$' => return true,
            '*' | '?' | '[' | ']' | '{' | '}' if !in_double => return true,
            _ => {}
        }
    }
    in_single || in_double
}

/// Whether the `sudo`/`command`/`env` prefix sets any environment variable.
pub(super) fn uses_env_assignment(command: &str) -> bool {
    let tokens = segment_tokens(command);
    let mut idx = 0;
    while idx < tokens.len() {
        match command_word_name(tokens[idx]).as_str() {
            "sudo" => idx = skip_sudo_prefix(&tokens, idx + 1),
            "command" => idx += 1,
            "env" => {
                let start = idx + 1;
                idx = skip_env_prefix(&tokens, start);
                if tokens[start..idx.min(tokens.len())]
                    .iter()
                    .any(|token| is_env_assignment(token))
                {
                    return true;
                }
            }
            _ => break,
        }
    }
    false
}

/// Whether `command` starts with the words of `prefix` once `sudo`/`env`
/// wrappers are stripped.
pub fn command_matches_prefix(command: &str, prefix: &str) -> bool {
    let words: Vec<String> = prefix
        .split_whitespace()
        .map(|w| w.to_ascii_lowercase())
        .collect();
    let Some((name, args)) = words.split_first() else {
        return false;
    };
    let lowered = command.trim().to_ascii_lowercase();
    let Some(command) = normalized_command(&lowered) else {
        return false;
    };
    command.name == *name
        && args
            .iter()
            .enumerate()
            .all(|(idx, expected)| command.args.get(idx).is_some_and(|arg| arg == expected))
}

/// The unit argument of `systemctl <verb> <unit>` (first non-flag after the
/// verb), for applying the service denylist to RunCommand actions.
pub fn systemctl_unit(command: &str, verbs: &[&str]) -> Option<String> {
    let lowered = command.trim().to_ascii_lowercase();
    let command = normalized_command(&lowered)?;
    if command.name != "systemctl" {
        return None;
    }
    let verb_idx = command.args.iter().position(|arg| !arg.starts_with('-'))?;
    if !verbs.contains(&command.args[verb_idx]) {
        return None;
    }
    command.args[verb_idx + 1..]
        .iter()
        .find(|arg| !arg.starts_with('-'))
        .map(|unit| unit.to_string())
}

pub(super) fn normalized_command(command: &str) -> Option<NormalizedCommand<'_>> {
    let tokens = segment_tokens(command);
    let mut idx = 0;

    while idx < tokens.len() {
        match command_word_name(tokens[idx]).as_str() {
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

pub(super) fn matches_normalized_command(command: &str, words: &[&str]) -> bool {
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

pub(super) fn command_word_name(word: &str) -> String {
    let trimmed = clean_token(word);
    let basename = if trimmed.contains('/') || trimmed.contains(':') || trimmed.starts_with('\\') {
        trimmed.rsplit(['/', '\\']).next().unwrap_or(trimmed)
    } else {
        trimmed.rsplit('/').next().unwrap_or(trimmed)
    };
    let name: String = basename
        .chars()
        .filter(|ch| *ch != '\'' && *ch != '"' && *ch != '\\')
        .collect();
    normalize_known_command_word(&name).to_string()
}

pub(super) fn clean_token(token: &str) -> &str {
    token.trim_matches(|ch| ch == '\'' || ch == '"')
}

fn normalize_known_command_word(name: &str) -> &str {
    match name {
        "paswd" => "passwd",
        _ => name,
    }
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
