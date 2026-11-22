import { lookupCommands } from './commandDictionary';
import { commandUsage, getSuggestions, type SuggestCtx } from './commandHistory';
import { commandWordAt } from './commandLine';

export type CompletionKind = 'history' | 'command';

export interface Completion {
  text: string; // full line text to complete to (replaces the current line)
  kind: CompletionKind;
  desc?: string; // localized description (command kind only)
}

// A one-letter command prefix matches dozens of dictionary entries that are
// mostly noise; history (which is personal) is still offered from one letter.
const DICT_MIN_CHARS = 2;

/**
 * Merge history suggestions (ranked, full-line) with dictionary commands.
 *
 * History ranks first. Dictionary commands are offered for the word in command
 * position — at the start of the line, or after `|`, `&&`, `;`, `sudo` … — and
 * their text is the whole line with that word completed, so accepting always
 * appends `text.slice(line.length)`. They are ordered by how often the user
 * runs them, then shorter first. Up to half the slots are kept for them, and
 * any they don't use go to history. Capped at `max`.
 */
export function buildCompletions(
  line: string,
  ctx: SuggestCtx,
  locale: 'en' | 'zh',
  max = 8,
): Completion[] {
  if (!line) return [];
  const ci = ctx.table === 'cmd' || ctx.table === 'powershell';
  const key = (s: string) => (ci ? s.toLowerCase() : s);

  let dict: Completion[] = [];
  const word = commandWordAt(line);
  if (word && word.word.length >= DICT_MIN_CHARS) {
    const usage = commandUsage();
    const head = line.slice(0, word.start);
    dict = lookupCommands(word.word, locale, ctx.table ?? 'unix')
      .map((d, i) => ({ d, i, uses: usage.get(d.cmd.toLowerCase()) ?? 0 }))
      .sort((a, b) => b.uses - a.uses || a.d.cmd.length - b.d.cmd.length || a.i - b.i)
      .map(({ d }): Completion => ({ text: head + d.cmd, kind: 'command', desc: d.desc }));
  }

  const dictSlots = Math.min(dict.length, max, Math.max(2, Math.floor(max / 2)));
  const historyBudget = max - dictSlots;

  // Dedupe by text. History stores full command lines (e.g. 'ls -al'); the
  // dictionary offers bare commands (e.g. 'ls'). They collide only when a
  // history entry IS the bare command, and then history wins.
  const out: Completion[] = [];
  const seen = new Set<string>();
  for (const cmd of getSuggestions(line, ctx)) {
    if (out.length >= historyBudget) break;
    if (seen.has(key(cmd))) continue;
    seen.add(key(cmd));
    out.push({ text: cmd, kind: 'history' });
  }
  for (const c of dict) {
    if (out.length >= max) break;
    if (seen.has(key(c.text))) continue;
    seen.add(key(c.text));
    out.push(c);
  }
  return out;
}
