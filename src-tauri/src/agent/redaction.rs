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
        } else if lower.contains("api_key=")
            || lower.contains("apikey=")
            || lower.contains("token=")
        {
            out.push(redact_assignment_line(line));
        } else if lower.contains("password=") || lower.contains("passwd=") {
            out.push(redact_assignment_line(line));
        } else {
            out.push(line.to_string());
        }
    }

    cap_text(&out.join("\n"), MAX_EVIDENCE_BODY)
}

fn redact_assignment_line(line: &str) -> String {
    let mut s = line.to_string();
    for key in ["api_key", "apikey", "token", "password", "passwd"] {
        for sep in ["=", ":"] {
            let needle = format!("{}{}", key, sep);
            if let Some(idx) = s.to_ascii_lowercase().find(&needle) {
                let end = s[idx..]
                    .find(|c: char| c.is_whitespace() || c == '&')
                    .map(|off| idx + off)
                    .unwrap_or_else(|| s.len());
                s.replace_range(idx + needle.len()..end, "[redacted]");
            }
        }
    }
    s
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
    fn redacts_private_key_blocks() {
        let text =
            "a\n-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n-----END OPENSSH PRIVATE KEY-----\nz";
        let redacted = redact_secrets(text);
        assert!(redacted.contains("[redacted private key]"));
        assert!(!redacted.contains("secret"));
        assert!(redacted.contains("z"));
    }
}
