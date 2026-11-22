use super::http::{
    append_response_sample, describe_error_body, looks_like_html, run_attempts, send_request,
    sse_data, stream_error_message, truncate_error_body, until_cancelled, AttemptError,
    ChatRequest, Protocol, RequestTuning, CANCELLED, TRUNCATED_NOTICE,
};
use futures_util::StreamExt;
use reqwest::header::CONTENT_TYPE;
use serde_json::{json, Value};

pub(super) async fn stream_openai_chat_completion<F, S>(
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

pub(super) async fn stream_openai_chat_completion_url<F, S>(
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
    // Buffer raw bytes until `\n` so multi-byte UTF-8 characters (e.g. CJK)
    // split across TCP packet boundaries are decoded intact instead of U+FFFD.
    let mut pending: Vec<u8> = Vec::new();
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
        pending.extend_from_slice(&chunk);

        while let Some(line_end) = pending.iter().position(|&b| b == b'\n') {
            let line_bytes: Vec<u8> = pending.drain(..=line_end).collect();
            let line = String::from_utf8_lossy(&line_bytes);
            append_response_sample(&mut raw_response, &line);
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

    if !pending.is_empty() {
        let tail = String::from_utf8_lossy(&pending);
        append_response_sample(&mut raw_response, &tail);
        if !tail.trim().is_empty() {
            if let Some(error) = parse_openai_sse_line_error(&tail) {
                return Err(AttemptError::new(error).streamed(!full_text.is_empty()));
            }
            for delta in parse_openai_sse_text_delta(&tail) {
                on_delta(&delta);
                full_text.push_str(&delta);
            }
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

/// GPT-5 family, GPT-6, and the o-series reasoning models reject
/// `temperature` (only the default is accepted), so it isn't sent to them.
/// Gateways may prefix the model with a vendor (`openai/gpt-5.4`).
pub(super) fn model_rejects_sampling_params(model: &str) -> bool {
    let model = model.trim().to_ascii_lowercase();
    let name = model.rsplit('/').next().unwrap_or(&model);
    ["gpt-5", "gpt-6", "o1", "o3", "o4"].iter().any(|family| {
        name == *family
            || name.starts_with(&format!("{}-", family))
            || name.starts_with(&format!("{}.", family))
    })
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

pub fn parse_openai_sse_text_delta(chunk: &str) -> Vec<String> {
    let mut deltas = Vec::new();
    for line in chunk.lines() {
        if let Some(delta) = parse_openai_sse_line_text_delta(line) {
            deltas.push(delta);
        }
    }
    deltas
}

fn should_try_v1_chat_completions(base_url: &str) -> bool {
    let without_scheme = base_url
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(base_url);
    !without_scheme.contains('/')
}

pub(super) fn is_retryable_openai_endpoint_error(error: &str) -> bool {
    error.contains("returned HTML")
        || error.contains("empty or unsupported response")
        || error.contains("(404")
        || error.contains("(405")
}

pub(super) fn parse_openai_sse_line_text_delta(line: &str) -> Option<String> {
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

pub(super) fn parse_openai_json_text(raw: &str) -> Option<String> {
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
