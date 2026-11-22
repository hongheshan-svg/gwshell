use super::anthropic::stream_anthropic_messages_once;
use super::openai::stream_openai_chat_completion_url;
use crate::agent::types::AiProviderSettings;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

pub(super) const ANTHROPIC_FALLBACK_MAX_TOKENS: [u32; 3] = [16_000, 8_192, 4_096];
pub(super) const RAW_RESPONSE_SAMPLE_LIMIT: usize = 4096;
const CONNECT_TIMEOUT_SECS: u64 = 20;
/// Floor for the idle timeout: reasoning models can be silent for a while
/// before their first token.
pub(super) const MIN_IDLE_TIMEOUT_SECS: u64 = 120;
const MAX_TRANSIENT_RETRIES: usize = 2;
const CANCEL_POLL_INTERVAL: Duration = Duration::from_millis(200);
pub(super) const CANCELLED: &str = "AI analysis cancelled";
pub(super) const TRUNCATED_NOTICE: &str =
    "\n\n[Response cut off: the model reached its output limit.]";

static CLIENT_CACHE: OnceLock<Mutex<HashMap<u64, reqwest::Client>>> = OnceLock::new();

/// Everything one chat request needs, shared by every attempt.
pub(super) struct ChatRequest<'a> {
    pub(super) settings: &'a AiProviderSettings,
    pub(super) api_key: &'a str,
    pub(super) system_prompt: &'a str,
    pub(super) user_prompt: String,
}

/// Request parameters adjusted between attempts when a provider rejects one.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct RequestTuning {
    pub(super) send_temperature: bool,
    pub(super) max_tokens: u32,
}

/// Why an attempt failed. `streamed` means text already reached the caller,
/// so the request must not be retried (the answer would be duplicated).
#[derive(Debug)]
pub(super) struct AttemptError {
    pub(super) message: String,
    pub(super) status: Option<u16>,
    pub(super) body: String,
    pub(super) streamed: bool,
}

impl AttemptError {
    pub(super) fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            status: None,
            body: String::new(),
            streamed: false,
        }
    }

    pub(super) fn streamed(mut self, streamed: bool) -> Self {
        self.streamed = streamed;
        self
    }
}

/// Connection setup gets a short timeout; the response gets an idle timeout
/// (the longest silence allowed between two chunks) instead of a total one.
/// Clients are cached per idle-timeout bucket so connection pools and TLS
/// sessions are reused across requests.
pub(super) fn build_client(settings: &AiProviderSettings) -> Result<reqwest::Client, String> {
    let read_timeout_secs = idle_timeout_secs(settings);
    let cache = CLIENT_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(guard) = cache.lock() {
        if let Some(existing) = guard.get(&read_timeout_secs) {
            return Ok(existing.clone());
        }
    }
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .read_timeout(Duration::from_secs(read_timeout_secs))
        .build()
        .map_err(|e| format!("AI client setup failed: {}", e))?;
    if let Ok(mut guard) = cache.lock() {
        if guard.len() > 16 {
            guard.clear();
        }
        guard.insert(read_timeout_secs, client.clone());
    }
    Ok(client)
}

/// Seconds of silence tolerated while waiting for the provider. The
/// `request_timeout_secs` setting, but never below MIN_IDLE_TIMEOUT_SECS.
pub(super) fn idle_timeout_secs(settings: &AiProviderSettings) -> u64 {
    settings.request_timeout_secs.max(MIN_IDLE_TIMEOUT_SECS)
}

/// Await `fut`, giving up as soon as `should_stop` turns true instead of
/// waiting for the provider's next chunk.
pub(super) async fn until_cancelled<T>(
    fut: impl std::future::Future<Output = T>,
    should_stop: &(impl Fn() -> bool + Sync),
) -> Result<T, AttemptError> {
    tokio::pin!(fut);
    loop {
        tokio::select! {
            out = &mut fut => return Ok(out),
            _ = tokio::time::sleep(CANCEL_POLL_INTERVAL) => {
                if should_stop() {
                    return Err(AttemptError::new(CANCELLED));
                }
            }
        }
    }
}

/// Send the request; a non-2xx status becomes an AttemptError carrying the body.
pub(super) async fn send_request(
    request: reqwest::RequestBuilder,
    url: &str,
    should_stop: &(impl Fn() -> bool + Sync),
) -> Result<reqwest::Response, AttemptError> {
    let response = until_cancelled(request.send(), should_stop)
        .await?
        .map_err(|e| {
            AttemptError::new(if e.is_timeout() {
                stream_error_message(&e)
            } else {
                format!("AI provider request failed: {}", e)
            })
        })?;
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let body = until_cancelled(response.text(), should_stop)
        .await?
        .unwrap_or_default();
    Err(AttemptError {
        message: format!(
            "AI provider request failed ({}) at {}: {}",
            status,
            url,
            describe_error_body(&body)
        ),
        status: Some(status.as_u16()),
        body,
        streamed: false,
    })
}

/// Decide whether a failed attempt can be retried, and how. Only attempts
/// that produced no output yet are retried.
fn retry_tuning(
    error: &AttemptError,
    tuning: RequestTuning,
    anthropic: bool,
) -> Option<RequestTuning> {
    if error.streamed || error.status != Some(400) {
        return None;
    }
    let body = error.body.to_ascii_lowercase();
    if tuning.send_temperature && body.contains("temperature") {
        return Some(RequestTuning {
            send_temperature: false,
            ..tuning
        });
    }
    if anthropic && body.contains("max_tokens") {
        let next = ANTHROPIC_FALLBACK_MAX_TOKENS
            .iter()
            .copied()
            .find(|&n| n < tuning.max_tokens)?;
        return Some(RequestTuning {
            max_tokens: next,
            ..tuning
        });
    }
    None
}

/// Rate limits and gateway/server hiccups are worth another try, but only
/// before any output has been streamed.
fn is_transient(error: &AttemptError) -> bool {
    !error.streamed
        && matches!(
            error.status,
            Some(408 | 409 | 425 | 429 | 500 | 502 | 503 | 504 | 529)
        )
}

async fn backoff(attempt: usize, should_stop: &(impl Fn() -> bool + Sync)) -> Result<(), String> {
    let delay = Duration::from_millis(800 * (1 << attempt.min(3)) as u64);
    until_cancelled(tokio::time::sleep(delay), should_stop)
        .await
        .map_err(|e| e.message)
}

#[derive(Clone, Copy, PartialEq)]
pub(super) enum Protocol {
    OpenAi,
    Anthropic,
}

/// Run attempts against one URL: adapt the request when the provider rejects
/// a parameter, back off and retry transient failures, otherwise give up.
pub(super) async fn run_attempts<F, S>(
    client: &reqwest::Client,
    request: &ChatRequest<'_>,
    url: &str,
    protocol: Protocol,
    mut tuning: RequestTuning,
    on_delta: &mut F,
    should_stop: &S,
) -> Result<String, AttemptError>
where
    F: FnMut(&str) + Send,
    S: Fn() -> bool + Send + Sync,
{
    let anthropic = protocol == Protocol::Anthropic;
    let mut transient_retries = 0;
    let mut adaptations = 0;
    loop {
        let result = match protocol {
            Protocol::OpenAi => {
                stream_openai_chat_completion_url(
                    client,
                    url,
                    request,
                    tuning,
                    on_delta,
                    should_stop,
                )
                .await
            }
            Protocol::Anthropic => {
                stream_anthropic_messages_once(client, url, request, tuning, on_delta, should_stop)
                    .await
            }
        };
        let error = match result {
            Ok(text) => return Ok(text),
            Err(error) => error,
        };
        if adaptations < 4 {
            if let Some(next) = retry_tuning(&error, tuning, anthropic) {
                tuning = next;
                adaptations += 1;
                continue;
            }
        }
        if transient_retries < MAX_TRANSIENT_RETRIES && is_transient(&error) {
            backoff(transient_retries, should_stop)
                .await
                .map_err(AttemptError::new)?;
            transient_retries += 1;
            continue;
        }
        return Err(error);
    }
}

/// Read timeouts surface as a generic body error; say what actually happened.
pub(super) fn stream_error_message(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        "AI provider stopped sending data (idle timeout). Increase the request timeout in AI settings if the model needs longer to think.".to_string()
    } else {
        format!("AI provider stream failed: {}", error)
    }
}

/// Short, readable form of a provider error body: the error message when the
/// body is JSON in one of the common shapes, otherwise the (truncated) body.
pub(super) fn describe_error_body(body: &str) -> String {
    let Ok(json) = serde_json::from_str::<Value>(body.trim()) else {
        return truncate_error_body(body, 500);
    };
    let error = json.get("error").unwrap_or(&json);
    let message = error
        .as_str()
        .or_else(|| error.get("message").and_then(|v| v.as_str()))
        .or_else(|| error.get("msg").and_then(|v| v.as_str()))
        .or_else(|| json.get("message").and_then(|v| v.as_str()));
    let code = error
        .get("code")
        .or_else(|| error.get("type"))
        .or_else(|| json.get("code"))
        .and_then(|v| v.as_str());
    match (code, message) {
        (Some(code), Some(message)) => truncate_error_body(&format!("{}: {}", code, message), 500),
        (None, Some(message)) => truncate_error_body(message, 500),
        _ => truncate_error_body(body, 500),
    }
}

pub(super) fn append_response_sample(sample: &mut String, chunk: &str) {
    let remaining = RAW_RESPONSE_SAMPLE_LIMIT.saturating_sub(sample.chars().count());
    if remaining == 0 {
        return;
    }
    sample.extend(chunk.chars().take(remaining));
}

pub(super) fn looks_like_html(raw: &str) -> bool {
    let trimmed = raw.trim_start().to_ascii_lowercase();
    trimmed.starts_with("<!doctype html")
        || trimmed.starts_with("<html")
        || trimmed.contains("<html")
}

/// The payload of an SSE `data:` line, if this is one with content.
pub(super) fn sse_data(line: &str) -> Option<&str> {
    let data = line
        .trim_end_matches(['\n', '\r'])
        .strip_prefix("data:")?
        .trim();
    (!data.is_empty() && data != "[DONE]").then_some(data)
}

pub(super) fn effective_max_input_chars(settings: &AiProviderSettings) -> usize {
    if settings.max_input_chars == 0 {
        AiProviderSettings::default().max_input_chars
    } else {
        settings.max_input_chars.clamp(2_000, 128_000)
    }
}

pub(super) fn truncate_middle(input: &str, max_chars: usize) -> String {
    let char_count = input.chars().count();
    if char_count <= max_chars {
        return input.to_string();
    }

    let head_chars = (max_chars / 3).max(500);
    let tail_chars = max_chars.saturating_sub(head_chars).max(500);
    let omitted = char_count.saturating_sub(head_chars + tail_chars);
    let head: String = input.chars().take(head_chars).collect();
    let tail_vec: Vec<char> = input.chars().rev().take(tail_chars).collect();
    let tail: String = tail_vec.into_iter().rev().collect();
    format!(
        "{}\n\n[...{} chars omitted by GWShell before sending to the model...]\n\n{}",
        head, omitted, tail
    )
}

pub(super) fn truncate_error_body(input: &str, max_chars: usize) -> String {
    let trimmed = input.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    let mut body: String = trimmed.chars().take(max_chars).collect();
    body.push_str("...");
    body
}
