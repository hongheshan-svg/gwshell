use super::types::AiProviderSettings;
use crate::{crypto, database::Database};
use futures_util::StreamExt;
use reqwest::header::CONTENT_TYPE;
use serde_json::{json, Value};
use std::time::Duration;

const SETTINGS_KEY: &str = "agent_ai_provider_settings";
const SECRET_KEY: &str = "agent_ai_provider_api_key";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const ANTHROPIC_MAX_TOKENS: u32 = 4096;
const RAW_RESPONSE_SAMPLE_LIMIT: usize = 4096;

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
    let decrypted = crypto::decrypt_secret(&stored);
    if decrypted.trim().is_empty() {
        Ok(None)
    } else {
        Ok(Some(decrypted))
    }
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
    on_delta: F,
    should_stop: S,
) -> Result<String, String>
where
    F: FnMut(&str) + Send,
    S: Fn() -> bool + Send,
{
    validate_provider_settings(&settings)?;
    if provider_requires_api_key(&settings) && api_key.trim().is_empty() {
        return Err("AI API key is not configured".into());
    }

    if settings.provider == "anthropic_compatible" {
        return stream_anthropic_messages(
            settings,
            api_key,
            system_prompt,
            user_prompt,
            on_delta,
            should_stop,
        )
        .await;
    }

    stream_openai_chat_completion(
        settings,
        api_key,
        system_prompt,
        user_prompt,
        on_delta,
        should_stop,
    )
    .await
}

async fn stream_openai_chat_completion<F, S>(
    settings: AiProviderSettings,
    api_key: String,
    system_prompt: String,
    user_prompt: String,
    mut on_delta: F,
    should_stop: S,
) -> Result<String, String>
where
    F: FnMut(&str) + Send,
    S: Fn() -> bool + Send,
{
    let timeout_secs = settings.request_timeout_secs.max(1);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| format!("AI client setup failed: {}", e))?;
    let urls = chat_completions_urls(&settings.base_url)?;
    let mut last_retryable_error = None;

    for (index, url) in urls.iter().enumerate() {
        match stream_openai_chat_completion_url(
            &client,
            url,
            &settings,
            &api_key,
            &system_prompt,
            &user_prompt,
            &mut on_delta,
            &should_stop,
        )
        .await
        {
            Ok(full_text) => return Ok(full_text),
            Err(error) if index + 1 < urls.len() && is_retryable_openai_endpoint_error(&error) => {
                last_retryable_error = Some(error);
            }
            Err(error) => return Err(error),
        }
    }

    Err(last_retryable_error.unwrap_or_else(|| {
        "AI provider did not return a usable chat completion response".to_string()
    }))
}

async fn stream_openai_chat_completion_url<F, S>(
    client: &reqwest::Client,
    url: &str,
    settings: &AiProviderSettings,
    api_key: &str,
    system_prompt: &str,
    user_prompt: &str,
    on_delta: &mut F,
    should_stop: &S,
) -> Result<String, String>
where
    F: FnMut(&str) + Send,
    S: Fn() -> bool + Send,
{
    let request_body = json!({
        "model": settings.model.trim(),
        "temperature": settings.temperature,
        "stream": true,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": truncate_middle(&user_prompt, effective_max_input_chars(&settings)) }
        ]
    });

    let mut request = client.post(url).json(&request_body);
    if !api_key.trim().is_empty() {
        request = request.bearer_auth(api_key.trim());
    }
    let response = request
        .send()
        .await
        .map_err(|e| format!("AI provider request failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "AI provider request failed ({}) at {}: {}",
            status,
            url,
            truncate_error_body(&body, 500)
        ));
    }

    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if content_type.contains("text/html") {
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "AI provider returned HTML at {}. Check Base URL; this endpoint may need /v1. Body: {}",
            url,
            truncate_error_body(&body, 300)
        ));
    }

    let mut full_text = String::new();
    let mut pending = String::new();
    let mut raw_response = String::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if should_stop() {
            return Err("AI analysis cancelled".into());
        }
        let chunk = chunk.map_err(|e| format!("AI provider stream failed: {}", e))?;
        let chunk_text = String::from_utf8_lossy(&chunk);
        append_response_sample(&mut raw_response, &chunk_text);
        pending.push_str(&chunk_text);

        while let Some(line_end) = pending.find('\n') {
            let line: String = pending.drain(..=line_end).collect();
            if let Some(delta) = parse_openai_sse_line_text_delta(&line) {
                if should_stop() {
                    return Err("AI analysis cancelled".into());
                }
                on_delta(&delta);
                full_text.push_str(&delta);
            }
        }
    }

    if !pending.trim().is_empty() {
        for delta in parse_openai_sse_text_delta(&pending) {
            on_delta(&delta);
            full_text.push_str(&delta);
        }
    }

    if full_text.trim().is_empty() {
        if let Some(error) = parse_openai_response_error(&raw_response) {
            return Err(error);
        }
        if let Some(text) = parse_openai_json_text(&raw_response) {
            on_delta(&text);
            return Ok(text);
        }
        if looks_like_html(&raw_response) {
            return Err(format!(
                "AI provider returned HTML at {}. Check Base URL; this endpoint may need /v1. Body: {}",
                url,
                truncate_error_body(&raw_response, 300)
            ));
        }
        return Err(format!(
            "AI provider returned an empty or unsupported response at {}. Check Base URL, model, and streaming compatibility. Body: {}",
            url,
            truncate_error_body(&raw_response, 300)
        ));
    }

    Ok(full_text)
}

async fn stream_anthropic_messages<F, S>(
    settings: AiProviderSettings,
    api_key: String,
    system_prompt: String,
    user_prompt: String,
    mut on_delta: F,
    should_stop: S,
) -> Result<String, String>
where
    F: FnMut(&str) + Send,
    S: Fn() -> bool + Send,
{
    let timeout_secs = settings.request_timeout_secs.max(1);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| format!("AI client setup failed: {}", e))?;
    let url = messages_url(&settings.base_url)?;
    let request_body = json!({
        "model": settings.model.trim(),
        "max_tokens": ANTHROPIC_MAX_TOKENS,
        "stream": true,
        "system": system_prompt,
        "messages": [
            { "role": "user", "content": truncate_middle(&user_prompt, effective_max_input_chars(&settings)) }
        ]
    });

    let mut request = client
        .post(url)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .json(&request_body);
    if !api_key.trim().is_empty() {
        request = request.header("x-api-key", api_key.trim());
    }
    let response = request
        .send()
        .await
        .map_err(|e| format!("AI provider request failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "AI provider request failed ({}): {}",
            status,
            truncate_error_body(&body, 500)
        ));
    }

    let mut full_text = String::new();
    let mut pending = String::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if should_stop() {
            return Err("AI analysis cancelled".into());
        }
        let chunk = chunk.map_err(|e| format!("AI provider stream failed: {}", e))?;
        pending.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(line_end) = pending.find('\n') {
            let line: String = pending.drain(..=line_end).collect();
            if let Some(error) = parse_anthropic_sse_line_error(&line) {
                return Err(error);
            }
            if let Some(delta) = parse_anthropic_sse_line_text_delta(&line) {
                if should_stop() {
                    return Err("AI analysis cancelled".into());
                }
                on_delta(&delta);
                full_text.push_str(&delta);
            }
        }
    }

    if !pending.trim().is_empty() {
        if let Some(error) = parse_anthropic_sse_line_error(&pending) {
            return Err(error);
        }
        for delta in parse_anthropic_sse_text_delta(&pending) {
            on_delta(&delta);
            full_text.push_str(&delta);
        }
    }

    Ok(full_text)
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
    let error = json.get("error")?;
    let message = error
        .as_str()
        .or_else(|| error.get("message").and_then(|v| v.as_str()))
        .or_else(|| error.get("msg").and_then(|v| v.as_str()))
        .unwrap_or("OpenAI-compatible provider returned an error");
    Some(format!("AI provider returned an error: {}", message))
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
    let message = json
        .get("error")
        .and_then(|v| v.get("message"))
        .and_then(|v| v.as_str())
        .unwrap_or("Anthropic provider stream returned an error");
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
fn encrypt_api_key(api_key: &str) -> String {
    crypto::encrypt_secret(api_key)
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
        assert_eq!(load_api_key(&db).unwrap(), None);
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
