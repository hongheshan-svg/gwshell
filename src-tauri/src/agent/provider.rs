use super::types::AiProviderSettings;
use crate::database::Database;
use futures_util::StreamExt;
use reqwest::header::CONTENT_TYPE;
use serde_json::{json, Value};
use std::time::Duration;

const SETTINGS_KEY: &str = "agent_ai_provider_settings";
const SECRET_KEY: &str = "agent_ai_provider_api_key";
const ANTHROPIC_VERSION: &str = "2023-06-01";
// Room for the answer plus the thinking that current Claude models do by
// default (Fable 5.x and Opus 5.5 always think, and thinking tokens count
// against max_tokens; 4096 was often used up before any text). Stepped down
// when a gateway or an older model rejects the value.
const ANTHROPIC_MAX_TOKENS: u32 = 32_000;
const ANTHROPIC_FALLBACK_MAX_TOKENS: [u32; 3] = [16_000, 8_192, 4_096];
const RAW_RESPONSE_SAMPLE_LIMIT: usize = 4096;
const CONNECT_TIMEOUT_SECS: u64 = 20;
/// Floor for the idle timeout: reasoning models can be silent for a while
/// before their first token.
const MIN_IDLE_TIMEOUT_SECS: u64 = 120;
const MAX_TRANSIENT_RETRIES: usize = 2;
const CANCEL_POLL_INTERVAL: Duration = Duration::from_millis(200);
const CANCELLED: &str = "AI analysis cancelled";
const KEY_STORAGE_UNAVAILABLE: &str = "Could not save the API key: the system keychain is unavailable, so GWShell can't encrypt it. Unlock or allow keychain access for GWShell and save the key again.";
const KEY_UNREADABLE: &str = "The saved AI API key can't be decrypted (the system keychain is locked, access was denied, or its key changed). Enter the API key again in Settings > AI.";
const TRUNCATED_NOTICE: &str = "\n\n[Response cut off: the model reached its output limit.]";

pub fn load_settings(db: &Database) -> Result<AiProviderSettings, String> {
    let mut settings = match db.load_app_setting_key(SETTINGS_KEY)? {
        Some(raw) => serde_json::from_str::<AiProviderSettings>(&raw).unwrap_or_default(),
        None => AiProviderSettings::default(),
    };
    settings.api_key_configured = api_key_is_configured(db)?;
    Ok(settings)
}

pub fn save_settings(db: &Database, mut settings: AiProviderSettings) -> Result<(), String> {
    settings.api_key_configured = api_key_is_configured(db)?;
    let raw = serde_json::to_string(&settings).map_err(|e| e.to_string())?;
    db.save_app_setting_key(SETTINGS_KEY, &raw)
}

pub fn set_api_key(db: &Database, api_key: &str) -> Result<(), String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return clear_api_key(db);
    }

    let encrypted = encrypt_api_key(api_key);
    if encrypted.trim().is_empty() {
        // encrypt_secret drops secrets it cannot encrypt rather than storing
        // plaintext. Saving "" here used to look like success while the key
        // silently vanished, so every AI request then failed with "not configured".
        return Err(KEY_STORAGE_UNAVAILABLE.into());
    }
    db.save_app_setting_key(SECRET_KEY, &encrypted)
}

pub fn clear_api_key(db: &Database) -> Result<(), String> {
    db.delete_app_setting_key(SECRET_KEY)
}

fn api_key_is_configured(db: &Database) -> Result<bool, String> {
    Ok(db
        .load_app_setting_key(SECRET_KEY)?
        .is_some_and(|stored| !stored.trim().is_empty()))
}

pub fn load_api_key(db: &Database) -> Result<Option<String>, String> {
    let Some(stored) = db.load_app_setting_key(SECRET_KEY)? else {
        return Ok(None);
    };
    if stored.trim().is_empty() {
        return Ok(None);
    }
    let decrypted = decrypt_api_key(&stored);
    if decrypted.trim().is_empty() {
        // A key is saved (the settings page says "configured") but can't be
        // decrypted: the keychain master key is unreadable or was replaced.
        return Err(KEY_UNREADABLE.into());
    }
    Ok(Some(decrypted.trim().to_string()))
}

pub async fn test_provider_connectivity(
    settings: AiProviderSettings,
    api_key: String,
) -> Result<String, String> {
    let model = settings.model.clone();
    let mut preview = String::new();
    stream_chat_completion(
        settings,
        api_key,
        "You are a connectivity probe. Reply with a short OK response.".to_string(),
        "Return only: OK".to_string(),
        |delta| preview.push_str(delta),
        || false,
    )
    .await?;

    Ok(format!(
        "AI provider responded: {}{}",
        model,
        if preview.trim().is_empty() {
            String::new()
        } else {
            format!(" ({})", truncate_error_body(preview.trim(), 80))
        }
    ))
}

pub async fn stream_chat_completion<F, S>(
    settings: AiProviderSettings,
    api_key: String,
    system_prompt: String,
    user_prompt: String,
    mut on_delta: F,
    should_stop: S,
) -> Result<String, String>
where
    F: FnMut(&str) + Send,
    S: Fn() -> bool + Send + Sync,
{
    validate_provider_settings(&settings)?;
    if provider_requires_api_key(&settings) && api_key.trim().is_empty() {
        return Err("AI API key is not configured".into());
    }

    let client = build_client(&settings)?;
    let request = ChatRequest {
        settings: &settings,
        api_key: api_key.trim(),
        system_prompt: &system_prompt,
        user_prompt: truncate_middle(&user_prompt, effective_max_input_chars(&settings)),
    };

    if settings.provider == "anthropic_compatible" {
        return stream_anthropic_messages(&client, &request, &mut on_delta, &should_stop).await;
    }
    stream_openai_chat_completion(&client, &request, &mut on_delta, &should_stop).await
}

/// Everything one chat request needs, shared by every attempt.
struct ChatRequest<'a> {
    settings: &'a AiProviderSettings,
    api_key: &'a str,
    system_prompt: &'a str,
    user_prompt: String,
}

/// Request parameters adjusted between attempts when a provider rejects one.
#[derive(Clone, Copy, Debug, PartialEq)]
struct RequestTuning {
    send_temperature: bool,
    max_tokens: u32,
}

/// Why an attempt failed. `streamed` means text already reached the caller,
/// so the request must not be retried (the answer would be duplicated).
#[derive(Debug)]
struct AttemptError {
    message: String,
    status: Option<u16>,
    body: String,
    streamed: bool,
}

impl AttemptError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            status: None,
            body: String::new(),
            streamed: false,
        }
    }

    fn streamed(mut self, streamed: bool) -> Self {
        self.streamed = streamed;
        self
    }
}

/// Connection setup gets a short timeout; the response gets an idle timeout
/// (the longest silence allowed between two chunks) instead of a total one.
/// A total timeout cut off every answer that took longer than the setting to
/// stream, and reasoning models routinely think for a while before the first
/// token.
fn build_client(settings: &AiProviderSettings) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .read_timeout(Duration::from_secs(idle_timeout_secs(settings)))
        .build()
        .map_err(|e| format!("AI client setup failed: {}", e))
}

/// Seconds of silence tolerated while waiting for the provider. The
/// `request_timeout_secs` setting, but never below MIN_IDLE_TIMEOUT_SECS.
fn idle_timeout_secs(settings: &AiProviderSettings) -> u64 {
    settings.request_timeout_secs.max(MIN_IDLE_TIMEOUT_SECS)
}

/// Await `fut`, giving up as soon as `should_stop` turns true instead of
/// waiting for the provider's next chunk.
async fn until_cancelled<T>(
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
async fn send_request(
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
    // Reasoning models (GPT-5 family, o-series, GPT-6, newer Claude models
    // through some gateways) reject sampling parameters with a 400.
    if tuning.send_temperature && body.contains("temperature") {
        return Some(RequestTuning {
            send_temperature: false,
            ..tuning
        });
    }
    // Some Anthropic-compatible gateways and older models cap max_tokens lower.
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
/// before any output has been streamed. Network errors and timeouts are
/// reported straight away: retrying an unreachable host only multiplies the wait.
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
enum Protocol {
    OpenAi,
    Anthropic,
}

/// Run attempts against one URL: adapt the request when the provider rejects
/// a parameter, back off and retry transient failures, otherwise give up.
async fn run_attempts<F, S>(
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

async fn stream_openai_chat_completion<F, S>(
    client: &reqwest::Client,
    request: &ChatRequest<'_>,
    on_delta: &mut F,
    should_stop: &S,
) -> Result<String, String>
where
    F: FnMut(&str) + Send,
    S: Fn() -> bool + Send + Sync,
{
    let urls = chat_completions_urls(&request.settings.base_url)?;
    let initial = RequestTuning {
        send_temperature: !model_rejects_sampling_params(&request.settings.model),
        max_tokens: 0,
    };
    let mut last_retryable_error = None;

    for (index, url) in urls.iter().enumerate() {
        let result = run_attempts(
            client,
            request,
            url,
            Protocol::OpenAi,
            initial,
            on_delta,
            should_stop,
        )
        .await;
        match result {
            Ok(full_text) => return Ok(full_text),
            Err(error)
                if index + 1 < urls.len()
                    && !error.streamed
                    && is_retryable_openai_endpoint_error(&error.message) =>
            {
                last_retryable_error = Some(error.message);
            }
            Err(error) => return Err(error.message),
        }
    }

    Err(last_retryable_error.unwrap_or_else(|| {
        "AI provider did not return a usable chat completion response".to_string()
    }))
}

async fn stream_openai_chat_completion_url<F, S>(
    client: &reqwest::Client,
    url: &str,
    request: &ChatRequest<'_>,
    tuning: RequestTuning,
    on_delta: &mut F,
    should_stop: &S,
) -> Result<String, AttemptError>
where
    F: FnMut(&str) + Send,
    S: Fn() -> bool + Send + Sync,
{
    let mut body = json!({
        "model": request.settings.model.trim(),
        "stream": true,
        "messages": [
            { "role": "system", "content": request.system_prompt },
            { "role": "user", "content": request.user_prompt }
        ]
    });
    if tuning.send_temperature {
        body["temperature"] = json!(request.settings.temperature);
    }

    let mut builder = client.post(url).json(&body);
    if !request.api_key.is_empty() {
        builder = builder.bearer_auth(request.api_key);
    }
    let response = send_request(builder, url, should_stop).await?;

    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if content_type.contains("text/html") {
        let body = until_cancelled(response.text(), should_stop)
            .await?
            .unwrap_or_default();
        return Err(AttemptError::new(format!(
            "AI provider returned HTML at {}. Check Base URL; this endpoint may need /v1. Body: {}",
            url,
            truncate_error_body(&body, 300)
        )));
    }

    let mut full_text = String::new();
    let mut pending = String::new();
    let mut raw_response = String::new();
    let mut finish_reason: Option<String> = None;
    let mut stream = response.bytes_stream();
    loop {
        let Some(chunk) = until_cancelled(stream.next(), should_stop)
            .await
            .map_err(|e| e.streamed(!full_text.is_empty()))?
        else {
            break;
        };
        let chunk = chunk.map_err(|e| {
            AttemptError::new(stream_error_message(&e)).streamed(!full_text.is_empty())
        })?;
        let chunk_text = String::from_utf8_lossy(&chunk);
        append_response_sample(&mut raw_response, &chunk_text);
        pending.push_str(&chunk_text);

        while let Some(line_end) = pending.find('\n') {
            let line: String = pending.drain(..=line_end).collect();
            if let Some(error) = parse_openai_sse_line_error(&line) {
                return Err(AttemptError::new(error).streamed(!full_text.is_empty()));
            }
            if let Some(reason) = parse_openai_sse_line_finish_reason(&line) {
                finish_reason = Some(reason);
            }
            if let Some(delta) = parse_openai_sse_line_text_delta(&line) {
                if should_stop() {
                    return Err(AttemptError::new(CANCELLED).streamed(!full_text.is_empty()));
                }
                on_delta(&delta);
                full_text.push_str(&delta);
            }
        }
    }

    if !pending.trim().is_empty() {
        if let Some(error) = parse_openai_sse_line_error(&pending) {
            return Err(AttemptError::new(error).streamed(!full_text.is_empty()));
        }
        for delta in parse_openai_sse_text_delta(&pending) {
            on_delta(&delta);
            full_text.push_str(&delta);
        }
    }

    if full_text.trim().is_empty() {
        if let Some(error) = parse_openai_response_error(&raw_response) {
            return Err(AttemptError::new(error));
        }
        if let Some(text) = parse_openai_json_text(&raw_response) {
            on_delta(&text);
            return Ok(text);
        }
        if looks_like_html(&raw_response) {
            return Err(AttemptError::new(format!(
                "AI provider returned HTML at {}. Check Base URL; this endpoint may need /v1. Body: {}",
                url,
                truncate_error_body(&raw_response, 300)
            )));
        }
        if finish_reason.as_deref() == Some("length") {
            return Err(AttemptError::new(
                "The model used its whole output budget before writing an answer. Try a shorter question or less context.",
            ));
        }
        if finish_reason.as_deref() == Some("content_filter") {
            return Err(AttemptError::new(
                "The provider's content filter blocked this response.",
            ));
        }
        return Err(AttemptError::new(format!(
            "AI provider returned an empty or unsupported response at {}. Check Base URL, model, and streaming compatibility. Body: {}",
            url,
            truncate_error_body(&raw_response, 300)
        )));
    }

    if finish_reason.as_deref() == Some("length") {
        on_delta(TRUNCATED_NOTICE);
        full_text.push_str(TRUNCATED_NOTICE);
    }
    Ok(full_text)
}

async fn stream_anthropic_messages<F, S>(
    client: &reqwest::Client,
    request: &ChatRequest<'_>,
    on_delta: &mut F,
    should_stop: &S,
) -> Result<String, String>
where
    F: FnMut(&str) + Send,
    S: Fn() -> bool + Send + Sync,
{
    let url = messages_url(&request.settings.base_url)?;
    let initial = RequestTuning {
        // Never sent: current Claude models reject sampling parameters.
        send_temperature: false,
        max_tokens: ANTHROPIC_MAX_TOKENS,
    };
    run_attempts(
        client,
        request,
        &url,
        Protocol::Anthropic,
        initial,
        on_delta,
        should_stop,
    )
    .await
    .map_err(|e| e.message)
}

async fn stream_anthropic_messages_once<F, S>(
    client: &reqwest::Client,
    url: &str,
    request: &ChatRequest<'_>,
    tuning: RequestTuning,
    on_delta: &mut F,
    should_stop: &S,
) -> Result<String, AttemptError>
where
    F: FnMut(&str) + Send,
    S: Fn() -> bool + Send + Sync,
{
    let body = json!({
        "model": request.settings.model.trim(),
        "max_tokens": tuning.max_tokens,
        "stream": true,
        "system": request.system_prompt,
        "messages": [
            { "role": "user", "content": request.user_prompt }
        ]
    });

    let mut builder = client
        .post(url)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .json(&body);
    if !request.api_key.is_empty() {
        builder = builder.header("x-api-key", request.api_key);
    }
    let response = send_request(builder, url, should_stop).await?;

    let mut full_text = String::new();
    let mut pending = String::new();
    let mut stop_reason: Option<String> = None;
    let mut stream = response.bytes_stream();
    loop {
        let Some(chunk) = until_cancelled(stream.next(), should_stop)
            .await
            .map_err(|e| e.streamed(!full_text.is_empty()))?
        else {
            break;
        };
        let chunk = chunk.map_err(|e| {
            AttemptError::new(stream_error_message(&e)).streamed(!full_text.is_empty())
        })?;
        pending.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(line_end) = pending.find('\n') {
            let line: String = pending.drain(..=line_end).collect();
            if let Some(error) = parse_anthropic_sse_line_error(&line) {
                return Err(AttemptError::new(error).streamed(!full_text.is_empty()));
            }
            if let Some(reason) = parse_anthropic_sse_line_stop_reason(&line) {
                stop_reason = Some(reason);
            }
            if let Some(delta) = parse_anthropic_sse_line_text_delta(&line) {
                if should_stop() {
                    return Err(AttemptError::new(CANCELLED).streamed(!full_text.is_empty()));
                }
                on_delta(&delta);
                full_text.push_str(&delta);
            }
        }
    }

    if !pending.trim().is_empty() {
        if let Some(error) = parse_anthropic_sse_line_error(&pending) {
            return Err(AttemptError::new(error).streamed(!full_text.is_empty()));
        }
        if let Some(reason) = parse_anthropic_sse_line_stop_reason(&pending) {
            stop_reason = Some(reason);
        }
        for delta in parse_anthropic_sse_text_delta(&pending) {
            on_delta(&delta);
            full_text.push_str(&delta);
        }
    }

    match stop_reason.as_deref() {
        Some("refusal") => {
            return Err(AttemptError::new(
                "The model declined to answer this request (stop_reason: refusal).",
            )
            .streamed(!full_text.is_empty()))
        }
        Some("max_tokens") if full_text.trim().is_empty() => {
            return Err(AttemptError::new(
                "The model used its whole output budget before writing an answer. Try a shorter question or less context.",
            ))
        }
        Some("max_tokens") => {
            on_delta(TRUNCATED_NOTICE);
            full_text.push_str(TRUNCATED_NOTICE);
        }
        _ => {}
    }
    if full_text.trim().is_empty() {
        return Err(AttemptError::new(format!(
            "AI provider returned an empty response at {}. Check the model name and that the endpoint speaks the Anthropic Messages API.",
            url
        )));
    }
    Ok(full_text)
}

/// Read timeouts surface as a generic body error; say what actually happened.
fn stream_error_message(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        "AI provider stopped sending data (idle timeout). Increase the request timeout in AI settings if the model needs longer to think.".to_string()
    } else {
        format!("AI provider stream failed: {}", error)
    }
}

/// GPT-5 family, GPT-6, and the o-series reasoning models reject
/// `temperature` (only the default is accepted), so it isn't sent to them.
/// Gateways may prefix the model with a vendor (`openai/gpt-5.4`).
fn model_rejects_sampling_params(model: &str) -> bool {
    let model = model.trim().to_ascii_lowercase();
    let name = model.rsplit('/').next().unwrap_or(&model);
    ["gpt-5", "gpt-6", "o1", "o3", "o4"].iter().any(|family| {
        name == *family
            || name.starts_with(&format!("{}-", family))
            || name.starts_with(&format!("{}.", family))
    })
}

/// Short, readable form of a provider error body: the error message when the
/// body is JSON in one of the common shapes, otherwise the (truncated) body.
fn describe_error_body(body: &str) -> String {
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

pub fn chat_completions_url(base_url: &str) -> Result<String, String> {
    let base_url = base_url.trim().trim_end_matches('/');
    if base_url.is_empty() {
        return Err("AI provider base URL is required".into());
    }
    if base_url.ends_with("/chat/completions") {
        Ok(base_url.to_string())
    } else {
        Ok(format!("{}/chat/completions", base_url))
    }
}

pub fn chat_completions_urls(base_url: &str) -> Result<Vec<String>, String> {
    let base_url = base_url.trim().trim_end_matches('/');
    let primary = chat_completions_url(base_url)?;
    if base_url.ends_with("/chat/completions") {
        return Ok(vec![primary]);
    }

    let mut urls = vec![primary];
    if should_try_v1_chat_completions(base_url) {
        let v1_url = format!("{}/v1/chat/completions", base_url);
        if !urls.contains(&v1_url) {
            urls.push(v1_url);
        }
    }
    Ok(urls)
}

pub fn messages_url(base_url: &str) -> Result<String, String> {
    let base_url = base_url.trim().trim_end_matches('/');
    if base_url.is_empty() {
        return Err("AI provider base URL is required".into());
    }
    if base_url.ends_with("/messages") {
        Ok(base_url.to_string())
    } else {
        Ok(format!("{}/messages", base_url))
    }
}

pub fn parse_openai_sse_text_delta(chunk: &str) -> Vec<String> {
    let mut deltas = Vec::new();
    for line in chunk.lines() {
        if let Some(delta) = parse_openai_sse_line_text_delta(line) {
            deltas.push(delta);
        }
    }
    deltas
}

pub fn parse_anthropic_sse_text_delta(chunk: &str) -> Vec<String> {
    let mut deltas = Vec::new();
    for line in chunk.lines() {
        if let Some(delta) = parse_anthropic_sse_line_text_delta(line) {
            deltas.push(delta);
        }
    }
    deltas
}

fn validate_provider_settings(settings: &AiProviderSettings) -> Result<(), String> {
    if !matches!(
        settings.provider.as_str(),
        "openai_compatible" | "anthropic_compatible" | "ollama"
    ) {
        return Err(format!("Unsupported AI provider: {}", settings.provider));
    }
    if settings.base_url.trim().is_empty() {
        return Err("AI provider base URL is required".into());
    }
    if settings.model.trim().is_empty() {
        return Err("AI model is required".into());
    }
    Ok(())
}

pub fn provider_requires_api_key(settings: &AiProviderSettings) -> bool {
    settings.provider != "ollama"
}

fn should_try_v1_chat_completions(base_url: &str) -> bool {
    let without_scheme = base_url
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(base_url);
    !without_scheme.contains('/')
}

fn is_retryable_openai_endpoint_error(error: &str) -> bool {
    error.contains("returned HTML")
        || error.contains("empty or unsupported response")
        || error.contains("(404")
        || error.contains("(405")
}

fn append_response_sample(sample: &mut String, chunk: &str) {
    let remaining = RAW_RESPONSE_SAMPLE_LIMIT.saturating_sub(sample.chars().count());
    if remaining == 0 {
        return;
    }
    sample.extend(chunk.chars().take(remaining));
}

fn looks_like_html(raw: &str) -> bool {
    let trimmed = raw.trim_start().to_ascii_lowercase();
    trimmed.starts_with("<!doctype html")
        || trimmed.starts_with("<html")
        || trimmed.contains("<html")
}

fn parse_openai_sse_line_text_delta(line: &str) -> Option<String> {
    let line = line.trim_end_matches('\n').trim_end_matches('\r');
    let rest = line.strip_prefix("data:")?;
    let data = rest.trim();
    if data == "[DONE]" || data.is_empty() {
        return None;
    }
    let json = serde_json::from_str::<serde_json::Value>(data).ok()?;
    json.get("choices")
        .and_then(|v| v.get(0))
        .and_then(|v| v.get("delta"))
        .and_then(|v| v.get("content"))
        .and_then(|v| v.as_str())
        .map(ToString::to_string)
}

fn parse_openai_response_error(raw: &str) -> Option<String> {
    let json = serde_json::from_str::<Value>(raw.trim()).ok()?;
    if json.get("choices").is_some() {
        return None;
    }
    if json.get("error").map_or(true, Value::is_null)
        && json.get("message").is_none()
        && json.get("msg").is_none()
    {
        return None;
    }
    Some(format!(
        "AI provider returned an error: {}",
        describe_error_body(raw)
    ))
}

/// `data: {"error": ...}` inside an OpenAI-compatible stream (gateways report
/// upstream failures this way after a 200).
fn parse_openai_sse_line_error(line: &str) -> Option<String> {
    let data = sse_data(line)?;
    let json = serde_json::from_str::<Value>(data).ok()?;
    json.get("error").filter(|e| !e.is_null())?;
    Some(format!(
        "AI provider stream failed: {}",
        describe_error_body(data)
    ))
}

fn parse_openai_sse_line_finish_reason(line: &str) -> Option<String> {
    let json = serde_json::from_str::<Value>(sse_data(line)?).ok()?;
    json.get("choices")?
        .get(0)?
        .get("finish_reason")?
        .as_str()
        .map(ToString::to_string)
}

/// `stop_reason` from an Anthropic `message_delta` event.
fn parse_anthropic_sse_line_stop_reason(line: &str) -> Option<String> {
    let json = serde_json::from_str::<Value>(sse_data(line)?).ok()?;
    if json.get("type").and_then(|v| v.as_str()) != Some("message_delta") {
        return None;
    }
    json.get("delta")?
        .get("stop_reason")?
        .as_str()
        .map(ToString::to_string)
}

/// The payload of an SSE `data:` line, if this is one with content.
fn sse_data(line: &str) -> Option<&str> {
    let data = line
        .trim_end_matches(['\n', '\r'])
        .strip_prefix("data:")?
        .trim();
    (!data.is_empty() && data != "[DONE]").then_some(data)
}

fn parse_openai_json_text(raw: &str) -> Option<String> {
    let json = serde_json::from_str::<Value>(raw.trim()).ok()?;
    let choice = json.get("choices").and_then(|v| v.get(0))?;
    choice
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(openai_content_value_to_text)
        .or_else(|| {
            choice
                .get("delta")
                .and_then(|delta| delta.get("content"))
                .and_then(openai_content_value_to_text)
        })
        .or_else(|| choice.get("text").and_then(openai_content_value_to_text))
        .filter(|text| !text.trim().is_empty())
}

fn openai_content_value_to_text(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_string());
    }
    let parts = value.as_array()?;
    let text = parts
        .iter()
        .filter_map(|part| {
            part.get("text").and_then(|text| text.as_str()).or_else(|| {
                part.get("type")
                    .and_then(|kind| (kind.as_str() == Some("text")).then_some(part))
                    .and_then(|part| part.get("content"))
                    .and_then(|content| content.as_str())
            })
        })
        .collect::<Vec<_>>()
        .join("");
    (!text.trim().is_empty()).then_some(text)
}

fn parse_anthropic_sse_line_text_delta(line: &str) -> Option<String> {
    let line = line.trim_end_matches('\n').trim_end_matches('\r');
    let rest = line.strip_prefix("data:")?;
    let data = rest.trim();
    if data.is_empty() {
        return None;
    }
    let json = serde_json::from_str::<serde_json::Value>(data).ok()?;
    if json.get("type").and_then(|v| v.as_str()) != Some("content_block_delta") {
        return None;
    }
    let delta = json.get("delta")?;
    if delta.get("type").and_then(|v| v.as_str()) != Some("text_delta") {
        return None;
    }
    delta
        .get("text")
        .and_then(|v| v.as_str())
        .map(ToString::to_string)
}

fn parse_anthropic_sse_line_error(line: &str) -> Option<String> {
    let line = line.trim_end_matches('\n').trim_end_matches('\r');
    let rest = line.strip_prefix("data:")?;
    let data = rest.trim();
    let json = serde_json::from_str::<serde_json::Value>(data).ok()?;
    if json.get("type").and_then(|v| v.as_str()) != Some("error") {
        return None;
    }
    let message = describe_error_body(data);
    let message = if message.trim().is_empty() || message == data.trim() {
        "Anthropic provider stream returned an error".to_string()
    } else {
        message
    };
    Some(format!("AI provider stream failed: {}", message))
}

fn effective_max_input_chars(settings: &AiProviderSettings) -> usize {
    if settings.max_input_chars == 0 {
        AiProviderSettings::default().max_input_chars
    } else {
        settings.max_input_chars.clamp(2_000, 128_000)
    }
}

fn truncate_middle(input: &str, max_chars: usize) -> String {
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

fn truncate_error_body(input: &str, max_chars: usize) -> String {
    let trimmed = input.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    let mut body: String = trimmed.chars().take(max_chars).collect();
    body.push_str("...");
    body
}

#[cfg(not(test))]
fn decrypt_api_key(stored: &str) -> String {
    crate::crypto::decrypt_secret(stored)
}

#[cfg(test)]
fn decrypt_api_key(stored: &str) -> String {
    // Mirrors crypto::decrypt_secret when the keychain key is unusable: an
    // encrypted value comes back empty.
    if stored.starts_with("enc:v1:") {
        String::new()
    } else {
        stored.to_string()
    }
}

#[cfg(not(test))]
fn encrypt_api_key(api_key: &str) -> String {
    crate::crypto::encrypt_secret(api_key)
}

#[cfg(test)]
fn encrypt_api_key(api_key: &str) -> String {
    // Unit tests cover provider persistence without invoking platform keyring UI.
    api_key.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_API_KEY: &str = "sk-test-provider-key";

    fn db() -> Database {
        Database::new_in_memory_for_tests().unwrap()
    }

    #[test]
    fn serialized_settings_do_not_need_api_key_value() {
        let raw = serde_json::to_string(&AiProviderSettings::default()).unwrap();
        assert!(!raw.contains("sk-"));
        assert!(raw.contains("api_key_configured"));
    }

    #[test]
    fn load_settings_defaults_when_nothing_is_persisted() {
        let db = db();

        let settings = load_settings(&db).unwrap();

        assert_eq!(settings.enabled, AiProviderSettings::default().enabled);
        assert_eq!(settings.provider, AiProviderSettings::default().provider);
        assert_eq!(settings.base_url, AiProviderSettings::default().base_url);
        assert_eq!(settings.model, AiProviderSettings::default().model);
        assert!(!settings.api_key_configured);
    }

    #[test]
    fn set_api_key_roundtrips_and_marks_settings_configured() {
        let db = db();

        set_api_key(&db, TEST_API_KEY).unwrap();

        assert_eq!(load_api_key(&db).unwrap().as_deref(), Some(TEST_API_KEY));
        assert!(load_settings(&db).unwrap().api_key_configured);
    }

    #[test]
    fn load_settings_marks_key_configured_without_decrypting_key() {
        let db = db();
        db.save_app_setting_key(SECRET_KEY, "enc:v1:not-valid-base64")
            .unwrap();

        let settings = load_settings(&db).unwrap();

        assert!(settings.api_key_configured);
        // An unreadable key must say so, not masquerade as "not configured"
        // while the settings page shows it as configured.
        let error = load_api_key(&db).unwrap_err();
        assert!(error.contains("can't be decrypted"), "{error}");
    }

    #[test]
    fn save_settings_does_not_write_raw_api_key_to_settings_json() {
        let db = db();
        set_api_key(&db, TEST_API_KEY).unwrap();
        let settings = AiProviderSettings {
            enabled: true,
            model: "provider-model".to_string(),
            api_key_configured: false,
            ..AiProviderSettings::default()
        };

        save_settings(&db, settings).unwrap();

        let raw = db.load_app_setting_key(SETTINGS_KEY).unwrap().unwrap();
        assert!(!raw.contains(TEST_API_KEY));
        assert!(raw.contains("\"api_key_configured\":true"));
        let saved: AiProviderSettings = serde_json::from_str(&raw).unwrap();
        assert!(saved.api_key_configured);
        assert_eq!(saved.model, "provider-model");
    }

    #[test]
    fn clear_api_key_removes_key_and_marks_settings_unconfigured() {
        let db = db();
        set_api_key(&db, TEST_API_KEY).unwrap();

        clear_api_key(&db).unwrap();

        assert_eq!(load_api_key(&db).unwrap(), None);
        assert!(!load_settings(&db).unwrap().api_key_configured);
    }

    #[test]
    fn save_settings_recomputes_stale_configured_flag_from_stored_key_state() {
        let db = db();
        let settings = AiProviderSettings {
            api_key_configured: true,
            ..AiProviderSettings::default()
        };

        save_settings(&db, settings).unwrap();

        let raw = db.load_app_setting_key(SETTINGS_KEY).unwrap().unwrap();
        let saved: AiProviderSettings = serde_json::from_str(&raw).unwrap();
        assert!(!saved.api_key_configured);
        assert!(!load_settings(&db).unwrap().api_key_configured);
    }

    #[test]
    fn ollama_provider_is_supported_without_api_key() {
        let settings = AiProviderSettings {
            provider: "ollama".into(),
            base_url: "http://localhost:11434/v1".into(),
            model: "llama3.1".into(),
            ..AiProviderSettings::default()
        };

        assert!(validate_provider_settings(&settings).is_ok());
        assert!(!provider_requires_api_key(&settings));
    }

    #[test]
    fn anthropic_compatible_provider_is_supported_and_requires_api_key() {
        let settings = AiProviderSettings {
            provider: "anthropic_compatible".into(),
            base_url: "https://api.anthropic.com/v1".into(),
            model: "claude-sonnet-4-5".into(),
            ..AiProviderSettings::default()
        };

        assert!(validate_provider_settings(&settings).is_ok());
        assert!(provider_requires_api_key(&settings));
    }
}

#[cfg(test)]
mod sse_tests {
    use super::*;

    #[test]
    fn parses_openai_text_deltas() {
        let chunk = r#"data: {"choices":[{"delta":{"content":"hello"}}]}
data: [DONE]"#;

        assert_eq!(parse_openai_sse_text_delta(chunk), vec!["hello"]);
    }

    #[test]
    fn ignores_malformed_sse_lines() {
        let chunk = r#"event: completion.chunk
data: not-json
data: {"choices":[{"delta":{}}]}
data:
data: [DONE]"#;

        assert!(parse_openai_sse_text_delta(chunk).is_empty());
    }

    #[test]
    fn parses_multiple_data_lines() {
        let chunk = r#"data: {"choices":[{"delta":{"content":"hello"}}]}
data: {"choices":[{"delta":{"content":" world"}}]}"#;

        assert_eq!(parse_openai_sse_text_delta(chunk), vec!["hello", " world"]);
    }

    #[test]
    fn parses_crlf_data_and_ignores_comment_lines() {
        let chunk = ": keep-alive\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}\r\ndata: [DONE]\r\n";

        assert_eq!(parse_openai_sse_text_delta(chunk), vec!["hello"]);
    }

    #[test]
    fn collects_empty_content_delta() {
        let chunk = r#"data: {"choices":[{"delta":{"content":""}}]}"#;

        assert_eq!(parse_openai_sse_text_delta(chunk), vec![""]);
    }

    #[test]
    fn builds_chat_completions_url_from_base_url() {
        assert_eq!(
            chat_completions_url("https://api.example.com/v1").unwrap(),
            "https://api.example.com/v1/chat/completions"
        );
        assert_eq!(
            chat_completions_url("https://api.example.com/v1/chat/completions/").unwrap(),
            "https://api.example.com/v1/chat/completions"
        );
    }

    #[test]
    fn adds_v1_chat_completions_fallback_for_bare_domains() {
        assert_eq!(
            chat_completions_urls("https://gw-link.com").unwrap(),
            vec![
                "https://gw-link.com/chat/completions".to_string(),
                "https://gw-link.com/v1/chat/completions".to_string()
            ]
        );
        assert_eq!(
            chat_completions_urls("https://api.example.com/v1").unwrap(),
            vec!["https://api.example.com/v1/chat/completions".to_string()]
        );
    }

    #[test]
    fn rejects_blank_chat_completions_base_url() {
        assert_eq!(
            chat_completions_url("  "),
            Err("AI provider base URL is required".to_string())
        );
    }

    #[test]
    fn parses_openai_non_streaming_json_response() {
        let raw = r#"{"choices":[{"message":{"content":"hello json"}}]}"#;

        assert_eq!(parse_openai_json_text(raw), Some("hello json".to_string()));
    }

    #[test]
    fn parses_openai_content_array_response() {
        let raw = r#"{"choices":[{"message":{"content":[{"type":"text","text":"hello"},{"type":"text","text":" array"}]}}]}"#;

        assert_eq!(parse_openai_json_text(raw), Some("hello array".to_string()));
    }

    #[test]
    fn detects_html_provider_response() {
        assert!(looks_like_html("<!doctype html><html></html>"));
        assert!(is_retryable_openai_endpoint_error(
            "AI provider returned HTML at https://example.com"
        ));
    }

    #[test]
    fn builds_anthropic_messages_url_from_base_url() {
        assert_eq!(
            messages_url("https://api.anthropic.com/v1").unwrap(),
            "https://api.anthropic.com/v1/messages"
        );
        assert_eq!(
            messages_url("https://api.example.com/v1/messages/").unwrap(),
            "https://api.example.com/v1/messages"
        );
    }

    #[test]
    fn parses_anthropic_text_deltas() {
        let chunk = r#"event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}
event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}"#;

        assert_eq!(
            parse_anthropic_sse_text_delta(chunk),
            vec!["hello", " world"]
        );
    }

    #[test]
    fn truncates_long_prompt_without_losing_both_edges() {
        let input = format!(
            "{}{}{}",
            "a".repeat(1_000),
            "b".repeat(1_000),
            "c".repeat(1_000)
        );

        let truncated = truncate_middle(&input, 2_000);

        assert!(truncated.starts_with('a'));
        assert!(truncated.ends_with('c'));
        assert!(truncated.contains("chars omitted"));
        assert!(truncated.chars().count() < input.chars().count());
    }
}

#[cfg(test)]
mod request_tests {
    use super::*;
    use std::sync::{Arc, Mutex as StdMutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// One canned HTTP response from the mock provider.
    struct Reply {
        status: u16,
        content_type: &'static str,
        body: String,
    }

    fn sse(body: &str) -> Reply {
        Reply {
            status: 200,
            content_type: "text/event-stream",
            body: body.to_string(),
        }
    }

    fn json_reply(status: u16, body: &str) -> Reply {
        Reply {
            status,
            content_type: "application/json",
            body: body.to_string(),
        }
    }

    /// Serve `replies` in order, one per connection, recording each request
    /// (path + JSON body). Returns the base URL.
    async fn mock_provider(replies: Vec<Reply>) -> (String, Arc<StdMutex<Vec<(String, Value)>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let seen = Arc::new(StdMutex::new(Vec::new()));
        let log = seen.clone();
        tokio::spawn(async move {
            for reply in replies {
                let Ok((mut socket, _)) = listener.accept().await else {
                    return;
                };
                let mut raw = Vec::new();
                let mut buf = [0u8; 8192];
                let (head_end, content_length) = loop {
                    let n = socket.read(&mut buf).await.unwrap();
                    assert!(n > 0, "client closed before sending a request");
                    raw.extend_from_slice(&buf[..n]);
                    let text = String::from_utf8_lossy(&raw).to_string();
                    if let Some(pos) = text.find("\r\n\r\n") {
                        let length = text[..pos]
                            .lines()
                            .find_map(|l| {
                                let (k, v) = l.split_once(':')?;
                                k.eq_ignore_ascii_case("content-length")
                                    .then(|| v.trim().parse::<usize>().ok())?
                            })
                            .unwrap_or(0);
                        break (pos + 4, length);
                    }
                };
                while raw.len() < head_end + content_length {
                    let n = socket.read(&mut buf).await.unwrap();
                    raw.extend_from_slice(&buf[..n]);
                }
                let text = String::from_utf8_lossy(&raw).to_string();
                let path = text
                    .lines()
                    .next()
                    .and_then(|l| l.split_whitespace().nth(1))
                    .unwrap_or_default()
                    .to_string();
                let body = serde_json::from_str(&text[head_end..]).unwrap_or(Value::Null);
                log.lock().unwrap().push((path, body));
                let response = format!(
                    "HTTP/1.1 {} X\r\ncontent-type: {}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                    reply.status,
                    reply.content_type,
                    reply.body.len(),
                    reply.body
                );
                socket.write_all(response.as_bytes()).await.unwrap();
                let _ = socket.shutdown().await;
            }
        });
        (format!("http://{}/v1", addr), seen)
    }

    fn settings(provider: &str, base_url: &str, model: &str) -> AiProviderSettings {
        AiProviderSettings {
            enabled: true,
            provider: provider.into(),
            base_url: base_url.into(),
            model: model.into(),
            ..AiProviderSettings::default()
        }
    }

    async fn run(settings: AiProviderSettings) -> (Result<String, String>, String) {
        let mut streamed = String::new();
        let result = stream_chat_completion(
            settings,
            "test-key".into(),
            "system".into(),
            "question".into(),
            |delta| streamed.push_str(delta),
            || false,
        )
        .await;
        (result, streamed)
    }

    const OPENAI_OK: &str = "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"lo\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";

    #[tokio::test]
    async fn reasoning_models_are_sent_no_temperature() {
        let (base, seen) = mock_provider(vec![sse(OPENAI_OK)]).await;
        let (result, streamed) = run(settings("openai_compatible", &base, "gpt-5.5")).await;
        assert_eq!(result.unwrap(), "Hello");
        assert_eq!(streamed, "Hello");
        let seen = seen.lock().unwrap();
        assert_eq!(seen[0].0, "/v1/chat/completions");
        assert!(seen[0].1.get("temperature").is_none(), "{}", seen[0].1);
    }

    #[tokio::test]
    async fn rejected_temperature_is_dropped_and_retried() {
        let rejected = r#"{"error":{"message":"Unsupported value: 'temperature' does not support 0.2 with this model. Only the default (1) value is supported.","type":"invalid_request_error","param":"temperature","code":"unsupported_value"}}"#;
        let (base, seen) = mock_provider(vec![json_reply(400, rejected), sse(OPENAI_OK)]).await;
        let (result, _) = run(settings("openai_compatible", &base, "my-gateway-model")).await;
        assert_eq!(result.unwrap(), "Hello");
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 2);
        assert!(seen[0].1.get("temperature").is_some());
        assert!(seen[1].1.get("temperature").is_none());
    }

    #[tokio::test]
    async fn transient_errors_are_retried_before_any_output() {
        let (base, seen) = mock_provider(vec![
            json_reply(503, r#"{"error":{"message":"overloaded"}}"#),
            sse(OPENAI_OK),
        ])
        .await;
        let (result, _) = run(settings("openai_compatible", &base, "gpt-5.5")).await;
        assert_eq!(result.unwrap(), "Hello");
        assert_eq!(seen.lock().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn auth_errors_are_reported_with_the_provider_message() {
        let (base, seen) = mock_provider(vec![json_reply(
            401,
            r#"{"code":401,"message":"invalid api key"}"#,
        )])
        .await;
        let (result, _) = run(settings("openai_compatible", &base, "gpt-5.5")).await;
        let error = result.unwrap_err();
        assert!(error.contains("401"), "{error}");
        assert!(error.contains("invalid api key"), "{error}");
        assert_eq!(seen.lock().unwrap().len(), 1, "a 401 is not retried");
    }

    #[tokio::test]
    async fn stream_errors_after_a_200_are_surfaced() {
        let (base, _) = mock_provider(vec![sse(
            "data: {\"error\":{\"message\":\"upstream quota exceeded\",\"code\":\"quota\"}}\n\n",
        )])
        .await;
        let (result, _) = run(settings("openai_compatible", &base, "gpt-5.5")).await;
        let error = result.unwrap_err();
        assert!(error.contains("upstream quota exceeded"), "{error}");
    }

    #[tokio::test]
    async fn output_cut_off_by_length_is_marked() {
        let (base, _) = mock_provider(vec![sse(
            "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"},\"finish_reason\":\"length\"}]}\n\ndata: [DONE]\n\n",
        )])
        .await;
        let (result, streamed) = run(settings("openai_compatible", &base, "gpt-5.5")).await;
        let text = result.unwrap();
        assert!(text.starts_with("partial"));
        assert!(text.contains("output limit"), "{text}");
        assert_eq!(streamed, text);
    }

    const ANTHROPIC_OK: &str = "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{}}\n\nevent: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"hmm\"}}\n\nevent: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"text_delta\",\"text\":\"OK\"}}\n\nevent: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n";

    #[tokio::test]
    async fn anthropic_requests_leave_room_for_thinking_and_skip_sampling() {
        let (base, seen) = mock_provider(vec![sse(ANTHROPIC_OK)]).await;
        let (result, streamed) =
            run(settings("anthropic_compatible", &base, "claude-opus-5-5")).await;
        assert_eq!(
            result.unwrap(),
            "OK",
            "thinking deltas are not part of the answer"
        );
        assert_eq!(streamed, "OK");
        let seen = seen.lock().unwrap();
        assert_eq!(seen[0].0, "/v1/messages");
        assert_eq!(seen[0].1["max_tokens"], ANTHROPIC_MAX_TOKENS);
        assert!(seen[0].1.get("temperature").is_none());
        assert_eq!(seen[0].1["system"], "system");
    }

    #[tokio::test]
    async fn anthropic_max_tokens_steps_down_when_rejected() {
        let too_big = r#"{"type":"error","error":{"type":"invalid_request_error","message":"max_tokens: 32000 > 8192, which is the maximum allowed number of output tokens for claude-3-5-sonnet"}}"#;
        let (base, seen) = mock_provider(vec![
            json_reply(400, too_big),
            json_reply(400, too_big),
            sse(ANTHROPIC_OK),
        ])
        .await;
        let (result, _) = run(settings("anthropic_compatible", &base, "claude-3-5-sonnet")).await;
        assert_eq!(result.unwrap(), "OK");
        let sent: Vec<_> = seen
            .lock()
            .unwrap()
            .iter()
            .map(|(_, body)| body["max_tokens"].as_u64().unwrap())
            .collect();
        assert_eq!(sent, vec![32_000, 16_000, 8_192]);
    }

    #[tokio::test]
    async fn anthropic_refusal_is_an_error() {
        let (base, _) = mock_provider(vec![sse(
            "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"refusal\"}}\n\n",
        )])
        .await;
        let (result, _) = run(settings("anthropic_compatible", &base, "claude-fable-5-2")).await;
        assert!(result.unwrap_err().contains("refusal"));
    }

    #[tokio::test]
    async fn anthropic_thinking_only_budget_exhaustion_is_explained() {
        let (base, _) = mock_provider(vec![sse(
            "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"...\"}}\n\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"max_tokens\"}}\n\n",
        )])
        .await;
        let (result, _) = run(settings("anthropic_compatible", &base, "claude-fable-5-2")).await;
        assert!(result.unwrap_err().contains("output budget"));
    }

    #[tokio::test]
    async fn cancellation_stops_a_silent_provider_quickly() {
        // Accepts the connection but never answers.
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}/v1", listener.local_addr().unwrap());
        tokio::spawn(async move {
            let _held = listener.accept().await;
            tokio::time::sleep(Duration::from_secs(30)).await;
        });
        let started = std::time::Instant::now();
        let result = stream_chat_completion(
            settings("openai_compatible", &base, "gpt-5.5"),
            "test-key".into(),
            "system".into(),
            "question".into(),
            |_| {},
            move || started.elapsed() > Duration::from_millis(300),
        )
        .await;
        assert_eq!(result.unwrap_err(), CANCELLED);
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn sampling_params_are_skipped_for_reasoning_model_families() {
        for model in [
            "gpt-5",
            "gpt-5.5",
            "gpt-5-mini",
            "GPT-5.4",
            "openai/gpt-5.2",
            "gpt-6.2-sol",
            "o3",
            "o4-mini",
            "o1",
        ] {
            assert!(model_rejects_sampling_params(model), "{model}");
        }
        for model in [
            "gpt-4.1-mini",
            "gpt-4o",
            "deepseek-chat",
            "qwen3:8b",
            "gpt-oss:20b",
            "o1x",
        ] {
            assert!(!model_rejects_sampling_params(model), "{model}");
        }
    }

    #[test]
    fn error_bodies_are_summarised_from_common_shapes() {
        assert_eq!(
            describe_error_body(r#"{"error":{"message":"bad key","code":"invalid_api_key"}}"#),
            "invalid_api_key: bad key"
        );
        assert_eq!(
            describe_error_body(
                r#"{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#
            ),
            "overloaded_error: Overloaded"
        );
        assert_eq!(
            describe_error_body(r#"{"message":"quota exhausted"}"#),
            "quota exhausted"
        );
        assert_eq!(describe_error_body("<html>502</html>"), "<html>502</html>");
    }

    #[test]
    fn idle_timeout_never_drops_below_the_floor() {
        let mut s = AiProviderSettings {
            request_timeout_secs: 45,
            ..AiProviderSettings::default()
        };
        assert_eq!(idle_timeout_secs(&s), MIN_IDLE_TIMEOUT_SECS);
        s.request_timeout_secs = 300;
        assert_eq!(idle_timeout_secs(&s), 300);
    }
}
