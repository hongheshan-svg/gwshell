# AI Server Rescue Mode - Design

Date: 2026-06-19
Status: Draft, pending user review

## Goal

Add an **AI Server Rescue Mode** for connected SSH sessions. The feature turns
GWShell from a generic SSH/SFTP client into a practical incident-response
workbench: when a server is unhealthy, the user can run a bounded diagnosis,
see evidence, understand likely causes, and get safe next commands without
leaving the terminal.

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

The first version must be useful even without a cloud model. Deterministic rules
produce the baseline diagnosis. An AI analysis provider can improve the wording,
prioritization, and follow-up suggestions when configured, but the report cannot
depend on AI availability.

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
- Allow cancel. Cancel stops scheduling new probes; in-flight remote commands
  time out normally.

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

### AI Provider

MVP defines an `AnalysisProvider` interface but keeps AI optional:

- `RuleAnalysisProvider`: always available, local, deterministic.
- Future `LlmAnalysisProvider`: accepts normalized evidence and returns
  summary/suggestions, but must not invent facts not present in evidence.

The UI should label rule-based output as "Diagnosis" rather than pretending it
is AI when no model is configured.

## Backend Architecture

New module: `src-tauri/src/rescue.rs`.

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

Events:

- `rescue-progress-{sessionId}`:
  - `{ reportId, step, label, status }`

Execution:

- Use `ssh_manager.ssh_exec` for all probes.
- Wrap each probe in a timeout.
- Cap stdout/stderr per probe, e.g. 32 KB.
- Never run `sudo` automatically.
- Never collect environment variables, private keys, shell history files, or
  full config files.
- Scrub common secrets in output before storing or sending to an AI provider.

Persistence:

- Store completed reports in SQLite in a `rescue_reports` table.
- Keep raw probe output capped and scrubbed before persistence.
- Support "copy report as Markdown" from any completed or failed report.

## Frontend Architecture

New files:

- `src/types/rescue.ts`
- `src/lib/rescueProfiles.ts`
- `src/components/Rescue/RescuePanel.tsx`
- `src/components/Rescue/RescueSummary.tsx`
- `src/components/Rescue/RescueEvidence.tsx`
- `src/components/Rescue/RescueSuggestions.tsx`

Modified files:

- `src/stores/appStore.ts`
  - Track `rescuePanelOpen`, active rescue session id, and current report.
- `src/components/Terminal/TerminalView.tsx`
  - Provide active SSH session context and insert-suggestion-to-terminal action.
- `src/components/CommandPalette/commands.ts`
  - Add "Run Server Rescue".
- `src/components/AssetDashboard/HostDashCard.tsx`
  - Add diagnose action for connected SSH hosts in the existing action area or
    overflow menu.
- `src-tauri/src/lib.rs`
  - Register rescue commands.
- `src/i18n/locales/gwshell.zh.json`
- `src/i18n/locales/gwshell.en.json`
- `src/styles/global.css` or a scoped Rescue CSS file.

## Error Handling

- Not connected: explain that rescue requires an active SSH session.
- Unsupported OS: show "Linux SSH only in this version" and include detected OS.
- Command timeout: mark probe as timed out, continue with other probes.
- Permission denied: keep the evidence; suggest commands requiring appropriate
  permissions instead of retrying with sudo.
- Missing tools (`systemctl`, `journalctl`, `ss`, `docker`): degrade gracefully
  and show which checks were skipped.
- SSH disconnect mid-run: mark report failed with collected partial evidence.

## Non-Goals

- No autonomous repair in MVP.
- No cron/daemon background monitoring in MVP.
- No Windows server diagnostics in MVP.
- No Kubernetes diagnostics in MVP.
- No broad log ingestion, full filesystem scan, or continuous AIOps pipeline.
- No cloud sync of reports.

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

Frontend:

- `npm run build`
- UI manual checks:
  - connected SSH session shows Rescue entry.
  - disconnected/non-SSH tab blocks diagnosis.
  - progress updates render.
  - final report has summary, evidence, suggestions.
  - "insert command" places text into terminal input without executing it.

Full verification:

- `cd src-tauri; cargo check`
- `npm run build`
- `npm run smoke:check` if available.

## MVP Acceptance Criteria

- From a connected Linux SSH tab, user can run a diagnosis and receive a report.
- Report includes at least one evidence-backed finding when disk, memory,
  service, port, or Docker sample outputs indicate a problem.
- No mutating command is executed by the rescue workflow.
- All remote probes have timeouts and output caps.
- Missing permissions/tools do not fail the entire diagnosis.
- Suggestions are explicit about risk and are inspectable before use.
- The feature remains useful without configuring an LLM.
