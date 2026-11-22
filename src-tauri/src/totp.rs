// TOTP support for keyboard-interactive (MFA) SSH logins.
//
// The session's `totp_code` field accepts two kinds of value:
//  - a Base32 TOTP secret (what an authenticator app is provisioned with).
//    It is stored encrypted like a password, and a fresh RFC 6238 code is
//    generated at the moment the server asks for it.
//  - a one-time 6-8 digit code. Such a code expires within ~30 seconds, so it
//    is used for the current connection only and is never written to disk
//    (see `Database::save_session`) nor reused on a later reconnect.

use ring::hmac;

const STEP_SECS: u64 = 30;
const DIGITS: u32 = 6;
/// 80 bits: the minimum secret size RFC 4226 allows (Google Authenticator's
/// usual 16-character Base32 secret).
const MIN_SECRET_BYTES: usize = 10;

/// Whether `value` is a short numeric one-time code rather than a secret.
pub fn is_one_time_code(value: &str) -> bool {
    let v = value.trim();
    (6..=8).contains(&v.len()) && v.bytes().all(|b| b.is_ascii_digit())
}

/// The answer to send for an MFA prompt at `unix_time`: a freshly generated
/// code for a Base32 secret, otherwise the value itself (one-time code, or a
/// format we don't recognize — sent verbatim as before).
pub fn answer_for(value: &str, unix_time: u64) -> String {
    if is_one_time_code(value) {
        return value.trim().to_string();
    }
    match decode_base32(value) {
        Some(secret) if secret.len() >= MIN_SECRET_BYTES => totp(&secret, unix_time),
        _ => value.trim().to_string(),
    }
}

/// RFC 6238 TOTP (HMAC-SHA1, 30 s step, 6 digits).
fn totp(secret: &[u8], unix_time: u64) -> String {
    hotp(secret, unix_time / STEP_SECS)
}

/// RFC 4226 HOTP with dynamic truncation.
fn hotp(secret: &[u8], counter: u64) -> String {
    let key = hmac::Key::new(hmac::HMAC_SHA1_FOR_LEGACY_USE_ONLY, secret);
    let tag = hmac::sign(&key, &counter.to_be_bytes());
    let mac = tag.as_ref();
    let offset = (mac[mac.len() - 1] & 0x0f) as usize;
    let bin = u32::from_be_bytes([
        mac[offset] & 0x7f,
        mac[offset + 1],
        mac[offset + 2],
        mac[offset + 3],
    ]);
    format!(
        "{:0width$}",
        bin % 10u32.pow(DIGITS),
        width = DIGITS as usize
    )
}

/// RFC 4648 Base32, case-insensitive; spaces, dashes and `=` padding ignored.
fn decode_base32(input: &str) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let mut buffer: u32 = 0;
    let mut bits = 0u32;
    let mut saw_char = false;
    for ch in input.chars() {
        let value = match ch.to_ascii_uppercase() {
            c @ 'A'..='Z' => c as u32 - 'A' as u32,
            c @ '2'..='7' => c as u32 - '2' as u32 + 26,
            ' ' | '-' | '=' => continue,
            _ => return None,
        };
        saw_char = true;
        buffer = (buffer << 5) | value;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }
    saw_char.then_some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// RFC 6238 Appendix B test secret ("12345678901234567890") in Base32.
    const RFC_SECRET_B32: &str = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

    #[test]
    fn rfc6238_sha1_vectors() {
        // RFC 6238 lists 8-digit codes; the 6-digit code is their last 6 digits.
        for (time, eight_digits) in [
            (59u64, "94287082"),
            (1_111_111_109, "07081804"),
            (1_111_111_111, "14050471"),
            (1_234_567_890, "89005924"),
            (2_000_000_000, "69279037"),
        ] {
            assert_eq!(answer_for(RFC_SECRET_B32, time), &eight_digits[2..]);
        }
    }

    #[test]
    fn base32_is_case_and_spacing_insensitive() {
        assert_eq!(
            answer_for("gezd gnbv gy3t qojq gezd gnbv gy3t qojq", 59),
            "287082"
        );
        assert_eq!(decode_base32("MZXW6==="), Some(b"foo".to_vec()));
        assert_eq!(decode_base32("not base32!"), None);
    }

    #[test]
    fn one_time_codes_pass_through_and_are_detected() {
        assert!(is_one_time_code("123456"));
        assert!(is_one_time_code(" 12345678 "));
        assert!(!is_one_time_code("12345"));
        assert!(!is_one_time_code(RFC_SECRET_B32));
        assert_eq!(answer_for("654321", 59), "654321");
        // Unknown formats are sent verbatim (previous behaviour).
        assert_eq!(answer_for("abc", 59), "abc");
    }
}
