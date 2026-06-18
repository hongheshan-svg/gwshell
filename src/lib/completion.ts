import { lookupCommands } from './commandDictionary';
import { getSuggestions, type SuggestCtx } from './commandHistory';

export type CompletionKind = 'history' | 'command';

export interface Completion {
  text: string; // full line text to complete to (replaces the current line)
  kind: CompletionKind;
  desc?: string; // localized description (command kind only)
}

/**
 * Merge history suggestions (ranked, full-line) with dictionary commands.
 * History ranks first; dictionary commands follow, deduped by text. Dictionary
 * is consulted only while the user is still typing the command name (no
 * whitespace in the line). Capped at `max`.
 */
export function buildCompletions(
  line: string,
  ctx: SuggestCtx,
  locale: 'en' | 'zh',
  max = 8,
): Completion[] {
  if (!line) return [];
  const out: Completion[] = [];
  // Dedupe by exact text. History stores full command lines (e.g. 'ls -al');
  // the dictionary stores bare command names (e.g. 'ls'). They collide only when a
  // history entry IS a bare command, so both a full invocation and the bare command
  // can legitimately appear together — that is intended.
  const seen = new Set<string>();

  // Reserve roughly half the slots for dictionary commands so standard commands
  // (docker, df, du, …) aren't entirely squeezed out when history already fills
  // the list. Dictionary is only consulted while typing the command name.
  const dictBudget = /\s/.test(line) ? 0 : Math.max(2, Math.floor(max / 2));
  const historyBudget = max - dictBudget;

  let histCount = 0;
  for (const cmd of getSuggestions(line, ctx)) {
    if (seen.has(cmd)) continue;
    seen.add(cmd);
    out.push({ text: cmd, kind: 'history' });
    histCount += 1;
    if (histCount >= historyBudget) break;
  }

  if (dictBudget > 0) {
    for (const { cmd, desc } of lookupCommands(line, locale, ctx.table ?? 'unix')) {
      if (seen.has(cmd)) continue;
      seen.add(cmd);
      out.push({ text: cmd, kind: 'command', desc });
      if (out.length >= max) break;
    }
  }

  return out;
}
