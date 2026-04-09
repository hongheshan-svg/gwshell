
//! Parse token usage from AI API responses.
//!
//! Covers:
//! - Claude non-streaming JSON (anthropic format)
//! - Claude streaming SSE (`message_start` + `message_delta` events)
//! - OpenAI / Codex non-streaming JSON
//! - OpenAI streaming SSE (last chunk with `usage` if `stream_options.include_usage` was set)
//! - Gemini non-streaming JSON (`usageMetadata`)

use serde_json::Value;

#[derive(Debug, Default, Clone)]
pub struct TokenUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cache_read_tokens: u32,
    pub cache_creation_tokens: u32,
    pub model: Option<String>,
}

impl TokenUsage {
    pub fn total(&self) -> u64 {
        u64::from(
            self.input_tokens
                + self.output_tokens
                + self.cache_read_tokens
                + self.cache_creation_tokens,
        )
    }

    // ── Non-streaming parsers ────────────────────────────────────────────────

    /// Parse from a Claude (Anthropic) non-streaming response body.
    ///
    /// Expected shape:
    /// ```json
    /// { "model": "...", "usage": { "input_tokens": N, "output_tokens": N,
    ///   "cache_read_input_tokens": N, "cache_creation_input_tokens": N } }
    /// ```
    pub fn from_claude_response(body: &Value) -> Option<Self> {
        let usage = body.get("usage")?;
        Some(Self {
            input_tokens: usage
                .get("input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32,
            output_tokens: usage
                .get("output_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32,
            cache_read_tokens: usage
                .get("cache_read_input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32,
            cache_creation_tokens: usage
                .get("cache_creation_input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32,
            model: body
                .get("model")
                .and_then(|v| v.as_str())
                .map(str::to_string),
        })
    }

    /// Parse from an OpenAI / Codex / OpenAI-compatible non-streaming response.
    ///
    /// Expected shape:
    /// ```json
    /// { "model": "...", "usage": { "prompt_tokens": N, "completion_tokens": N } }
    /// ```
    pub fn from_openai_response(body: &Value) -> Option<Self> {
        let usage = body.get("usage")?;
        // Require at least one token field to be present
        let prompt = usage.get("prompt_tokens").and_then(|v| v.as_u64());
        let completion = usage.get("completion_tokens").and_then(|v| v.as_u64());
        if prompt.is_none() && completion.is_none() {
            return None;
        }
        Some(Self {
            input_tokens: prompt.unwrap_or(0) as u32,
            output_tokens: completion.unwrap_or(0) as u32,
            cache_read_tokens: 0,
            cache_creation_tokens: 0,
            model: body
                .get("model")
                .and_then(|v| v.as_str())
                .map(str::to_string),
        })
    }

    /// Parse from a Gemini non-streaming response.
    ///
    /// Expected shape:
    /// ```json
    /// { "usageMetadata": { "promptTokenCount": N, "candidatesTokenCount": N,
    ///   "cachedContentTokenCount": N } }
    /// ```
    pub fn from_gemini_response(body: &Value) -> Option<Self> {
        let meta = body.get("usageMetadata")?;
        let prompt = meta
            .get("promptTokenCount")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let candidates = meta
            .get("candidatesTokenCount")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        if prompt == 0 && candidates == 0 {
            return None;
        }
        Some(Self {
            input_tokens: prompt as u32,
            output_tokens: candidates as u32,
            cache_read_tokens: meta
                .get("cachedContentTokenCount")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32,
            cache_creation_tokens: 0,
            model: None, // Gemini model name is in the URL path, not the body
        })
    }

    // ── Streaming (SSE) parsers ──────────────────────────────────────────────

    /// Parse from accumulated SSE text for a Claude streaming response.
    ///
    /// Relevant events:
    /// - `message_start` → input / cache tokens
    /// - `message_delta` → output tokens
    pub fn from_claude_sse(sse_text: &str) -> Option<Self> {
        let mut result = Self::default();
        let mut found = false;

        for line in sse_text.lines() {
            let Some(data) = line.strip_prefix("data: ") else {
                continue;
            };
            if data.trim() == "[DONE]" {
                continue;
            }
            let Ok(event) = serde_json::from_str::<Value>(data) else {
                continue;
            };

            match event.get("type").and_then(|v| v.as_str()).unwrap_or("") {
                "message_start" => {
                    if let Some(usage) = event
                        .get("message")
                        .and_then(|m| m.get("usage"))
                    {
                        result.input_tokens = usage
                            .get("input_tokens")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0) as u32;
                        result.cache_read_tokens = usage
                            .get("cache_read_input_tokens")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0) as u32;
                        result.cache_creation_tokens = usage
                            .get("cache_creation_input_tokens")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0) as u32;
                    }
                    if let Some(model) = event
                        .get("message")
                        .and_then(|m| m.get("model"))
                        .and_then(|v| v.as_str())
                    {
                        result.model = Some(model.to_string());
                    }
                    found = true;
                }
                "message_delta" => {
                    if let Some(output) = event
                        .get("usage")
                        .and_then(|u| u.get("output_tokens"))
                        .and_then(|v| v.as_u64())
                    {
                        result.output_tokens = output as u32;
                        found = true;
                    }
                }
                _ => {}
            }
        }

        if found { Some(result) } else { None }
    }

    /// Parse from accumulated SSE text for an OpenAI streaming response.
    ///
    /// OpenAI only includes usage in SSE when the request contained
    /// `"stream_options": {"include_usage": true}`.  We scan every chunk
    /// for a non-null `usage` field and take the last one we find.
    pub fn from_openai_sse(sse_text: &str) -> Option<Self> {
        let mut result = Self::default();
        let mut found = false;

        for line in sse_text.lines() {
            let Some(data) = line.strip_prefix("data: ") else {
                continue;
            };
            if data.trim() == "[DONE]" {
                continue;
            }
            let Ok(event) = serde_json::from_str::<Value>(data) else {
                continue;
            };
            if let Some(usage) = event.get("usage") {
                if let Some(prompt) = usage.get("prompt_tokens").and_then(|v| v.as_u64()) {
                    result.input_tokens = prompt as u32;
                    result.output_tokens = usage
                        .get("completion_tokens")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0) as u32;
                    if let Some(model) =
                        event.get("model").and_then(|v| v.as_str())
                    {
                        result.model = Some(model.to_string());
                    }
                    found = true;
                }
            }
        }

        if found { Some(result) } else { None }
    }
}

// ── Dispatch helper ────────────────────────────────────────────────────────────

/// Try to extract usage from a buffered (non-streaming) response body.
/// `app` is `"claude"`, `"codex"`, `"gemini"`, etc.
pub fn parse_body_usage(body_bytes: &[u8], app: &str) -> Option<TokenUsage> {
    let value: Value = serde_json::from_slice(body_bytes).ok()?;
    match app {
        "claude" => TokenUsage::from_claude_response(&value),
        "gemini" => TokenUsage::from_gemini_response(&value),
        _ => TokenUsage::from_openai_response(&value),
    }
}

/// Try to extract usage from accumulated SSE text.
/// `app` is `"claude"`, `"codex"`, `"gemini"`, etc.
pub fn parse_sse_usage(sse_text: &str, app: &str) -> Option<TokenUsage> {
    match app {
        "claude" => TokenUsage::from_claude_sse(sse_text),
        _ => TokenUsage::from_openai_sse(sse_text),
    }
}
