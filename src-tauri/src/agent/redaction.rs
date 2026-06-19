const MAX_EVIDENCE_BODY: usize = 32 * 1024;

pub fn cap_text(input: &str, max_chars: usize) -> String {
    let mut out = String::new();
    for ch in input.chars().take(max_chars) {
        out.push(ch);
    }
    if input.chars().count() > max_chars {
        out.push_str("\n[truncated]");
    }
    out
}

pub fn redact_secrets(input: &str) -> String {
    let mut out = Vec::new();
    let mut in_private_key = false;

    for line in input.lines() {
        let lower = line.to_ascii_lowercase();
        if line.contains("-----BEGIN ") && line.contains("PRIVATE KEY-----") {
            in_private_key = true;
            out.push("[redacted private key]".to_string());
            continue;
        }
        if in_private_key {
            if line.contains("-----END ") && line.contains("PRIVATE KEY-----") {
                in_private_key = false;
            }
            continue;
        }
        if lower.contains("authorization: bearer ") {
            out.push("Authorization: Bearer [redacted]".to_string());
        } else {
            out.push(redact_assignment_line(line));
        }
    }

    cap_text(&out.join("\n"), MAX_EVIDENCE_BODY)
}

fn redact_assignment_line(line: &str) -> String {
    let lower = line.to_ascii_lowercase();
    let mut out = String::new();
    let mut last = 0;
    let mut idx = 0;

    while idx < line.len() {
        if !line.is_char_boundary(idx) {
            idx += 1;
            continue;
        }

        if let Some((value_start, value_end)) = assignment_value_range(line, &lower, idx) {
            out.push_str(&line[last..value_start]);
            out.push_str("[redacted]");
            last = value_end;
            idx = value_end;
        } else {
            idx = next_char_index(line, idx);
        }
    }

    out.push_str(&line[last..]);
    out
}

fn assignment_value_range(line: &str, lower: &str, idx: usize) -> Option<(usize, usize)> {
    let bytes = line.as_bytes();
    let lower_bytes = lower.as_bytes();
    let quoted_key = bytes.get(idx) == Some(&b'"');
    let key_start = if quoted_key { idx + 1 } else { idx };

    if !has_key_boundary_before(bytes, idx) {
        return None;
    }

    for key in ["api_key", "apikey", "token", "password", "passwd"] {
        let key_bytes = key.as_bytes();
        if !lower_bytes.get(key_start..)?.starts_with(key_bytes) {
            continue;
        }

        let mut after_key = key_start + key_bytes.len();
        if quoted_key {
            if bytes.get(after_key) != Some(&b'"') {
                continue;
            }
            after_key += 1;
        } else if bytes.get(after_key).is_some_and(|b| is_key_char(*b)) {
            continue;
        }

        let sep_idx = skip_ascii_whitespace(bytes, after_key);
        if !matches!(bytes.get(sep_idx), Some(b'=') | Some(b':')) {
            continue;
        }

        let value_idx = skip_ascii_whitespace(bytes, sep_idx + 1);
        if matches!(bytes.get(value_idx), Some(b'"') | Some(b'\'')) {
            let quote = bytes[value_idx];
            let value_start = value_idx + 1;
            let value_end = find_closing_quote(line, value_start, quote);
            return Some((value_start, value_end));
        }

        let value_end = find_unquoted_value_end(line, value_idx);
        return Some((value_idx, value_end));
    }

    None
}

fn has_key_boundary_before(bytes: &[u8], idx: usize) -> bool {
    idx == 0 || !is_key_char(bytes[idx - 1])
}

fn is_key_char(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn skip_ascii_whitespace(bytes: &[u8], mut idx: usize) -> usize {
    while bytes.get(idx).is_some_and(|b| b.is_ascii_whitespace()) {
        idx += 1;
    }
    idx
}

fn find_closing_quote(line: &str, start: usize, quote: u8) -> usize {
    let mut escaped = false;
    for (offset, ch) in line[start..].char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        if ch == quote as char {
            return start + offset;
        }
    }
    line.len()
}

fn find_unquoted_value_end(line: &str, start: usize) -> usize {
    for (offset, ch) in line[start..].char_indices() {
        if ch.is_whitespace() || matches!(ch, '&' | ',' | '}') {
            return start + offset;
        }
    }
    line.len()
}

fn next_char_index(line: &str, idx: usize) -> usize {
    line[idx..]
        .chars()
        .next()
        .map(|ch| idx + ch.len_utf8())
        .unwrap_or_else(|| line.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_bearer_tokens_and_password_assignments() {
        let text = "Authorization: Bearer abc123\nDB password=secret\nurl?token=abc";
        let redacted = redact_secrets(text);
        assert!(redacted.contains("Bearer [redacted]"));
        assert!(redacted.contains("password=[redacted]"));
        assert!(redacted.contains("token=[redacted]"));
        assert!(!redacted.contains("abc123"));
        assert!(!redacted.contains("secret"));
    }

    #[test]
    fn redacts_colon_json_and_spaced_assignment_forms() {
        let text = "password: secret1\ntoken: abc1\n\"password\": \"secret2\"\napi_key = secret3";
        let redacted = redact_secrets(text);
        assert!(redacted.contains("password: [redacted]"));
        assert!(redacted.contains("token: [redacted]"));
        assert!(redacted.contains("\"password\": \"[redacted]\""));
        assert!(redacted.contains("api_key = [redacted]"));
        assert!(!redacted.contains("secret1"));
        assert!(!redacted.contains("abc1"));
        assert!(!redacted.contains("secret2"));
        assert!(!redacted.contains("secret3"));
    }

    #[test]
    fn redacts_single_quoted_secret_values_with_spaces() {
        let redacted = redact_secrets("password='correct horse battery staple'");
        assert_eq!(redacted, "password='[redacted]'");
        assert!(!redacted.contains("correct"));
        assert!(!redacted.contains("battery staple"));
    }

    #[test]
    fn redacts_multiple_assignments_per_line() {
        let redacted = redact_secrets("token=a&token=b&password=c");
        assert_eq!(
            redacted,
            "token=[redacted]&token=[redacted]&password=[redacted]"
        );
    }

    #[test]
    fn redacts_private_key_blocks() {
        let text =
            "a\n-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n-----END OPENSSH PRIVATE KEY-----\nz";
        let redacted = redact_secrets(text);
        assert!(redacted.contains("[redacted private key]"));
        assert!(!redacted.contains("secret"));
        assert!(redacted.contains("z"));
    }
}
