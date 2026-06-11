# System-Aware Command Completion Tables — Design

Date: 2026-06-11
Status: Approved (design), pending spec review

## Goal

The command-completion dropdown currently feeds the **same Linux/Unix command
dictionary** (`ls`, `cat`, `grep`, …) into every session, regardless of the
connected system. On a local Windows **CMD** or **PowerShell** session — and on
SSH connections to Windows hosts — this suggests commands that don't exist in
that shell.

Make the built-in dictionary **system-aware**: maintain three command tables and
select the right one based on the connected system, detected automatically where
possible and overridable where it isn't.

## Current state (what we're changing)

- `src/lib/commandDictionary.ts` — a single `COMMAND_DEFS: CommandDef[]` array of
  ~120 Linux/Unix commands with bilingual (en/zh) descriptions.
  `lookupCommands(prefix, locale)` prefix-matches the command name against that
  one array. **No notion of OS / shell.**
- `src/lib/completion.ts` — `buildCompletions(line, ctx, locale, max)` merges
  ranked command-**history** suggestions with dictionary commands. `ctx`
  (`SuggestCtx`) already carries `scope`, `cwd`, and `sessionType`.
- `src/components/Terminal/TerminalView.tsx` — already calls
  `buildCompletions(buf, { scope, cwd, sessionType }, locale)` where
  `sessionType = tab.type` (`ssh | localshell | docker | serial`). The plumbing
  for context is present; the dictionary just ignores it.
- Local-shell kind is known precisely: `SessionConfig.shell_name` holds `cmd`,
  `powershell`, `powershell7`, `bash`, `gitbash`, `wsl-*`, `zsh`, `fish`, etc.
  (resolved in `src-tauri/src/pty.rs`).
- SSH has **no remote-OS detection** today.
- Sessions persist as a JSON blob: `sessions(id TEXT, data TEXT)` in SQLite
  (`src-tauri/src/database.rs`), serialized from `SessionConfig`
  (`src-tauri/src/session.rs`). Adding an optional field needs **no migration**.
- `src-tauri/src/ssh/mod.rs` exposes `SshManager::ssh_exec(session_id, command)`
  (one-shot remote exec), already used by the metrics poller.

## Decisions (from clarification)

- **Scope:** local shells **and** SSH. Docker/serial keep the Unix table.
- **Tables:** three — `unix` (existing), `cmd`, `powershell`.
- **SSH detection:** active one-shot exec probe at connect **plus** an optional
  per-asset manual override (default Auto). Fall back to `unix` until/if the
  probe resolves or on any failure.

## Core concept: `CommandTable`

```ts
type CommandTable = 'unix' | 'cmd' | 'powershell';
```

- `unix` covers Linux, macOS (`Darwin`), and BSD — they share POSIX tooling.
- `unix` is the universal fallback; when nothing is known we behave exactly as
  today.

## Architecture

### 1. Three tables — `src/lib/commandDictionary.ts`

Restructure the single array into three pre-sorted arrays of the existing
`CommandDef` shape (`{ cmd, en, zh }`):

- **`UNIX_DEFS`** — the current ~120 entries, unchanged.
- **`CMD_DEFS`** — Windows CMD builtins/utilities: `dir`, `copy`, `xcopy`,
  `robocopy`, `move`, `ren`, `del`, `erase`, `type`, `cd`, `chdir`, `cls`, `md`,
  `mkdir`, `rd`, `rmdir`, `tree`, `attrib`, `find`, `findstr`, `where`, `fc`,
  `comp`, `more`, `set`, `setx`, `echo`, `ipconfig`, `ping`, `tracert`,
  `pathping`, `netstat`, `nslookup`, `route`, `arp`, `net`, `sc`, `tasklist`,
  `taskkill`, `systeminfo`, `hostname`, `whoami`, `ver`, `chkdsk`, `sfc`,
  `diskpart`, `shutdown`, `assoc`, `ftype`, `reg`, `schtasks`, `wmic`, `cmd`,
  `exit`, `cls`. Bilingual descriptions.
- **`POWERSHELL_DEFS`** — common cmdlets **and** the Unix-style aliases that
  genuinely resolve in PowerShell:
  - Cmdlets: `Get-ChildItem`, `Get-Content`, `Set-Content`, `Get-Location`,
    `Set-Location`, `Copy-Item`, `Move-Item`, `Remove-Item`, `New-Item`,
    `Rename-Item`, `Get-Process`, `Stop-Process`, `Get-Service`,
    `Start-Service`, `Stop-Service`, `Restart-Service`, `Select-String`,
    `Where-Object`, `ForEach-Object`, `Select-Object`, `Sort-Object`,
    `Measure-Object`, `Get-Item`, `Test-Path`, `Test-Connection`,
    `Invoke-WebRequest`, `Invoke-RestMethod`, `Get-Help`, `Get-Command`,
    `Get-Member`, `Write-Output`, `Write-Host`, `Out-File`, `Clear-Host`,
    `Get-Date`, `Get-NetIPAddress`, `Get-NetTCPConnection`.
  - Aliases (work in PowerShell): `ls`, `dir`, `gci`, `cat`, `gc`, `cp`, `cpi`,
    `mv`, `mi`, `rm`, `ri`, `pwd`, `gl`, `cd`, `sl`, `cls`, `clear`, `echo`,
    `select`, `where`, `sort`, `ps`, `kill`.
  Bilingual descriptions.

Update the lookup signature (sorting done once per array at module load):

```ts
function lookupCommands(
  prefix: string,
  locale: 'en' | 'zh',
  table: CommandTable = 'unix',
): { cmd: string; desc: string }[]
```

The default `'unix'` keeps any existing caller / test that omits the argument
working. `COMMAND_DEFS` may be retained as an alias of `UNIX_DEFS` if needed for
backward compatibility with `scripts/test-completion.mjs`.

### 2. Thread the table through completion — `src/lib/completion.ts`

Extend the merge so the dictionary receives the table. Either add `table` to the
`SuggestCtx` passed in (the `ctx` already flows here) or add it as an explicit
`buildCompletions` parameter; the `ctx`-field approach keeps the call site tidy:

```ts
buildCompletions(line, { scope, cwd, sessionType, table }, locale, max)
// internally: lookupCommands(line, locale, ctx.table ?? 'unix')
```

History suggestions are **unchanged** and are **not** filtered by table — they
are the user's own command lines, already scoped by host/session. Only the
built-in dictionary becomes system-aware.

### 3. Per-tab table selection — `src/components/Terminal/TerminalView.tsx`

Compute the table for each tab:

- **localshell** — from `session.shell_name`:
  - `cmd` → `cmd`
  - `powershell` | `powershell7` → `powershell`
  - everything else (`bash`, `gitbash`, `zsh`, `fish`, `wsl-*`, undefined) →
    `unix`
- **docker**, **serial** → `unix`
- **ssh** — manual override if concrete; else the probe result; else `unix`
  (fallback while the probe is in flight or if it fails)

A per-tab map (e.g. `tabCommandTable: Map<string, CommandTable>`) holds the
resolved value, consistent with the existing out-of-React per-tab maps.

### 4. SSH manual override — `SessionConfig.remote_shell`

New optional field:

```ts
remote_shell?: 'auto' | 'linux' | 'cmd' | 'powershell'   // default: auto
```

- TS: add to `SessionConfig` in `src/types/index.ts`.
- Rust: add to `SessionConfig` in `src-tauri/src/session.rs` with
  `#[serde(default)]` so existing persisted records deserialize. No DB migration
  (JSON blob).
- UI: a select in `src/components/Modals/NewSessionModal.tsx` (SSH advanced
  section), default **Auto**. Options: Auto / Linux / CMD / PowerShell.
- Mapping to `CommandTable`: `linux` → `unix`; `cmd` → `cmd`; `powershell` →
  `powershell`; `auto`/unset → probe.

### 5. SSH probe (backend) + event

When an SSH session's shell is established and `remote_shell` is `auto`/unset,
the backend runs a short, quiet detection sequence via `ssh_exec` on its own
exec channel (so it never touches the interactive terminal), each step with a
few-second timeout:

1. `uname -s` — if stdout matches a known kernel (`Linux`, `Darwin`, `FreeBSD`,
   `OpenBSD`, `NetBSD`, `SunOS`, `AIX`, …) ⇒ `unix`. Done.
2. Otherwise assume Windows; run `echo %COMSPEC%`:
   - output contains `cmd.exe` (variable expanded by CMD) ⇒ `cmd`
   - otherwise (PowerShell echoes the literal `%COMSPEC%`) ⇒ `powershell`
3. Timeout / empty / ambiguous / error ⇒ remain `unix`.

> Risk note: step 2 is a heuristic. The `unix` fallback and the manual override
> bound the blast radius of a misclassification.

The backend emits a Tauri event:

```
ssh-os-{session_id}  →  { table: CommandTable, source: 'probe' | 'override' }
```

When the override is concrete, the backend may emit immediately with
`source:'override'` (or the frontend may resolve it directly from the session
config without waiting). The probe only runs for `auto`/unset.

Implementation lands in `src-tauri/src/ssh/` (a small probe helper invoked from
the connect flow) and `src-tauri/src/lib.rs` (event emission), following the
existing `server-metrics-{id}` event pattern.

## Data flow

1. SSH connects; interactive shell session opens (unchanged).
2. Backend resolves the table: concrete override → emit immediately; else run
   the probe → emit result. Always defaulting to `unix` on failure.
3. `TerminalView` listens for `ssh-os-{id}`, stores the value in
   `tabCommandTable`. Local/docker/serial tabs set their table synchronously at
   tab creation (no event needed).
4. On each keystroke, `buildCompletions(buf, { scope, cwd, sessionType, table },
   locale)` runs; the dictionary half uses the resolved table.

## i18n

`src/i18n/locales/gwshell.en.json` and `gwshell.zh.json` (namespace `gwshell`)
gain keys for the override field label and its four options (Auto / Linux / CMD
/ PowerShell), added **key-for-key in both files**.

## Files

- **Modify** `src/lib/commandDictionary.ts` — split into `UNIX_DEFS` /
  `CMD_DEFS` / `POWERSHELL_DEFS`; `lookupCommands` gains a `table` param.
- **Modify** `src/lib/completion.ts` — thread `table` to `lookupCommands`.
- **Modify** `src/lib/commandHistory.ts` — add optional `table` to `SuggestCtx`
  (if the ctx-field approach is used).
- **Modify** `src/components/Terminal/TerminalView.tsx` — per-tab table
  computation; `ssh-os-{id}` listener; `tabCommandTable` map; pass `table` into
  `buildCompletions`.
- **Modify** `src/types/index.ts` — `remote_shell` on `SessionConfig`.
- **Modify** `src/components/Modals/NewSessionModal.tsx` — Remote-shell override
  select.
- **Modify** `src-tauri/src/session.rs` — `remote_shell` field
  (`#[serde(default)]`).
- **Modify** `src-tauri/src/ssh/` (probe helper + connect flow) and
  `src-tauri/src/lib.rs` — run probe, emit `ssh-os-{id}`.
- **Modify** `src/i18n/locales/gwshell.{en,zh}.json` — override field strings.
- **Verify** `scripts/test-completion.mjs` — keep green against the new
  `lookupCommands` signature / table split.

## Testing

- `npm run smoke:check` (static) and `npm run build` (type-check) must pass.
- Manual in `npm run tauri dev`:
  - Local **CMD**: typing `d` shows `dir`/`del`, not `ls`/`cat`.
  - Local **PowerShell**: `g` shows `Get-*` cmdlets; `ls`/`cat` aliases present.
  - Local **bash / Git Bash / WSL**: unchanged (Unix table).
  - **SSH → Linux**: unchanged (Unix table).
  - **SSH → Windows**: dropdown flips to CMD/PowerShell shortly after connect.
  - **Manual override** (Linux/CMD/PowerShell) forces the table and skips the
    probe.
  - Probe failure / unreachable: falls back to Unix without errors in the
    terminal.

## Non-goals (YAGNI)

- No argument / flag / sub-command completion.
- No filtering of command **history** by OS/table.
- No per-distro package-manager tailoring (apt vs yum vs dnf).
- No OS detection for docker/serial (always `unix`).
- No fuzzy matching (prefix match only, as today).
