import { invoke } from '@tauri-apps/api/core';
import type { CommandTable } from './commandDictionary';

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
    entries = result;
  } catch {
    if (seq === initSeq) entries = [];
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
const SECRET_KNOWN_ENV_RE =
  /(?:^|\s)(?:MYSQL_PWD|MARIADB_PWD|PGPASSWORD|REDISCLI_AUTH)\s*=\s*\S+/i;
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
  const idx = entries.findIndex(
    (e) => e.command === command && e.scope === scope && e.cwd === cwd,
  );
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
      if (entries[i].last_used < minVal) { minVal = entries[i].last_used; minIdx = i; }
    }
    entries.splice(minIdx, 1);
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

// Returns ranked full-command candidates (highest score first), max 8.
export function getSuggestions(prefix: string, ctx: SuggestCtx = {}): string[] {
  if (!prefix) return [];
  const now = Math.floor(Date.now() / 1000);
  const best = new Map<string, number>(); // command -> best score
  for (const e of entries) {
    if (!e.command.startsWith(prefix) || e.command.length <= prefix.length) continue;
    // Defensive: legacy rows recorded before secret-scrubbing existed may carry
    // inline secrets. Filter them out of suggestions (cheap: only candidates that
    // already match the prefix are checked).
    if (containsSecret(e.command)) continue;
    let score = Math.log2(e.count + 1) * recencyDecay(now - e.last_used);
    if (ctx.scope && e.scope === ctx.scope) score += 2;
    if (ctx.cwd && e.cwd === ctx.cwd) score += 1;
    const prev = best.get(e.command);
    if (prev === undefined || score > prev) best.set(e.command, score);
  }
  return [...best.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([cmd]) => cmd);
}

