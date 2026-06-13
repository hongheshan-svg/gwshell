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

export async function init(limit: number): Promise<void> {
  try {
    entries = await invoke<HistoryEntry[]>('get_command_history', { limit });
  } catch {
    entries = [];
  }
}

export function record(command: string, ctx: SuggestCtx = {}): void {
  const now = Math.floor(Date.now() / 1000);
  entries.push({
    command,
    cwd: ctx.cwd ?? '',
    scope: ctx.scope ?? '',
    session_type: ctx.sessionType ?? '',
    count: 1,
    last_used: now,
  });
  invoke('save_command_history', {
    command,
    cwd: ctx.cwd ?? '',
    scope: ctx.scope ?? '',
    sessionType: ctx.sessionType ?? '',
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

