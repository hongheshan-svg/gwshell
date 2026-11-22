use super::http::{
    append_response_sample, describe_error_body, looks_like_html, run_attempts, send_request,
    sse_data, stream_error_message, truncate_error_body, until_cancelled, AttemptError,
    ChatRequest, Protocol, RequestTuning, CANCELLED, TRUNCATED_NOTICE,
};
use super::openai::{extract_model_ids_from_json, is_retryable_openai_endpoint_error};
use crate::agent::types::ChatMessage;
use futures_util::StreamExt;
use reqwest::header::CONTENT_TYPE;
use serde_json::{json, Value};

const ANTHROPIC_VERSION: &str = "2023-06-01";
// Room for the answer plus the thinking that current Claude models do by
// default. Stepped down (16000 -> 8192 -> 4096) when a gateway or older model
// rejects the value.
pub(super) const ANTHROPIC_MAX_TOKENS: u32 = 32_000;

pub(super) async fn stream_anthropic_messages<F, T, S>(
    client: &reqwest::Client,
    request: &ChatRequest<'_>,
    on_delta: &mut F,
    on_thinking: &mut T,
    should_stop: &S,
) -> Result<String, String>
where
    F: FnMut(&str) + Send,
    T: FnMut(&str) + Send,
    S: Fn() -> bool + Send + Sync,
{
    let urls = messages_urls(&request.settings.base_url)?;
    let initial = RequestTuning {
        // Never sent: current Claude models reject sampling parameters.
        send_temperature: false,
        max_tokens: ANTHROPIC_MAX_TOKENS,
    };
    let mut last_retryable_error = None;
    for (index, url) in urls.iter().enumerate() {
        let result = run_attempts(
            client,
            request,
            url,
            Protocol::Anthropic,
            initial,
            on_delta,
            on_thinking,
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
    Err(last_retryable_error
        .unwrap_or_else(|| "AI provider did not return a usable Anthropic response".to_string()))
}

fn normalize_anthropic_messages(messages: &[ChatMessage]) -> Vec<Value> {
    let mut merged: Vec<(String, String)> = Vec::new();
    for msg in messages {
        let role = if msg.role == "assistant" {
            "assistant"
        } else {
            "user"
        };
        if msg.content.trim().is_empty() {
            continue;
        }
        if let Some(last) = merged.last_mut() {
            if last.0 == role {
                last.1.push_str("\n\n");
                last.1.push_str(&msg.content);
                continue;
            }
        }
        merged.push((role.to_string(), msg.content.clone()));
    }
    // Anthropic requires the first message to have role "user".
    while merged.first().is_some_and(|(role, _)| role != "user") {
        merged.remove(0);
    }
    merged
        .into_iter()
        .map(|(role, content)| json!({ "role": role, "content": content }))
        .collect()
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn stream_anthropic_messages_once<F, T, S>(
    client: &reqwest::Client,
    url: &str,
    request: &ChatRequest<'_>,
    tuning: RequestTuning,
    on_delta: &mut F,
    on_thinking: &mut T,
    should_stop: &S,
) -> Result<String, AttemptError>
where
    F: FnMut(&str) + Send,
    T: FnMut(&str) + Send,
    S: Fn() -> bool + Send + Sync,
{
    let normalized_messages = normalize_anthropic_messages(&request.messages);
    let body = json!({
        "model": request.settings.model.trim(),
        "max_tokens": tuning.max_tokens,
        "stream": true,
        "system": request.system_prompt,
        "messages": normalized_messages
    });

    #[cfg(debug_assertions)]
    eprintln!(
        "[gwshell-ai] POST {} model={} max_tokens={}",
        url,
        request.settings.model.trim(),
        tuning.max_tokens
    );

    let mut builder = client
        .post(url)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .json(&body);
    if !request.api_key.is_empty() {
        builder = builder.header("x-api-key", request.api_key);
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
            "AI provider returned HTML at {}. Check Base URL and Anthropic Messages API compatibility. Body: {}",
            url,
            truncate_error_body(&body, 300)
        )));
    }

    let mut full_text = String::new();
    let mut pending: Vec<u8> = Vec::new();
    let mut raw_response = String::new();
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
        pending.extend_from_slice(&chunk);

        while let Some(line_end) = pending.iter().position(|&b| b == b'\n') {
            let line_bytes: Vec<u8> = pending.drain(..=line_end).collect();
            let line = String::from_utf8_lossy(&line_bytes);
            append_response_sample(&mut raw_response, &line);
            if let Some(error) = parse_anthropic_sse_line_error(&line) {
                return Err(AttemptError::new(error).streamed(!full_text.is_empty()));
            }
            if let Some(reason) = parse_anthropic_sse_line_stop_reason(&line) {
                stop_reason = Some(reason);
            }
            if let Some(model) = parse_anthropic_sse_line_model(&line) {
                request.record_response_model(&model);
            }
            if let Some(thinking) = parse_anthropic_sse_line_thinking_delta(&line) {
                if should_stop() {
                    return Err(AttemptError::new(CANCELLED).streamed(!full_text.is_empty()));
                }
                on_thinking(&thinking);
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

    if !pending.is_empty() {
        let tail = String::from_utf8_lossy(&pending);
        append_response_sample(&mut raw_response, &tail);
        if !tail.trim().is_empty() {
            if let Some(error) = parse_anthropic_sse_line_error(&tail) {
                return Err(AttemptError::new(error).streamed(!full_text.is_empty()));
            }
            if let Some(reason) = parse_anthropic_sse_line_stop_reason(&tail) {
                stop_reason = Some(reason);
            }
            if let Some(model) = parse_anthropic_sse_line_model(&tail) {
                request.record_response_model(&model);
            }
            for delta in parse_anthropic_sse_text_delta(&tail) {
                on_delta(&delta);
                full_text.push_str(&delta);
            }
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
        if let Some(error) = parse_anthropic_json_error(&raw_response) {
            return Err(AttemptError::new(error));
        }
        if let Some(text) = parse_anthropic_json_text(&raw_response) {
            if let Ok(value) = serde_json::from_str::<Value>(raw_response.trim()) {
                if let Some(model) = value
                    .get("model")
                    .or_else(|| value.get("message").and_then(|m| m.get("model")))
                    .and_then(|v| v.as_str())
                {
                    request.record_response_model(model);
                }
            }
            on_delta(&text);
            return Ok(text);
        }
        if looks_like_html(&raw_response) {
            return Err(AttemptError::new(format!(
                "AI provider returned HTML at {}. Check Base URL and Anthropic Messages API compatibility. Body: {}",
                url,
                truncate_error_body(&raw_response, 300)
            )));
        }
        return Err(AttemptError::new(format!(
            "AI provider returned an empty response at {}. Check the model name and that the endpoint speaks the Anthropic Messages API. Body: {}",
            url,
            truncate_error_body(&raw_response, 300)
        )));
    }
    Ok(full_text)
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

pub fn messages_urls(base_url: &str) -> Result<Vec<String>, String> {
    let base_url = base_url.trim().trim_end_matches('/');
    let primary = messages_url(base_url)?;
    if base_url.ends_with("/messages") {
        return Ok(vec![primary]);
    }
    let mut urls = vec![primary];
    let lower = base_url.to_ascii_lowercase();
    if !lower.ends_with("/v1") && !lower.contains("/v1/") {
        let v1_url = format!("{}/v1/messages", base_url);
        if !urls.contains(&v1_url) {
            urls.push(v1_url);
        }
    }
    Ok(urls)
}

pub(super) async fn list_anthropic_models(
    client: &reqwest::Client,
    base_url: &str,
    api_key: &str,
) -> Result<Vec<String>, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("AI provider base URL is required".into());
    }
    let base = trimmed
        .strip_suffix("/messages")
        .unwrap_or(trimmed)
        .trim_end_matches('/');
    let mut candidates = vec![format!("{}/models", base)];
    let lower = base.to_ascii_lowercase();
    if !lower.ends_with("/v1") && !lower.contains("/v1/") {
        candidates.push(format!("{}/v1/models", base));
    }

    let mut last_err = String::new();
    for url in candidates {
        let mut req = client
            .get(&url)
            .header("anthropic-version", ANTHROPIC_VERSION);
        if !api_key.is_empty() {
            req = req.header("x-api-key", api_key);
        }
        match req.send().await {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(text) = resp.text().await {
                    if let Ok(json) = serde_json::from_str::<Value>(&text) {
                        if let Some(models) = extract_model_ids_from_json(&json) {
                            return Ok(models);
                        }
                    }
                }
            }
            Ok(resp) => {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                last_err = format!("{} ({}): {}", url, status, describe_error_body(&body));
            }
            Err(e) => {
                last_err = format!("{} failed: {}", url, e);
            }
        }
    }
    Err(if last_err.is_empty() {
        "Failed to list models from Anthropic provider".to_string()
    } else {
        last_err
    })
}

fn parse_anthropic_sse_line_model(line: &str) -> Option<String> {
    let data = sse_data(line)?;
    let json = serde_json::from_str::<Value>(data).ok()?;
    json.get("message")
        .and_then(|m| m.get("model"))
        .or_else(|| json.get("model"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(ToString::to_string)
}

fn parse_anthropic_sse_line_thinking_delta(line: &str) -> Option<String> {
    let data = sse_data(line)?;
    let json = serde_json::from_str::<Value>(data).ok()?;
    if json.get("type").and_then(|v| v.as_str()) != Some("content_block_delta") {
        return None;
    }
    let delta = json.get("delta")?;
    if delta.get("type").and_then(|v| v.as_str()) != Some("thinking_delta") {
        return None;
    }
    delta
        .get("thinking")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
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

pub(super) fn parse_anthropic_json_text(raw: &str) -> Option<String> {
    let json = serde_json::from_str::<serde_json::Value>(raw.trim()).ok()?;
    let blocks = json.get("content")?.as_array()?;
    let text = blocks
        .iter()
        .filter(|b| b.get("type").and_then(|v| v.as_str()) == Some("text"))
        .filter_map(|b| b.get("text").and_then(|v| v.as_str()))
        .collect::<Vec<_>>()
        .join("");
    (!text.trim().is_empty()).then_some(text)
}

pub(super) fn parse_anthropic_json_error(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    let json = serde_json::from_str::<serde_json::Value>(trimmed).ok()?;
    if json.get("type").and_then(|v| v.as_str()) != Some("error") && json.get("error").is_none() {
        return None;
    }
    let message = describe_error_body(trimmed);
    if message.trim().is_empty() {
        None
    } else {
        Some(format!("AI provider request failed: {}", message))
    }
}
