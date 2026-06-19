# AI Server Rescue Mode - Design

Date: 2026-06-19
Status: Draft, pending user review

## Goal

Add an **AI Server Rescue Mode** for connected SSH sessions. The feature turns
GWShell from a generic SSH/SFTP client into a practical incident-response
workbench: when a server is unhealthy, the user can run a bounded diagnosis,
watch an AI model analyze evidence in real time, understand likely causes, and
get safe next commands without leaving the terminal.

The MVP focuses on Linux SSH servers and six frequent incident classes:

1. Disk full or inode exhaustion.
2. High CPU, memory pressure, or abnormal load.
3. Service down, failed systemd unit, or 502/5xx-style web failure.
4. Port/listener conflict or expected port not listening.
5. Docker/container unhealthy, exited, or restart-looping.
6. General "server feels broken" health check.

## Product Principle

This is not another terminal convenience feature. The promise is:

> "When a server has a problem, GWShell can collect the right evidence, explain
> the likely cause, and prepare the next safe action in minutes."

Real-time AI analysis is a core workflow, not a cosmetic explanation layer.
Deterministic rules still run in parallel as a safety net: they provide baseline
findings, validate model claims, and keep the feature useful when the provider
is unavailable.

## Current State

GWShell already has the building blocks needed for an MVP:

- SSH exec for non-interactive remote commands:
  `src-tauri/src/ssh/mod.rs::ssh_exec`.
- Metrics polling and events:
  `src-tauri/src/metrics.rs`, `start_server_metrics`,
  `server-metrics-{sessionId}`.
- SSH OS detection:
  `detect_remote_os`.
- Docker listing/exec support:
  `src-tauri/src/docker.rs`.
- Existing server dashboard and server panel UI:
  `src/components/AssetDashboard`, `src/components/ServerPanel`.
- Existing command palette and terminal tab state:
  `src/components/CommandPalette`, `src/components/Terminal/TerminalView.tsx`.
- HTTP streaming support through `reqwest` with the `stream` feature already in
  `src-tauri/Cargo.toml`.
- Secret-at-rest encryption in `src-tauri/src/crypto.rs`, backed by the OS
  credential store when available.

The missing piece is a coordinated diagnostic workflow with a report model,
safe probe command packs, evidence normalization, rule-based findings, optional
AI explanation, and a UI surface for action.

## UX

### Entry Points

- Active SSH terminal: a "Rescue" action in the terminal toolbar or overflow.
- Command Palette: "Run Server Rescue".
- Asset dashboard/server card: "Diagnose" for a connected SSH session.

If the selected tab is not a connected SSH session, show a short disabled-state
message and do not offer fake diagnostics.

### Rescue Panel

Open a right-side panel scoped to the current SSH session.

Top section:

- Session name, host, username, current connection state.
- AI analyzer state:
  - Enabled with provider/model name.
  - Not configured.
  - Temporarily unavailable, using local rules.
- Profile selector:
  - General health
  - Disk full
  - CPU/memory
  - Service/web down
  - Port/network
  - Docker
- Optional free-text symptom field, e.g. "nginx 502" or "deploy failed".
- Primary action: "Run diagnosis".

During execution:

- Show step progress: identity, resources, services, logs, network, docker.
- Show elapsed time and current command label, not raw command spam.
- Stream an "AI analysis" area that updates while probes finish:
  - current hypothesis
  - new evidence being considered
  - confidence changes
  - questions/next probes the model wants, shown as suggestions rather than
    automatically executed
- Allow cancel. Cancel stops scheduling new probes; in-flight remote commands
  time out normally. It also cancels any in-flight model request.

After execution:

- **Summary:** likely cause, confidence, severity.
- **Evidence:** compact cards with raw snippets behind expanders.
- **Recommended next steps:** commands grouped by risk.
- **Report actions:** copy Markdown, reopen saved report, insert command into
  terminal.

### Command Execution Safety

MVP does **not** automatically run mutating fixes. It can:

- Run read-only diagnostic probes.
- Copy a suggested command.
- Insert a suggested command into the terminal input buffer for the user to
  review and press Enter.

Later versions can add explicit "Run fix" with typed confirmation and audit.

## Diagnostic Profiles

All probes are bounded by timeout and output caps. Commands should avoid broad,
expensive scans by default.

### Common Linux Probes

- Identity:
  - `hostname`
  - `uname -a`
  - `id`
  - `uptime`
- Resources:
  - `df -hP`
  - `df -iP`
  - `free -m`
  - `ps -eo pid,ppid,stat,pcpu,pmem,comm,args --sort=-pcpu | head -n 15`
  - `ps -eo pid,ppid,stat,pcpu,pmem,comm,args --sort=-pmem | head -n 15`
- Services:
  - `systemctl --failed --no-pager`
  - `systemctl list-units --type=service --state=running --no-pager | head -n 80`
- Logs:
  - `journalctl -p warning..alert -n 120 --no-pager`
  - Fallback: recent readable files under `/var/log` only when journalctl is
    unavailable.
- Network:
  - `ss -tulpn`
  - `ip route`
- Docker, if available:
  - `docker ps --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}'`
  - `docker ps -a --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}' | head -n 40`
  - `docker stats --no-stream --format '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'`

### Profile-Specific Additions

- Disk full:
  - Check `/`, `/var`, `/var/log`, `/tmp`, and mounted filesystems from `df`.
  - Suggest targeted `du -xhd1` commands, but do not run a full filesystem scan
    automatically.
- Service/web down:
  - Detect nginx/apache/caddy units if present.
  - Probe common statuses with `systemctl status <unit> --no-pager -l`.
  - Inspect recent logs for detected units.
- Port/network:
  - Ask for expected port if not inferable from symptom.
  - Cross-check listener presence in `ss`.
- Docker:
  - Highlight exited/restarting containers.
  - Suggest `docker logs --tail=120 <container>` for selected suspects.

## Analysis Model

### Data Structures

New shared TypeScript/Rust-compatible report shape:

```ts
type RescueReport = {
  id: string;
  sessionId: string;
  profile: RescueProfile;
  startedAt: number;
  finishedAt?: number;
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  summary: RescueSummary;
  findings: RescueFinding[];
  evidence: RescueEvidence[];
  suggestions: RescueSuggestion[];
};
```

Findings:

```ts
type RescueFinding = {
  id: string;
  title: string;
  severity: 'info' | 'warning' | 'critical';
  confidence: 'low' | 'medium' | 'high';
  evidenceIds: string[];
};
```

Suggestions:

```ts
type RescueSuggestion = {
  id: string;
  label: string;
  command?: string;
  risk: 'read_only' | 'low' | 'medium' | 'high';
  rationale: string;
};
```

### Rule Engine

Initial deterministic rules:

- Disk usage >= 90% -> warning; >= 95% -> critical.
- Inode usage >= 90% -> warning; >= 95% -> critical.
- Load average greater than CPU count for sustained periods -> warning.
- Memory available below 10% or swap heavily used -> warning.
- `systemctl --failed` non-empty -> warning/critical based on unit names.
- Expected web/service port absent from `ss` -> critical for service/web profile.
- Docker containers in `Exited` or `Restarting` states -> warning/critical.
- Journal contains repeated `no space left`, `oom`, `killed process`,
  `connection refused`, `permission denied`, or `address already in use` ->
  mapped findings.

Rules must attach evidence IDs so every claim can be inspected.

### Real-Time AI Analysis

MVP defines an `AnalysisProvider` interface and ships an OpenAI-compatible
streaming provider:

- `RuleAnalysisProvider`: always available, local, deterministic.
- `OpenAiCompatibleAnalysisProvider`: calls a configurable
  OpenAI-compatible `/v1/chat/completions` endpoint with streaming enabled.

The provider is intentionally OpenAI-compatible rather than vendor-specific.
Users can connect OpenAI, DeepSeek, Qwen, Zhipu, or a local gateway if it exposes
the same request/streaming shape.

Provider settings:

```ts
type AiProviderSettings = {
  enabled: boolean;
  provider: 'openai_compatible';
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
  temperature: number;
  maxInputChars: number;
  requestTimeoutSecs: number;
};
```

The API key is stored by the backend, encrypted through `crypto.rs`, and never
written into the frontend settings JSON. Frontend settings only indicate whether
a key is configured.

#### Streaming Flow

The diagnosis pipeline produces scrubbed evidence frames. Each frame contains a
small, capped delta instead of the entire report:

```ts
type RescueAnalysisFrame = {
  reportId: string;
  profile: RescueProfile;
  symptom?: string;
  stage: string;
  newEvidence: RescueEvidence[];
  ruleFindings: RescueFinding[];
  previousSummary?: RescueSummary;
};
```

Frames are sent to the AI worker after each diagnostic stage, with debounce and
deduplication so a noisy command does not trigger excessive model calls.

The model receives:

- the user symptom
- the active profile
- latest scrubbed evidence
- current rule findings
- strict instructions to cite evidence IDs
- a JSON schema for structured updates

The model returns both streamed human-readable deltas and a structured update:

```ts
type RescueAiUpdate = {
  summary: RescueSummary;
  findings: RescueFinding[];
  suggestions: RescueSuggestion[];
  questions: string[];
};
```

Findings without valid `evidenceIds` are not promoted to final findings. They
can appear only as low-confidence hypotheses in the live analysis area.

#### Real-Time Events

- `rescue-analysis-delta-{sessionId}`
  - `{ reportId, textDelta }`
- `rescue-analysis-update-{sessionId}`
  - `{ reportId, update }`
- `rescue-analysis-error-{sessionId}`
  - `{ reportId, message, fallback: 'rules' }`

The panel should show streamed text immediately, then reconcile it with the
structured update when available.

#### Prompt Contract

The system prompt is fixed in code and must enforce:

- Do not claim a cause without citing evidence IDs.
- Prefer "unknown" over unsupported guesses.
- Separate confirmed findings from hypotheses.
- Never recommend destructive commands as the first action.
- Never request secrets, private keys, tokens, or full config dumps.
- Return suggestions as commands only when they are directly relevant to the
  evidence and risk-classified.

#### Safety Gate for AI Suggestions

All AI-generated suggestions pass through a deterministic risk classifier before
display:

- `read_only`: `systemctl status`, `journalctl`, `df`, `free`, `ss`, `docker logs`.
- `low`: targeted restart/reload suggestions such as `systemctl reload nginx`.
- `medium`: service restart, container restart, cache cleanup suggestions.
- `high`: delete/truncate, force kill, reboot, permission changes, firewall
  changes, database/file mutation.

High-risk commands are shown collapsed with a warning and cannot be inserted
into the terminal without an explicit confirmation. No suggestion is executed
automatically.

#### Privacy and Redaction

Before evidence is persisted or sent to a provider:

- redact passwords, tokens, API keys, bearer headers, private-key blocks, and
  common connection strings
- cap each evidence body
- omit environment variables, shell history, private keys, and full config files
- include a visible panel note when evidence is being sent to a configured
  external provider

## Backend Architecture

New modules:

- `src-tauri/src/rescue.rs`
  - diagnostic orchestration, probe execution, rule findings, report persistence
- `src-tauri/src/rescue_ai.rs`
  - provider settings, OpenAI-compatible streaming client, prompt contract,
    redaction, SSE parsing, structured update validation

Commands:

- `run_rescue_diagnosis(session_id, profile, symptom) -> RescueReport`
  - Runs the full read-only diagnostic workflow.
  - Emits progress events.
  - Returns the final report.
- `cancel_rescue_diagnosis(report_id)`
  - Marks the report cancelled and prevents further probes.
- `save_rescue_report(report)`
  - Persists a completed report locally. Called automatically after a completed
    diagnosis and explicitly if the user reruns analysis on partial evidence.
- `list_rescue_reports(session_id)`
  - Returns saved reports for the selected session.
- `load_ai_provider_settings() -> AiProviderSettings`
  - Returns provider settings without the API key.
- `save_ai_provider_settings(settings)`
  - Persists non-secret provider settings.
- `set_ai_provider_api_key(api_key)`
  - Stores the key encrypted with `crypto::encrypt_secret`.
- `clear_ai_provider_api_key()`
  - Removes the stored key.
- `test_ai_provider()`
  - Sends a tiny streaming request and returns provider/model reachability.

Events:

- `rescue-progress-{sessionId}`:
  - `{ reportId, step, label, status }`
- `rescue-evidence-{sessionId}`:
  - `{ reportId, evidence }`
- `rescue-analysis-delta-{sessionId}`:
  - `{ reportId, textDelta }`
- `rescue-analysis-update-{sessionId}`:
  - `{ reportId, update }`
- `rescue-analysis-error-{sessionId}`:
  - `{ reportId, message, fallback: 'rules' }`

Execution:

- Use `ssh_manager.ssh_exec` for all probes.
- Wrap each probe in a timeout.
- Cap stdout/stderr per probe, e.g. 32 KB.
- Never run `sudo` automatically.
- Never collect environment variables, private keys, shell history files, or
  full config files.
- Scrub common secrets in output before storing or sending to an AI provider.
- After each diagnostic stage, send a compact `RescueAnalysisFrame` to the AI
  worker if AI is enabled and configured.
- Continue the diagnosis if the AI worker fails; emit `rescue-analysis-error`
  and keep rule-based findings.
- Abort the active model request when the user cancels the report.

AI HTTP client:

- Use backend `reqwest` so the API key never leaves Rust.
- Use OpenAI-compatible chat completion payloads with `stream: true`.
- Parse server-sent `data:` chunks and emit text deltas.
- Collect the final structured JSON block for validation.
- Enforce request timeout, max input characters, and max output tokens.
- Retry only transient network errors once; do not retry 401/403/429 blindly.

Persistence:

- Store completed reports in SQLite in a `rescue_reports` table.
- Keep raw probe output capped and scrubbed before persistence.
- Support "copy report as Markdown" from any completed or failed report.
- Store AI provider settings in `app_settings` under a separate key. Store the
  API key encrypted under a separate key, not inside the main settings blob.

## Frontend Architecture

New files:

- `src/types/rescue.ts`
- `src/types/ai.ts`
- `src/lib/rescueProfiles.ts`
- `src/components/Rescue/RescuePanel.tsx`
- `src/components/Rescue/RescueAiStream.tsx`
- `src/components/Rescue/RescueSummary.tsx`
- `src/components/Rescue/RescueEvidence.tsx`
- `src/components/Rescue/RescueSuggestions.tsx`
- `src/components/Settings/AiSettingsSection.tsx`

Modified files:

- `src/stores/appStore.ts`
  - Track `rescuePanelOpen`, active rescue session id, current report, live AI
    text, and latest structured AI update.
- `src/components/Terminal/TerminalView.tsx`
  - Provide active SSH session context and insert-suggestion-to-terminal action.
- `src/components/CommandPalette/commands.ts`
  - Add "Run Server Rescue".
- `src/components/AssetDashboard/HostDashCard.tsx`
  - Add diagnose action for connected SSH hosts in the existing action area or
    overflow menu.
- `src/components/Settings/SettingsModal.tsx`
  - Add an AI settings section for provider enablement, base URL, model, API
    key entry, timeout, and test connection.
- `src-tauri/src/lib.rs`
  - Register rescue and AI provider commands.
- `src-tauri/src/database.rs`
  - Persist rescue reports and AI provider settings.
- `src-tauri/src/crypto.rs`
  - Reuse generic secret encryption for the AI API key.
- `src/i18n/locales/gwshell.zh.json`
- `src/i18n/locales/gwshell.en.json`
- `src/styles/global.css` or a scoped Rescue CSS file.

### AI Settings UX

Settings adds an "AI" section:

- Enable AI real-time analysis.
- Base URL, defaulting to `https://api.openai.com/v1` and editable for any
  OpenAI-compatible gateway.
- Model name.
- API key field with "configured / not configured" state.
- Temperature, default `0.2`.
- Max input characters, default `24000`.
- Request timeout, default `45s`.
- "Test model" button.

The Rescue panel must make provider state visible:

- "AI analyzing with `<model>`" when streaming works.
- "AI unavailable, using local diagnosis" when not configured or failed.
- "Evidence sent to external provider" notice when base URL is non-local.

## Error Handling

- Not connected: explain that rescue requires an active SSH session.
- Unsupported OS: show "Linux SSH only in this version" and include detected OS.
- Command timeout: mark probe as timed out, continue with other probes.
- Permission denied: keep the evidence; suggest commands requiring appropriate
  permissions instead of retrying with sudo.
- Missing tools (`systemctl`, `journalctl`, `ss`, `docker`): degrade gracefully
  and show which checks were skipped.
- SSH disconnect mid-run: mark report failed with collected partial evidence.
- AI not configured: run local rules and show a setup action.
- AI authentication failure: stop model requests, show a provider error, keep
  local diagnosis.
- AI timeout or malformed response: keep streamed text as a draft if useful,
  discard invalid structured findings, and keep local diagnosis.
- AI rate limit: stop further model calls for that report and continue probes.

## Non-Goals

- No autonomous repair in MVP.
- No autonomous AI-driven command execution in MVP.
- No cron/daemon background monitoring in MVP.
- No Windows server diagnostics in MVP.
- No Kubernetes diagnostics in MVP.
- No broad log ingestion, full filesystem scan, or continuous AIOps pipeline.
- No cloud sync of reports.
- No vendor-specific SDK in MVP; use OpenAI-compatible HTTP only.

## Testing

Backend:

- Unit tests for parsers:
  - `df -hP`
  - `df -iP`
  - `free -m`
  - `systemctl --failed`
  - `ss -tulpn`
  - Docker ps output
- Unit tests for rules:
  - disk critical
  - inode critical
  - failed unit
  - port missing
  - restarting container
  - no findings on healthy sample
- Unit tests for AI plumbing:
  - secret redaction
  - OpenAI-compatible SSE chunk parsing
  - malformed JSON update rejection
  - evidence-ID validation
  - command risk classification
  - provider settings never serialize the API key to frontend settings

Frontend:

- `npm run build`
- UI manual checks:
  - connected SSH session shows Rescue entry.
  - disconnected/non-SSH tab blocks diagnosis.
  - progress updates render.
  - configured AI provider streams live analysis text.
  - AI provider failure falls back to local diagnosis without losing evidence.
  - final report has summary, evidence, suggestions.
  - "insert command" places text into terminal input without executing it.
  - high-risk AI suggestions require confirmation before insertion.

Full verification:

- `cd src-tauri; cargo check`
- `npm run build`
- `npm run smoke:check` if available.

## MVP Acceptance Criteria

- From a connected Linux SSH tab, user can run a diagnosis and receive a report.
- With a configured OpenAI-compatible provider, live AI analysis streams while
  diagnostic stages complete.
- AI-generated findings must cite valid evidence IDs before they enter the final
  report.
- Report includes at least one evidence-backed finding when disk, memory,
  service, port, or Docker sample outputs indicate a problem.
- No mutating command is executed by the rescue workflow.
- All remote probes have timeouts and output caps.
- Missing permissions/tools do not fail the entire diagnosis.
- Suggestions are explicit about risk and are inspectable before use.
- If the model is unavailable, the feature falls back to deterministic local
  diagnosis and clearly labels that state.
- The AI API key is stored only in backend encrypted storage and is never written
  into the frontend settings JSON.
