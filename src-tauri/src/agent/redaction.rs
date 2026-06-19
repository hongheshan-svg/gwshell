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
        out.push(redact_sensitive_line(line));
    }

    cap_text(&out.join("\n"), MAX_EVIDENCE_BODY)
}

fn redact_sensitive_line(line: &str) -> String {
    let redacted_bearer = redact_bearer_line(line);
    redact_assignment_line(&redacted_bearer)
}

fn redact_bearer_line(line: &str) -> String {
    let lower = line.to_ascii_lowercase();
    let mut out = String::new();
    let mut last = 0;
    let mut idx = 0;

    while idx < line.len() {
        if !line.is_char_boundary(idx) {
            idx += 1;
            continue;
        }

        if let Some((value_start, value_end)) = bearer_value_range(line, &lower, idx) {
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

fn bearer_value_range(line: &str, lower: &str, idx: usize) -> Option<(usize, usize)> {
    let bytes = line.as_bytes();
    let lower_bytes = lower.as_bytes();
    let quoted_key = matches!(bytes.get(idx), Some(b'"') | Some(b'\''));
    let key_quote = quoted_key.then(|| bytes[idx]);
    let key_start = if quoted_key { idx + 1 } else { idx };

    if !has_key_boundary_before(bytes, idx) {
        return None;
    }

    for key in ["authorization", "http_authorization"] {
        let key_bytes = key.as_bytes();
        if !lower_bytes.get(key_start..)?.starts_with(key_bytes) {
            continue;
        }

        let mut after_key = key_start + key_bytes.len();
        if let Some(quote) = key_quote {
            if bytes.get(after_key) != Some(&quote) {
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
        let value_quote = if matches!(bytes.get(value_idx), Some(b'"') | Some(b'\'')) {
            Some(bytes[value_idx])
        } else {
            None
        };
        let bearer_idx = if value_quote.is_some() {
            value_idx + 1
        } else {
            value_idx
        };

        if !lower_bytes.get(bearer_idx..)?.starts_with(b"bearer") {
            continue;
        }

        let after_bearer = bearer_idx + "bearer".len();
        let value_start = skip_ascii_whitespace(bytes, after_bearer);
        if value_start == after_bearer {
            continue;
        }

        let value_end = if let Some(quote) = value_quote {
            find_closing_quote(line, value_start, quote)
        } else {
            find_unquoted_value_end(line, value_start)
        };
        return Some((value_start, value_end));
    }

    None
}

fn redact_assignment_line(line: &str) -> String {
    let mut out = String::new();
    let mut last = 0;
    let mut idx = 0;

    while idx < line.len() {
        if !line.is_char_boundary(idx) {
            idx += 1;
            continue;
        }

        if let Some((value_start, value_end)) = assignment_value_range(line, idx) {
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

fn assignment_value_range(line: &str, idx: usize) -> Option<(usize, usize)> {
    let bytes = line.as_bytes();
    let key_quote = match bytes.get(idx) {
        Some(b'"') | Some(b'\'') => Some(bytes[idx]),
        _ => None,
    };
    let quoted_key = key_quote.is_some();
    let key_start = if quoted_key { idx + 1 } else { idx };

    if !has_key_boundary_before(bytes, idx) {
        return None;
    }

    let (key_end, after_key) = if let Some(quote) = key_quote {
        let key_end = find_byte(bytes, key_start, quote)?;
        (key_end, key_end + 1)
    } else {
        let key_end = find_unquoted_key_end(bytes, key_start);
        if key_end == key_start {
            return None;
        }
        (key_end, key_end)
    };

    let key = line.get(key_start..key_end)?;
    if !is_sensitive_assignment_key(key) {
        return None;
    }

    let sep_idx = skip_ascii_whitespace(bytes, after_key);
    if !matches!(bytes.get(sep_idx), Some(b'=') | Some(b':')) {
        return None;
    }

    let value_idx = skip_ascii_whitespace(bytes, sep_idx + 1);
    if matches!(bytes.get(value_idx), Some(b'"') | Some(b'\'')) {
        let quote = bytes[value_idx];
        let value_start = value_idx + 1;
        let value_end = find_closing_quote(line, value_start, quote);
        return Some((value_start, value_end));
    }

    let value_end = find_unquoted_value_end(line, value_idx);
    Some((value_idx, value_end))
}

fn find_byte(bytes: &[u8], start: usize, needle: u8) -> Option<usize> {
    bytes[start..]
        .iter()
        .position(|b| *b == needle)
        .map(|offset| start + offset)
}

fn find_unquoted_key_end(bytes: &[u8], mut idx: usize) -> usize {
    while bytes.get(idx).is_some_and(|b| is_unquoted_key_char(*b)) {
        idx += 1;
    }
    idx
}

fn is_sensitive_assignment_key(key: &str) -> bool {
    let key = normalize_key(key);
    matches!(
        key.as_str(),
        "api_key"
            | "apikey"
            | "token"
            | "password"
            | "passwd"
            | "secret"
            | "secret_key"
            | "private_key"
            | "client_secret"
            | "aws_secret_access_key"
    ) || key.ends_with("_api_key")
        || key.ends_with("_token")
        || key.ends_with("_password")
        || key.ends_with("_passwd")
        || key.ends_with("_secret")
        || key.ends_with("_secret_key")
        || key.ends_with("_access_key")
        || key.ends_with("_private_key")
}

fn normalize_key(key: &str) -> String {
    let mut normalized = String::new();
    let mut prev_was_lower_or_digit = false;

    for ch in key.chars() {
        if ch == '-' || ch == '.' {
            if !normalized.ends_with('_') {
                normalized.push('_');
            }
            prev_was_lower_or_digit = false;
            continue;
        }
        if ch.is_ascii_uppercase() {
            if prev_was_lower_or_digit && !normalized.ends_with('_') {
                normalized.push('_');
            }
            normalized.push(ch.to_ascii_lowercase());
            prev_was_lower_or_digit = false;
        } else {
            normalized.push(ch.to_ascii_lowercase());
            prev_was_lower_or_digit = ch.is_ascii_lowercase() || ch.is_ascii_digit();
        }
    }

    normalized
}

fn has_key_boundary_before(bytes: &[u8], idx: usize) -> bool {
    idx == 0 || !is_unquoted_key_char(bytes[idx - 1])
}

fn is_key_char(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn is_unquoted_key_char(byte: u8) -> bool {
    is_key_char(byte) || byte == b'-' || byte == b'.'
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
    fn redacts_flexible_authorization_bearer_values() {
        let text = "\"Authorization\": \"Bearer abc\"\nAuthorization:Bearer def\nAuthorization:\tBearer ghi\nHTTP_AUTHORIZATION=Bearer jkl";
        let redacted = redact_secrets(text);
        assert!(redacted.contains("\"Authorization\": \"Bearer [redacted]\""));
        assert!(redacted.contains("Authorization:Bearer [redacted]"));
        assert!(redacted.contains("Authorization:\tBearer [redacted]"));
        assert!(redacted.contains("HTTP_AUTHORIZATION=Bearer [redacted]"));
        assert!(!redacted.contains("abc"));
        assert!(!redacted.contains("def"));
        assert!(!redacted.contains("ghi"));
        assert!(!redacted.contains("jkl"));
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
    fn redacts_suffix_style_secret_keys_and_single_quoted_keys() {
        let text =
            "OPENAI_API_KEY=sk-live\nGITHUB_TOKEN=ghp_secret\nDATABASE_PASSWORD=dbpass\n{'password': 'secret'}";
        let redacted = redact_secrets(text);
        assert!(redacted.contains("OPENAI_API_KEY=[redacted]"));
        assert!(redacted.contains("GITHUB_TOKEN=[redacted]"));
        assert!(redacted.contains("DATABASE_PASSWORD=[redacted]"));
        assert!(redacted.contains("'password': '[redacted]'"));
        assert!(!redacted.contains("sk-live"));
        assert!(!redacted.contains("ghp_secret"));
        assert!(!redacted.contains("dbpass"));
        assert!(!redacted.contains("secret'}"));
    }

    #[test]
    fn redacts_common_secret_and_private_key_names() {
        let text = "AWS_SECRET_ACCESS_KEY=aws-secret\nCLIENT_SECRET=client-secret\nSECRET_KEY=secret-key\nPRIVATE_KEY=private-key\nOIDC_CLIENT_SECRET=oidc-secret\nSERVICE_SECRET=service-secret\nAPP_SECRET_KEY=app-secret\nDB_ACCESS_KEY=db-access\nTLS_PRIVATE_KEY=tls-private\n{'client_secret': 'dict-secret'}";
        let redacted = redact_secrets(text);
        assert!(redacted.contains("AWS_SECRET_ACCESS_KEY=[redacted]"));
        assert!(redacted.contains("CLIENT_SECRET=[redacted]"));
        assert!(redacted.contains("SECRET_KEY=[redacted]"));
        assert!(redacted.contains("PRIVATE_KEY=[redacted]"));
        assert!(redacted.contains("OIDC_CLIENT_SECRET=[redacted]"));
        assert!(redacted.contains("SERVICE_SECRET=[redacted]"));
        assert!(redacted.contains("APP_SECRET_KEY=[redacted]"));
        assert!(redacted.contains("DB_ACCESS_KEY=[redacted]"));
        assert!(redacted.contains("TLS_PRIVATE_KEY=[redacted]"));
        assert!(redacted.contains("'client_secret': '[redacted]'"));
        for secret in [
            "aws-secret",
            "client-secret",
            "secret-key",
            "private-key",
            "oidc-secret",
            "service-secret",
            "app-secret",
            "db-access",
            "tls-private",
            "dict-secret",
        ] {
            assert!(!redacted.contains(secret), "{secret}");
        }
    }

    #[test]
    fn redacts_camel_case_and_hyphenated_secret_keys() {
        let text = "clientSecret=abc\nrefreshToken=def\n\"secretKey\": \"ghi\"\n\"x-api-key\": \"jkl\"\naccess-token: mno";
        let redacted = redact_secrets(text);
        assert!(redacted.contains("clientSecret=[redacted]"));
        assert!(redacted.contains("refreshToken=[redacted]"));
        assert!(redacted.contains("\"secretKey\": \"[redacted]\""));
        assert!(redacted.contains("\"x-api-key\": \"[redacted]\""));
        assert!(redacted.contains("access-token: [redacted]"));
        for secret in ["abc", "def", "ghi", "jkl", "mno"] {
            assert!(!redacted.contains(secret), "{secret}");
        }
    }

    #[test]
    fn redacts_unquoted_hyphenated_secret_keys() {
        let text = "x-api-key=secret\naccess-token: other";
        let redacted = redact_secrets(text);
        assert!(redacted.contains("x-api-key=[redacted]"));
        assert!(redacted.contains("access-token: [redacted]"));
        assert!(!redacted.contains("secret"));
        assert!(!redacted.contains("other"));
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
