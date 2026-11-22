use super::http::{
    append_response_sample, describe_error_body, looks_like_html, run_attempts, send_request,
    sse_data, stream_error_message, truncate_error_body, until_cancelled, AttemptError,
    ChatRequest, Protocol, RequestTuning, CANCELLED, TRUNCATED_NOTICE,
};
use futures_util::StreamExt;
use reqwest::header::CONTENT_TYPE;
use serde_json::{json, Value};

const ANTHROPIC_VERSION: &str = "2023-06-01";
// Room for the answer plus the thinking that current Claude models do by
// default. Stepped down when a gateway or an older model rejects the value.
pub(super) const ANTHROPIC_MAX_TOKENS: u32 = 32_000;

pub(super) async fn stream_anthropic_messages<F, S>(
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

pub(super) async fn stream_anthropic_messages_once<F, S>(
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
