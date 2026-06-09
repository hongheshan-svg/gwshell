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
  const seen = new Set<string>();

  for (const cmd of getSuggestions(line, ctx)) {
    if (seen.has(cmd)) continue;
    seen.add(cmd);
    out.push({ text: cmd, kind: 'history' });
    if (out.length >= max) return out;
  }

  if (!/\s/.test(line)) {
    for (const { cmd, desc } of lookupCommands(line, locale)) {
      if (seen.has(cmd)) continue;
      seen.add(cmd);
      out.push({ text: cmd, kind: 'command', desc });
      if (out.length >= max) return out;
    }
  }

  return out;
}
