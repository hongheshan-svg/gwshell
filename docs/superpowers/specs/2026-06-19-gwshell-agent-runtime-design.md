# GWShell Agent Runtime - Design

Date: 2026-06-19
Status: Draft, pending user review

## Core Concept

GWShell should be positioned as a **local server agent runtime**, not just a
terminal with AI features.

The user configures an AI model API, connects servers through GWShell, and then
GWShell acts as the controlled agent host:

1. Observe real-time logs, metrics, terminal output, Docker state, systemd state,
   ports, files, and command results.
2. Analyze issues continuously with the configured model plus deterministic
   local rules.
3. Plan fixes as explicit, inspectable actions.
4. Execute allowed actions through SSH/SFTP/Docker tools under a policy.
5. Verify results after every action.
6. Keep an audit trail and convert repeated fixes into reusable runbooks.

The product promise becomes:

> "Give GWShell access to your servers and an AI model. It watches, explains,
> fixes within your rules, and leaves an audit trail."

The previous "AI Server Rescue Mode" becomes the first use case of this agent
runtime: an interactive incident session for one connected SSH host.

## Product Shape

### What GWShell Is

GWShell is the agent shell around the model:

- It owns server connections and tool execution.
- It owns credential storage and redaction.
- It owns approval policy and action risk classification.
- It owns live context: logs, metrics, open tabs, SFTP files, Docker containers.
- It owns the audit trail.

The AI model is the reasoning engine, but it does not directly control the
server. It can only request tool calls through GWShell's policy gate.

### What The User Configures

Settings adds an Agent/AI section:

- Enable GWShell Agent.
- OpenAI-compatible base URL, default `https://api.openai.com/v1`.
- Model name.
- API key, stored encrypted by the backend.
- Streaming on/off.
- Token/input caps.
- Provider test.
- Default autonomy level.

The API key is never stored in the frontend settings JSON. Backend commands
store it with existing secret encryption.

## Agent Loop

Every agent session follows the same loop:

```text
Observe -> Analyze -> Plan -> Approve/Policy -> Act -> Verify -> Record
```

## Architecture Reorganization

The Agent Runtime should be a first-class subsystem beside SSH, PTY, SFTP,
Docker, metrics, and database. It should not be implemented inside
`TerminalView`, `ServerPanel`, or ad hoc command handlers.

### Backend Boundary

Current backend shape:

- `src-tauri/src/lib.rs` owns IPC command registration and `AppState`.
- `AppState` owns `SshManager`, `PtyManager`, `SerialManager`, `Database`, and
  `MetricsManager`.
- SSH, SFTP, Docker, metrics, vault, and settings are already separated into
  backend modules.

Agent shape:

- Add `src-tauri/src/agent/` as a module tree.
- Add `agent_manager: Arc<AgentManager>` to `AppState`.
- Keep IPC wrappers in `lib.rs`, but move real agent behavior into
  `agent/*`.
- AgentManager owns active agent sessions, cancellation, live log streams, and
  analysis tasks.
- Agent tools call existing managers (`SshManager`, SFTP methods, Docker
  commands, metrics snapshots) instead of duplicating connection logic.

Recommended backend modules:

- `agent/types.rs`
  - shared serializable structs: sessions, events, evidence, findings, actions,
    policy, provider settings, audit records
- `agent/manager.rs`
  - starts/stops agent sessions, routes events, owns task handles
- `agent/tools.rs`
  - typed tool registry over SSH/SFTP/Docker/log sources
- `agent/stream.rs`
  - bounded SSH exec streaming for log tails such as `journalctl -f`,
    `docker logs -f`, and `tail -F`
- `agent/provider.rs`
  - OpenAI-compatible streaming client and provider settings
- `agent/prompt.rs`
  - fixed system prompt and model request construction
- `agent/redaction.rs`
  - secret redaction before persistence or provider calls
- `agent/risk.rs`
  - deterministic action risk classifier
- `agent/policy.rs`
  - autonomy levels and approval decisions
- `agent/audit.rs`
  - report/audit persistence helpers

### Frontend Boundary

Current frontend shape:

- `App.tsx` composes global drawers, modals, terminal/SFTP panes, and lazy
  feature chunks.
- `appStore.ts` holds global UI state and session/tab state.
- `settingsStore.ts` holds user settings.
- Large feature UIs live under focused component folders.

Agent shape:

- Add `src/stores/agentStore.ts` for Agent-specific state. Do not inflate
  `appStore.ts` with live model text, evidence, action queues, and audits.
- Add `src/components/Agent/` as a lazy feature chunk rendered from `App.tsx`.
- Keep `TerminalView` responsible for terminal I/O only. It may expose an
  "insert command" callback, but Agent execution goes through backend tools.
- Add `src/components/Settings/AiSettingsSection.tsx` and keep API-key
  management out of `settingsStore.ts` because the key is backend-secret state.

Recommended frontend modules:

- `src/types/agent.ts`
  - TypeScript mirror of Rust serializable structs
- `src/stores/agentStore.ts`
  - active agent session id, live status, evidence, analysis stream, action
    queue, approvals, audit summary
- `src/lib/agentEvents.ts`
  - Tauri event subscription helpers with cleanup
- `src/components/Agent/AgentPanel.tsx`
  - shell for the right-side panel
- `src/components/Agent/AgentObjective.tsx`
  - objective input and autonomy selector
- `src/components/Agent/AgentSources.tsx`
  - log/source attachment controls
- `src/components/Agent/AgentAnalysisStream.tsx`
  - live model text and structured updates
- `src/components/Agent/AgentEvidence.tsx`
  - evidence cards and raw snippets
- `src/components/Agent/AgentActionQueue.tsx`
  - proposed actions, risk labels, approval buttons
- `src/components/Agent/AgentAuditTimeline.tsx`
  - action and verification history

### Data Flow

```text
User objective
  -> start_agent_session IPC
  -> AgentManager creates AgentSession
  -> ToolRegistry collects probes/log frames
  -> Redaction caps and scrubs evidence
  -> Provider streams AI analysis
  -> Policy normalizes proposed actions
  -> Frontend shows action queue
  -> User approval or policy approval
  -> ToolRegistry executes
  -> Verification tool runs
  -> Audit persists result
```

### Event Contract

Agent events should be namespaced by agent session id, not terminal tab id:

- `agent-status-{agentSessionId}`
- `agent-evidence-{agentSessionId}`
- `agent-analysis-delta-{agentSessionId}`
- `agent-analysis-update-{agentSessionId}`
- `agent-action-proposed-{agentSessionId}`
- `agent-action-result-{agentSessionId}`
- `agent-audit-{agentSessionId}`
- `agent-error-{agentSessionId}`

The frontend maps an agent session to its target GWShell session id and active
tab, but the event identity remains the agent session id. This avoids mixing
multiple agent runs attached to the same server.

### Database Shape

Extend SQLite with focused tables:

- `agent_provider_settings`
  - non-secret provider configuration
- `agent_provider_secret`
  - encrypted API key
- `agent_audit`
  - completed or failed agent session reports
- `agent_runbooks`
  - later reusable maintenance plans

Do not store API keys in the main frontend settings blob.

### First Implementation Boundary

The first implementation should build a vertical slice:

1. Configure AI provider.
2. Start one Agent session on one connected SSH host.
3. Attach one real-time log source.
4. Stream redacted evidence to the model.
5. Show live analysis.
6. Accept typed read-only tool calls.
7. Require approval for mutating tool calls.
8. Verify after execution.
9. Save an audit report.

This is enough to prove the Agent architecture without prematurely building
fleet automation, background daemons, or unrestricted auto-maintenance.

### Observe

The agent gathers bounded, redacted context from tools:

- SSH exec probes.
- Live `journalctl -f` or bounded recent logs.
- Application log tails selected by the user or discovered by rules.
- System metrics already available in GWShell.
- Docker container list, stats, logs, and status.
- SFTP read for selected config/log files.
- Terminal output from the active session when the user opts in.

Observation is explicit. GWShell should not silently stream every terminal byte
to the model. Each source is visible in the Agent panel.

### Analyze

GWShell sends compact evidence frames to the model:

- Current symptom/user goal.
- Recent evidence IDs and snippets.
- Rule findings.
- Recent actions and verification result.
- Server identity and safe metadata.

The model streams:

- current hypothesis
- likely root cause
- missing evidence
- proposed next probe
- proposed maintenance action

All model claims must cite evidence IDs. Claims without evidence remain
"hypotheses" and cannot become final findings.

### Plan

The model can propose a plan, but GWShell normalizes it into typed actions:

- `RunCommand`
- `ReadFile`
- `WriteFile`
- `UploadFile`
- `DownloadFile`
- `RestartService`
- `ReloadService`
- `DockerLogs`
- `DockerRestart`
- `OpenPortCheck`
- `CreateRunbook`

Each action has:

- target host/session
- command or tool payload
- risk level
- expected result
- verification command
- rollback note if applicable

### Approve / Policy

Autonomy is controlled by levels:

- **L0 Observe:** analyze only, no suggested actions inserted.
- **L1 Recommend:** suggest commands and runbooks, user copies/inserts manually.
- **L2 Confirmed Act:** GWShell executes after explicit user approval.
- **L3 Policy Auto-Maintain:** GWShell can execute pre-approved actions that
  match a per-server policy.

Default for MVP: L1 or L2, never L3 by default.

L3 requires:

- per-server enablement
- allowed action list
- denied command patterns
- maintenance window
- max actions per incident
- post-action verification requirement
- audit logging

### Act

GWShell executes actions through existing backends:

- SSH command execution.
- SFTP read/write/upload/download.
- Docker list/log/exec/restart where supported.
- Existing tunnel/session context.

The model never receives raw credentials and never directly executes anything.

### Verify

Every action must have a verification step:

- service status after restart
- port listener check
- HTTP probe if configured
- log tail after action
- Docker status after restart
- disk/memory check after cleanup

If verification fails, the agent stops automatic action escalation and asks the
user for approval.

### Record

Every agent session stores:

- evidence collected
- model deltas and structured conclusions
- local rule findings
- actions proposed
- approvals
- actions executed
- verification results
- final summary

Repeated successful sessions can be converted into runbooks.

## Core UI

### Agent Panel

A right-side Agent panel is the primary UI:

- model/provider state
- selected server/session
- current objective
- observed sources
- live AI reasoning stream
- evidence list
- proposed plan
- action queue
- approval prompts
- verification results
- audit timeline

### Agent Objective Box

At the top of the panel:

- "Describe the problem or objective"
- examples:
  - "nginx 502 after deploy"
  - "disk is almost full"
  - "watch this server and auto-restart nginx if it crashes"
  - "analyze Docker container restart loop"

The objective becomes the agent session's task. It is included in every model
frame.

### Real-Time Log Interaction

Logs are not a static report. The user can attach sources:

- system journal
- specific service logs
- Docker container logs
- selected file tail
- terminal output opt-in

The model receives rolling summaries plus recent deltas. GWShell keeps the raw
log stream local and only sends capped, redacted chunks to the provider.

## Tool Registry

New backend module: `src-tauri/src/agent/`.

Suggested structure:

- `agent/mod.rs`
- `agent/session.rs`
- `agent/tools.rs`
- `agent/policy.rs`
- `agent/ai.rs`
- `agent/redaction.rs`
- `agent/audit.rs`
- `agent/runbook.rs`

Tool calls use a typed registry:

```ts
type AgentToolCall = {
  id: string;
  tool: AgentToolName;
  targetSessionId: string;
  payload: Record<string, unknown>;
  risk: 'read_only' | 'low' | 'medium' | 'high' | 'blocked';
  reason: string;
  expectedResult?: string;
  verify?: AgentToolCall;
};
```

Risk classification is deterministic. The model can propose a risk, but GWShell
calculates the actual risk.

Blocked examples:

- private key reads
- shell history reads
- broad secret scans
- `rm -rf /`
- destructive database commands
- firewall changes without explicit policy
- user/account/password changes without explicit policy

## AI Provider

The first provider should be OpenAI-compatible streaming chat completion:

- base URL configurable
- model configurable
- API key encrypted in backend storage
- streaming SSE parser in Rust
- request timeout
- max input characters
- redaction before sending
- structured JSON update validation

The model should receive a strict system prompt:

- You are operating inside GWShell Agent.
- You cannot execute commands directly.
- Use evidence IDs for every claim.
- Ask for missing evidence instead of guessing.
- Produce tool calls only from the allowed schema.
- Classify risk, but GWShell will enforce final risk.
- Prefer reversible, low-risk actions.
- For high-risk actions, explain risk and ask for human approval.

## Automatic Maintenance

"Automatic maintenance" must be policy-driven, not free-form model autonomy.

Examples of L3 auto-maintain policies:

- If nginx is down and config test passes, restart nginx once.
- If a Docker container is restart-looping, collect logs and restart once.
- If disk usage exceeds 95%, run only pre-approved cleanup commands for known
  cache directories.
- If a service fails repeatedly, disable auto-actions and alert the user.

Every policy action requires:

- trigger condition
- allowed tool call
- max frequency
- verification
- rollback/stop condition
- audit entry

MVP should implement the policy engine boundary but ship with L3 disabled by
default. Users can enable it per server after seeing L1/L2 behavior.

## MVP Scope

The first implementation should not try to build full autonomous ops. It should
ship a useful agent session:

1. AI provider settings with encrypted API key.
2. Agent panel for one connected SSH session.
3. Objective input.
4. Attach log sources:
   - journal recent logs
   - systemd unit logs
   - Docker container logs
   - selected remote file tail
5. Stream evidence frames to the AI provider.
6. Show live model analysis.
7. Let the model propose typed actions.
8. Run read-only actions automatically.
9. Require confirmation for mutating actions.
10. Verify after action.
11. Save audit report.

This keeps the first release valuable while building the correct foundation for
later auto-maintenance.

## Non-Goals For MVP

- No always-on background daemon.
- No cross-server fleet automation.
- No Kubernetes automation.
- No arbitrary model shell execution.
- No hidden terminal streaming.
- No default autonomous mutation.
- No vendor-specific SDK.

## Acceptance Criteria

- User can configure an OpenAI-compatible model API and test it.
- User can start an Agent session on a connected SSH host.
- User can attach at least one real-time log source.
- Model analysis streams while logs/probes are collected.
- Model can propose typed actions.
- GWShell blocks or requires confirmation based on deterministic risk.
- Read-only actions can run through the agent tool registry.
- Mutating actions are never executed without approval in MVP.
- Each action has a verification result.
- The session produces an audit report.
- API key is stored only in backend encrypted storage.

## Relationship To Existing Design

This document supersedes the narrower "AI Server Rescue Mode" framing. Rescue
mode remains the first workflow built on top of GWShell Agent:

- Rescue diagnosis = an Agent session with an incident objective.
- Real-time AI analysis = model analysis stream.
- Suggested fixes = typed tool calls.
- Safe execution = policy gate.
- Report history = agent audit trail.
