mod anthropic;
mod http;
mod openai;
mod storage;

use super::types::{AiProviderSettings, ChatMessage};
use http::{
    build_client, effective_max_input_chars, trim_conversation_messages, truncate_error_body,
    ChatRequest,
};

pub use storage::{clear_api_key, load_api_key, load_settings, save_settings, set_api_key};

pub async fn list_provider_models(
    settings: AiProviderSettings,
    api_key: String,
) -> Result<Vec<String>, String> {
    if !matches!(
        settings.provider.as_str(),
        "openai_compatible" | "anthropic_compatible" | "ollama"
    ) {
        return Err(format!("Unsupported AI provider: {}", settings.provider));
    }
    if settings.base_url.trim().is_empty() {
        return Err("AI provider base URL is required".into());
    }
    if provider_requires_api_key(&settings) && api_key.trim().is_empty() {
        return Err("AI API key is not configured".into());
    }
    let client = build_client(&settings)?;
    if settings.provider == "anthropic_compatible" {
        anthropic::list_anthropic_models(&client, &settings.base_url, api_key.trim()).await
    } else {
        openai::list_openai_models(
            &client,
            &settings.base_url,
            api_key.trim(),
            settings.provider == "ollama",
        )
        .await
    }
}

pub struct ChatCompletionOutcome {
    pub text: String,
    pub response_model: Option<String>,
}

pub async fn test_provider_connectivity(
    settings: AiProviderSettings,
    api_key: String,
) -> Result<String, String> {
    let started = std::time::Instant::now();
    let requested_model = settings.model.trim().to_string();
    let mut preview = String::new();
    let outcome = stream_chat_messages_with_meta(
        settings,
        api_key,
        "You are a connectivity probe. Reply with a short OK response.".to_string(),
        vec![ChatMessage {
            role: "user".to_string(),
            content: "Return only: OK".to_string(),
        }],
        |delta| preview.push_str(delta),
        |_| {},
        || false,
    )
    .await?;

    let elapsed_ms = started.elapsed().as_millis();
    let model_note = match outcome.response_model.as_deref() {
        Some(actual) if actual != requested_model => {
            format!("{} → {}", requested_model, actual)
        }
        _ => requested_model,
    };
    Ok(format!(
        "AI provider responded: {} ({} ms){}",
        model_note,
        elapsed_ms,
        if preview.trim().is_empty() {
            String::new()
        } else {
            format!(" — {}", truncate_error_body(preview.trim(), 80))
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
    S: Fn() -> bool + Send + Sync,
{
    stream_chat_messages_with_meta(
        settings,
        api_key,
        system_prompt,
        vec![ChatMessage {
            role: "user".to_string(),
            content: user_prompt,
        }],
        on_delta,
        |_| {},
        should_stop,
    )
    .await
    .map(|o| o.text)
}

pub async fn stream_chat_messages_with_meta<F, T, S>(
    settings: AiProviderSettings,
    api_key: String,
    system_prompt: String,
    messages: Vec<ChatMessage>,
    mut on_delta: F,
    mut on_thinking: T,
    should_stop: S,
) -> Result<ChatCompletionOutcome, String>
where
    F: FnMut(&str) + Send,
    T: FnMut(&str) + Send,
    S: Fn() -> bool + Send + Sync,
{
    validate_provider_settings(&settings)?;
    if provider_requires_api_key(&settings) && api_key.trim().is_empty() {
        return Err("AI API key is not configured".into());
    }

    let trimmed_messages =
        trim_conversation_messages(messages, effective_max_input_chars(&settings));
    if trimmed_messages.is_empty() {
        return Err("Message content is required".into());
    }

    let client = build_client(&settings)?;
    let request = ChatRequest {
        settings: &settings,
        api_key: api_key.trim(),
        system_prompt: &system_prompt,
        messages: trimmed_messages,
        response_model: std::sync::Mutex::new(None),
    };

    let text = if settings.provider == "anthropic_compatible" {
        anthropic::stream_anthropic_messages(
            &client,
            &request,
            &mut on_delta,
            &mut on_thinking,
            &should_stop,
        )
        .await?
    } else {
        openai::stream_openai_chat_completion(
            &client,
            &request,
            &mut on_delta,
            &mut on_thinking,
            &should_stop,
        )
        .await?
    };

    let response_model = request.take_response_model();
    #[cfg(debug_assertions)]
    eprintln!(
        "[gwshell-ai] DONE requested_model={} response_model={}",
        settings.model.trim(),
        response_model.as_deref().unwrap_or("<none>")
    );

    Ok(ChatCompletionOutcome {
        text,
        response_model,
    })
}

pub(crate) fn validate_provider_settings(settings: &AiProviderSettings) -> Result<(), String> {
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

#[cfg(test)]
mod sse_tests {
    use super::anthropic::{
        messages_url, parse_anthropic_json_error, parse_anthropic_json_text,
        parse_anthropic_sse_text_delta,
    };
    use super::http::{looks_like_html, truncate_middle};
    use super::openai::{
        chat_completions_url, chat_completions_urls, is_retryable_openai_endpoint_error,
        parse_openai_json_text, parse_openai_sse_line_text_delta, parse_openai_sse_text_delta,
    };

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
    fn parses_anthropic_non_streaming_json_response() {
        let raw =
            r#"{"id":"msg_1","type":"message","content":[{"type":"text","text":"你好世界"}]}"#;
        assert_eq!(parse_anthropic_json_text(raw).as_deref(), Some("你好世界"));
        assert!(parse_anthropic_json_error(raw).is_none());

        let err_raw =
            r#"{"type":"error","error":{"type":"invalid_request_error","message":"bad model"}}"#;
        assert!(parse_anthropic_json_error(err_raw)
            .unwrap_or_default()
            .contains("bad model"));
    }

    #[test]
    fn byte_buffered_sse_reassembles_split_multibyte_utf8() {
        let full = "data: {\"choices\":[{\"delta\":{\"content\":\"中文测试\"}}]}\n".as_bytes();
        let split_at = full.iter().position(|&b| b == 0xE4).unwrap() + 1;
        let mut pending: Vec<u8> = Vec::new();
        let mut collected = String::new();

        for chunk in [&full[..split_at], &full[split_at..]] {
            pending.extend_from_slice(chunk);
            while let Some(line_end) = pending.iter().position(|&b| b == b'\n') {
                let line_bytes: Vec<u8> = pending.drain(..=line_end).collect();
                let line = String::from_utf8_lossy(&line_bytes);
                if let Some(delta) = parse_openai_sse_line_text_delta(&line) {
                    collected.push_str(&delta);
                }
            }
        }
        assert_eq!(collected, "中文测试");
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
    use super::anthropic::ANTHROPIC_MAX_TOKENS;
    use super::http::{describe_error_body, idle_timeout_secs, CANCELLED, MIN_IDLE_TIMEOUT_SECS};
    use super::openai::model_rejects_sampling_params;
    use super::*;
    use serde_json::Value;
    use std::sync::{Arc, Mutex as StdMutex};
    use std::time::Duration;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

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
