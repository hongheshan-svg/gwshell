//! Local reverse proxy server for AI platform.
//!
//! Listens on a configurable host:port and routes requests to the active
//! provider for each app:
//!
//!   /claude/{*rest}   → active Claude provider  (x-api-key auth)
//!   /codex/{*rest}    → active Codex provider   (Bearer auth)
//!   /gemini/{*rest}   → active Gemini provider  (Bearer auth)
//!   /opencode/{*rest} → active OpenCode provider (Bearer auth)
//!   /openclaw/{*rest} → active OpenClaw provider (Bearer auth)
//!   /_health          → proxy liveness

pub mod usage_parser;

use crate::ai_platform::domain::provider::{ActiveProviderSet, ProviderRecord};
use crate::ai_platform::domain::usage::UsageRecord;
use crate::ai_platform::infrastructure::db::providers_db::load_or_initialize_store;
use crate::ai_platform::infrastructure::fs::usage_store::{load_or_initialize_store as load_usage_store, save_store as save_usage_store};
use axum::{
    body::Body,
    extract::{Path, State},
    http::{HeaderMap, HeaderName, HeaderValue, Request, StatusCode},
    response::Response,
    routing::any,
    Router,
};
use bytes::Bytes;
use futures_util::StreamExt;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

// ── Public handle ─────────────────────────────────────────────────────────────

pub struct ProxyHandle {
    pub host: String,
    pub port: u16,
    stop_tx: Option<oneshot::Sender<()>>,
}

impl ProxyHandle {
    pub fn stop(&mut self) {
        if let Some(tx) = self.stop_tx.take() {
            let _ = tx.send(());
        }
    }
    pub fn is_running(&self) -> bool {
        self.stop_tx.is_some()
    }
}

// ── Usage tracking context ────────────────────────────────────────────────────

#[derive(Clone)]
struct UsageContext {
    app: String,
    provider_id: String,
}

/// Append a usage record to the JSON store (runs in a blocking context).
fn persist_usage_blocking(ctx: &UsageContext, usage: usage_parser::TokenUsage) {
    let mut loaded = match load_usage_store() {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[ai-proxy] usage store load error: {e}");
            return;
        }
    };
    let model = usage
        .model
        .clone()
        .unwrap_or_else(|| "unknown".to_string());
    let total = usage.total();
    let record = UsageRecord {
        id: new_record_id(),
        timestamp: epoch_ms(),
        provider: ctx.provider_id.clone(),
        model,
        tool: ctx.app.clone(),
        input_tokens: u64::from(usage.input_tokens),
        output_tokens: u64::from(usage.output_tokens),
        total_tokens: total,
        cost: 0.0, // cost calculation requires pricing table; left for UI layer
        currency: "USD".to_string(),
    };
    loaded.store.records.push(record);
    if let Err(e) = save_usage_store(&loaded.store) {
        eprintln!("[ai-proxy] usage store save error: {e}");
    }
}

fn new_record_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("prx-{ms:x}")
}

fn epoch_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ── Axum shared state ─────────────────────────────────────────────────────────

#[derive(Clone)]
struct SharedState {
    client: reqwest::Client,
    log_requests: bool,
}

// ── Start ─────────────────────────────────────────────────────────────────────

pub async fn start(
    host: &str,
    port: u16,
    connect_timeout_secs: u32,
    request_timeout_secs: u32,
    log_requests: bool,
) -> Result<ProxyHandle, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(request_timeout_secs as u64))
        .connect_timeout(Duration::from_secs(connect_timeout_secs as u64))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("Build HTTP client: {e}"))?;

    let shared = Arc::new(SharedState { client, log_requests });

    let router = Router::new()
        .route("/claude/{*rest}", any(handle_claude))
        .route("/codex/{*rest}", any(handle_codex))
        .route("/gemini/{*rest}", any(handle_gemini))
        .route("/opencode/{*rest}", any(handle_opencode))
        .route("/openclaw/{*rest}", any(handle_openclaw))
        .route("/_health", any(handle_health))
        .with_state(shared);

    let addr = format!("{host}:{port}");
    let listener = TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("Bind {addr}: {e}"))?;

    let (stop_tx, stop_rx) = oneshot::channel::<()>();

    tokio::spawn(async move {
        axum::serve(listener, router)
            .with_graceful_shutdown(async {
                let _ = stop_rx.await;
            })
            .await
            .ok();
    });

    Ok(ProxyHandle {
        host: host.to_string(),
        port,
        stop_tx: Some(stop_tx),
    })
}

// ── App handlers ──────────────────────────────────────────────────────────────

async fn handle_claude(
    State(s): State<Arc<SharedState>>,
    Path(rest): Path<String>,
    req: Request<Body>,
) -> Response {
    proxy_request("claude", &rest, req, &s).await
}
async fn handle_codex(
    State(s): State<Arc<SharedState>>,
    Path(rest): Path<String>,
    req: Request<Body>,
) -> Response {
    proxy_request("codex", &rest, req, &s).await
}
async fn handle_gemini(
    State(s): State<Arc<SharedState>>,
    Path(rest): Path<String>,
    req: Request<Body>,
) -> Response {
    proxy_request("gemini", &rest, req, &s).await
}
async fn handle_opencode(
    State(s): State<Arc<SharedState>>,
    Path(rest): Path<String>,
    req: Request<Body>,
) -> Response {
    proxy_request("opencode", &rest, req, &s).await
}
async fn handle_openclaw(
    State(s): State<Arc<SharedState>>,
    Path(rest): Path<String>,
    req: Request<Body>,
) -> Response {
    proxy_request("openclaw", &rest, req, &s).await
}
async fn handle_health() -> &'static str {
    "ok"
}

// ── Core proxy logic ──────────────────────────────────────────────────────────

async fn proxy_request(
    app: &str,
    rest: &str,
    req: Request<Body>,
    state: &Arc<SharedState>,
) -> Response {
    // Load providers (spawn_blocking because rusqlite is synchronous)
    let app_owned = app.to_string();
    let providers_result = tokio::task::spawn_blocking(move || {
        load_or_initialize_store().map(|loaded| {
            let active_id =
                active_id_for_app(&loaded.store.active, &app_owned).map(str::to_string);
            let mut candidates: Vec<ProviderRecord> = loaded
                .store
                .providers
                .into_iter()
                .filter(|p| p.enabled && p.supports_app(&app_owned))
                .collect();
            // Active provider first, then ascending priority
            candidates.sort_by(|a, b| {
                let a_active = active_id.as_deref() == Some(a.id.as_str());
                let b_active = active_id.as_deref() == Some(b.id.as_str());
                b_active.cmp(&a_active).then_with(|| {
                    a.failover_priority
                        .unwrap_or(9999)
                        .cmp(&b.failover_priority.unwrap_or(9999))
                })
            });
            candidates
        })
    })
    .await;

    let providers = match providers_result {
        Ok(Ok(p)) => p,
        Ok(Err(e)) => return error_resp(StatusCode::INTERNAL_SERVER_ERROR, &e),
        Err(e) => return error_resp(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };

    if providers.is_empty() {
        return error_resp(
            StatusCode::SERVICE_UNAVAILABLE,
            &format!("No enabled providers for '{app}'"),
        );
    }

    // Decompose request; buffer body once for retry
    let method = req.method().clone();
    let req_headers = req.headers().clone();
    let query = req.uri().query().unwrap_or("").to_string();

    let body_bytes = match axum::body::to_bytes(req.into_body(), 32 * 1024 * 1024).await {
        Ok(b) => b,
        Err(e) => {
            return error_resp(
                StatusCode::BAD_REQUEST,
                &format!("Read request body: {e}"),
            )
        }
    };

    let started = Instant::now();
    let mut last_error = String::new();

    for provider in &providers {
        let url = build_url(&provider.base_url, rest, &query);
        let mut headers = strip_hop_by_hop(&req_headers);
        inject_auth(&mut headers, provider, app);

        let upstream_req = match state
            .client
            .request(method.clone(), &url)
            .headers(headers)
            .body(body_bytes.clone())
            .build()
        {
            Ok(r) => r,
            Err(e) => {
                last_error = e.to_string();
                continue;
            }
        };

        match state.client.execute(upstream_req).await {
            Ok(upstream_resp) => {
                let status = upstream_resp.status();
                if state.log_requests {
                    eprintln!(
                        "[ai-proxy] {} /{app}/{rest} → {url} → {} ({}ms)",
                        method,
                        status.as_u16(),
                        started.elapsed().as_millis()
                    );
                }
                // Try next provider on 5xx (if we have one)
                if status.is_server_error() && providers.len() > 1 {
                    last_error =
                        format!("'{}' returned {}", provider.name, status.as_u16());
                    continue;
                }
                let uctx = UsageContext {
                    app: app.to_string(),
                    provider_id: provider.id.clone(),
                };
                return stream_response(upstream_resp, uctx).await;
            }
            Err(e) => {
                last_error = format!("'{}': {e}", provider.name);
                // connection error → try next
            }
        }
    }

    error_resp(
        StatusCode::BAD_GATEWAY,
        &format!("All providers failed for '{app}': {last_error}"),
    )
}

// ── URL building ──────────────────────────────────────────────────────────────

fn build_url(base_url: &str, rest: &str, query: &str) -> String {
    let base = base_url.trim_end_matches('/');
    let path = rest.trim_start_matches('/');

    // Avoid double /v1 when the provider's base_url already ends with /v1
    // e.g. base="https://api.openai.com/v1" + rest="v1/chat/completions"
    //   → "https://api.openai.com/v1/chat/completions"
    let effective = if base.ends_with("/v1") && path.starts_with("v1/") {
        path.trim_start_matches("v1/")
    } else {
        path
    };

    if query.is_empty() {
        format!("{base}/{effective}")
    } else {
        format!("{base}/{effective}?{query}")
    }
}

// ── Auth injection ────────────────────────────────────────────────────────────

fn inject_auth(headers: &mut HeaderMap, provider: &ProviderRecord, app: &str) {
    match app {
        "claude" => {
            // Anthropic: x-api-key header + version
            if let Ok(v) = HeaderValue::from_str(&provider.api_key) {
                headers.insert("x-api-key", v);
            }
            headers.insert(
                "anthropic-version",
                HeaderValue::from_static("2023-06-01"),
            );
        }
        _ => {
            // OpenAI-compatible & Gemini: Authorization: Bearer
            if !provider.api_key.is_empty() {
                if let Ok(v) =
                    HeaderValue::from_str(&format!("Bearer {}", provider.api_key))
                {
                    headers.insert("authorization", v);
                }
            }
        }
    }
}

// ── Header filtering ──────────────────────────────────────────────────────────

const REQUEST_HOP_BY_HOP: &[&str] = &[
    "host",
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "authorization", // we inject our own
    "x-api-key",     // we inject our own
];

fn strip_hop_by_hop(headers: &HeaderMap) -> HeaderMap {
    let mut out = HeaderMap::new();
    for (name, value) in headers {
        if !REQUEST_HOP_BY_HOP.contains(&name.as_str()) {
            out.insert(name, value.clone());
        }
    }
    out
}

const RESPONSE_HOP_BY_HOP: &[&str] = &[
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
];

// ── Streaming response ────────────────────────────────────────────────────────

async fn stream_response(upstream: reqwest::Response, ctx: UsageContext) -> Response {
    let status = StatusCode::from_u16(upstream.status().as_u16())
        .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);

    let is_sse = upstream
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|ct| ct.contains("text/event-stream"))
        .unwrap_or(false);

    let mut builder = Response::builder().status(status);
    for (name, value) in upstream.headers() {
        if !RESPONSE_HOP_BY_HOP.contains(&name.as_str()) {
            if let Ok(n) = HeaderName::from_bytes(name.as_str().as_bytes()) {
                builder = builder.header(n, value.clone());
            }
        }
    }

    if is_sse {
        // SSE streaming: tee chunks through an mpsc channel so we can:
        //   1. Forward every chunk to the client immediately (no latency)
        //   2. Accumulate the full text and parse usage after the stream ends
        type ChunkResult = Result<Bytes, Box<dyn std::error::Error + Send + Sync>>;
        let (tx, rx) = tokio::sync::mpsc::channel::<ChunkResult>(64);

        tokio::spawn(async move {
            let mut accumulator: Vec<u8> = Vec::new();
            let mut byte_stream = upstream.bytes_stream();

            loop {
                match byte_stream.next().await {
                    Some(Ok(chunk)) => {
                        accumulator.extend_from_slice(&chunk);
                        if tx.send(Ok(chunk)).await.is_err() {
                            return; // client disconnected
                        }
                    }
                    Some(Err(e)) => {
                        let _ = tx
                            .send(Err(Box::new(e) as Box<dyn std::error::Error + Send + Sync>))
                            .await;
                        return;
                    }
                    None => break,
                }
            }
            drop(tx); // signal EOF to client

            // Parse + persist usage in a blocking context
            let sse_text = String::from_utf8_lossy(&accumulator).into_owned();
            if let Some(usage) = usage_parser::parse_sse_usage(&sse_text, &ctx.app) {
                let ctx_clone = ctx.clone();
                tokio::task::spawn_blocking(move || {
                    persist_usage_blocking(&ctx_clone, usage);
                });
            }
        });

        let body_stream = futures_util::stream::unfold(rx, |mut rx| async move {
            rx.recv().await.map(|item| (item, rx))
        });

        builder
            .body(Body::from_stream(body_stream))
            .unwrap_or_else(|_| {
                Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .body(Body::empty())
                    .unwrap()
            })
    } else {
        // Non-streaming: buffer full body, parse usage, return as bytes
        match upstream.bytes().await {
            Ok(body_bytes) => {
                if let Some(usage) =
                    usage_parser::parse_body_usage(&body_bytes, &ctx.app)
                {
                    tokio::task::spawn_blocking(move || {
                        persist_usage_blocking(&ctx, usage);
                    });
                }
                builder
                    .body(Body::from(body_bytes))
                    .unwrap_or_else(|_| {
                        Response::builder()
                            .status(StatusCode::INTERNAL_SERVER_ERROR)
                            .body(Body::empty())
                            .unwrap()
                    })
            }
            Err(e) => error_resp(
                StatusCode::BAD_GATEWAY,
                &format!("Read upstream body: {e}"),
            ),
        }
    }
}

fn error_resp(status: StatusCode, message: &str) -> Response {
    Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .body(Body::from(format!(
            r#"{{"error":{{"message":{message:?},"type":"proxy_error"}}}}"#
        )))
        .unwrap_or_else(|_| {
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Body::empty())
                .unwrap()
        })
}

fn active_id_for_app<'a>(active: &'a ActiveProviderSet, app: &str) -> Option<&'a str> {
    match app {
        "claude" => active.claude.as_deref(),
        "codex" => active.codex.as_deref(),
        "gemini" => active.gemini.as_deref(),
        "opencode" => active.opencode.as_deref(),
        "openclaw" => active.openclaw.as_deref(),
        _ => None,
    }
}
