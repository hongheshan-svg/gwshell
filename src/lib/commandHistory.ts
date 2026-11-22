import { invoke } from '@tauri-apps/api/core';
import type { CommandTable } from './commandDictionary';
import { commandNames } from './commandLine';

export interface HistoryEntry {
  command: string;
  cwd: string;
  scope: string;
  session_type: string;
  count: number;
  last_used: number; // unix seconds
}

export interface SuggestCtx {
  scope?: string;
  cwd?: string;
  sessionType?: string;
  table?: CommandTable;
}

// Aggregated entries loaded from the backend, plus in-session appends.
let entries: HistoryEntry[] = [];

// Lower-cased program name -> how many times it was run, across all history.
// Built lazily, updated incrementally by record(), dropped by init().
let usageCache: Map<string, number> | null = null;

// Soft cap on the in-memory entry list. `record` merges duplicates but a long
// session with many distinct commands would otherwise grow `entries` without
// bound, making getSuggestions() slower on every keystroke. When the cap is
// hit the oldest entries (lowest last_used) are trimmed first.
const MAX_ENTRIES = 5000;

// Monotonic sequence for init(): if two in-flight inits interleave (App load +
// settings save), only the most recent one's result is kept — a late-resolving
// older init can't overwrite a newer one's entries.
let initSeq = 0;

export async function init(limit: number): Promise<void> {
  const seq = ++initSeq;
  try {
    const result = await invoke<HistoryEntry[]>('get_command_history', { limit });
    // Stale: a newer init was started after this one — discard our result.
    if (seq !== initSeq) return;
    // One-time scrub of any legacy rows recorded before secret-filtering
    // existed (the backend doesn't filter). Doing it here means the hot path
    // in getSuggestions doesn't have to run containsSecret on every candidate
    // on every keystroke.
    entries = result.filter((e) => !containsSecret(e.command));
    usageCache = null;
  } catch {
    if (seq === initSeq) {
      entries = [];
      usageCache = null;
    }
  }
}

// Heuristics for command lines that carry a secret inline (password/token/key).
// Such lines must never be persisted to history or surfaced as a completion —
// doing so would leak the secret. Unlike a redaction approach, dropping the
// whole line keeps history re-runnable (a "-p***" suggestion would not run).
const SECRET_FLAG_RE =
  /--(?:password|passwd|pwd|token|secret|api[-_]?key|access[-_]?key|secret[-_]?key|auth[-_]?token|client[-_]?secret|private[-_]?key)(?:[=\s]+\S+)/i;
const SECRET_ENV_RE =
  /(?:^|\s)[A-Za-z_][A-Za-z0-9_]*(?:PASS(?:WORD|WD)?|SECRET|TOKEN|APIKEY|API_KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIALS?)[A-Za-z0-9_]*\s*=\s*\S+/i;
// Known secret-bearing env vars whose names don't contain a generic keyword
// (e.g. MYSQL_PWD — "PWD" alone is excluded to avoid matching $PWD/$OLDPWD).
const SECRET_KNOWN_ENV_RE = /(?:^|\s)(?:MYSQL_PWD|MARIADB_PWD|PGPASSWORD|REDISCLI_AUTH)\s*=\s*\S+/i;
// user:password@host (URLs, git remotes, curl). Excludes scp's user@host:path
// (no colon before '@') and SSH git URLs (colon comes after '@').
const SECRET_URLCRED_RE = /\b[\w.+-]+:[^\s:@/]{2,}@[\w.-]+/;
const SECRET_HEADER_RE = /authorization:\s*\S+/i;
const SECRET_BEARER_RE = /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/i;
// `pass=...` / `passin=...` / `passout=...` (openssl). Gated to a minimum value
// length (8) so trivial assignments like `pass=1` or `echo pass=word` aren't
// falsely treated as secret-bearing — those are common harmless variable names.
const SECRET_PASSARG_RE = /\bpass(?:in|out)?[=:]\S{8,}/i;
// Well-known token shapes.
const SECRET_TOKEN_RES: RegExp[] = [
  /\bgh[oprsu]_[A-Za-z0-9]{20,}\b/, // GitHub
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/, // Slack
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+\b/, // JWT
];

export function containsSecret(line: string): boolean {
  const s = line.trim();
  if (!s) return false;

  // Command-specific inline password flags (-p<pw> for mysql, -a <pw> for redis,
  // sshpass -p). Gated by the program name to avoid false positives on overloaded
  // flags like `mkdir -p`, `ssh -p22`, `cp -p`.
  const prog = (s.split(/\s+/)[0]?.split(/[\\/]/).pop() ?? '').toLowerCase();
  if (/^(?:mysql|mysqldump|mariadb|mysqladmin)$/.test(prog) && /\s-p\S/.test(s)) return true;
  if (prog === 'redis-cli' && /\s-a\s*\S/.test(s)) return true;
  if (prog === 'sshpass' && /\s-p/.test(s)) return true;

  if (SECRET_FLAG_RE.test(s)) return true;
  if (SECRET_ENV_RE.test(s)) return true;
  if (SECRET_KNOWN_ENV_RE.test(s)) return true;
  if (SECRET_URLCRED_RE.test(s)) return true;
  if (SECRET_HEADER_RE.test(s)) return true;
  if (SECRET_BEARER_RE.test(s)) return true;
  if (SECRET_PASSARG_RE.test(s)) return true;
  return SECRET_TOKEN_RES.some((re) => re.test(s));
}

export function record(command: string, ctx: SuggestCtx = {}): void {
  // Never persist a command that carries an inline secret.
  if (containsSecret(command)) return;

  const now = Math.floor(Date.now() / 1000);
  const cwd = ctx.cwd ?? '';
  const scope = ctx.scope ?? '';
  const sessionType = ctx.sessionType ?? '';

  // Merge by (command, scope, cwd): a repeat of the same command in the same
  // context bumps count + last_used and moves it to the end (most-recent),
  // instead of appending a duplicate that bloats the list and the suggestion
  // scan. This keeps entries bounded by distinct (command, scope, cwd) tuples.
  const idx = entries.findIndex((e) => e.command === command && e.scope === scope && e.cwd === cwd);
  if (idx >= 0) {
    const existing = entries[idx];
    existing.count += 1;
    existing.last_used = now;
    entries.splice(idx, 1);
    entries.push(existing);
  } else {
    entries.push({
      command,
      cwd,
      scope,
      session_type: sessionType,
      count: 1,
      last_used: now,
    });
  }

  // Trim oldest when over the soft cap. Use a single O(n) min-last_used scan
  // instead of a full sort — record runs on every Enter, so at steady state
  // (entries.length == MAX_ENTRIES) every distinct command would otherwise
  // trigger an O(n log n) sort on the main thread.
  if (entries.length > MAX_ENTRIES) {
    let minIdx = 0;
    let minVal = entries[0].last_used;
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].last_used < minVal) {
        minVal = entries[i].last_used;
        minIdx = i;
      }
    }
    entries.splice(minIdx, 1);
  }

  // Keep the usage counts current without a full rebuild on every Enter.
  if (usageCache) {
    for (const name of commandNames(command)) {
      const k = name.toLowerCase();
      usageCache.set(k, (usageCache.get(k) ?? 0) + 1);
    }
  }

  invoke('save_command_history', {
    command,
    cwd,
    scope,
    sessionType,
  }).catch(() => {});
}

const DAY = 86400;
// 1.0 right now, ~0.5 after a week, asymptotes toward 0.
function recencyDecay(ageSec: number): number {
  return 1 / (1 + Math.max(0, ageSec) / (7 * DAY));
}

function isCaseInsensitive(table: CommandTable | undefined): boolean {
  return table === 'cmd' || table === 'powershell';
}

/**
 * Ranked full-command candidates that extend `prefix` (best first), max 8.
 *
 * Matching follows the shell: case-sensitive for unix, case-insensitive for
 * cmd/PowerShell (where `get-c` should find `Get-ChildItem`, and two spellings
 * of the same command count as one). Commands from the current host always
 * rank above commands from other hosts; within each group the score is
 * frequency × recency, plus a bonus for the current directory.
 */
export function getSuggestions(prefix: string, ctx: SuggestCtx = {}): string[] {
  if (!prefix) return [];
  const ci = isCaseInsensitive(ctx.table);
  const p = ci ? prefix.toLowerCase() : prefix;
  const now = Math.floor(Date.now() / 1000);
  const best = new Map<string, { command: string; local: boolean; score: number }>();
  for (const e of entries) {
    if (e.command.length <= prefix.length) continue;
    const key = ci ? e.command.toLowerCase() : e.command;
    if (!key.startsWith(p)) continue;
    // Secret scrubbing is done once at init() and at record() time, so the
    // hot path here doesn't re-run containsSecret on every candidate.
    const local = !!ctx.scope && e.scope === ctx.scope;
    let score = Math.log2(e.count + 1) * recencyDecay(now - e.last_used);
    if (local && ctx.cwd && e.cwd === ctx.cwd) score += 1;
    const prev = best.get(key);
    if (!prev || (local && !prev.local) || (local === prev.local && score > prev.score)) {
      best.set(key, { command: e.command, local, score });
    }
  }
  return [...best.values()]
    .sort((a, b) => Number(b.local) - Number(a.local) || b.score - a.score)
    .slice(0, 8)
    .map((c) => c.command);
}

/**
 * How often each program has been run (keys lower-cased), counting every
 * command-position word, so `sudo docker ps | grep x` counts sudo, docker and
 * grep. Used to rank command-dictionary suggestions by personal usage.
 */
export function commandUsage(): Map<string, number> {
  if (usageCache) return usageCache;
  const m = new Map<string, number>();
  for (const e of entries) {
    for (const name of commandNames(e.command)) {
      const k = name.toLowerCase();
      m.set(k, (m.get(k) ?? 0) + e.count);
    }
  }
  usageCache = m;
  return m;
}
