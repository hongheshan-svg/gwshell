// src/lib/commandLine.ts
// Approximate shell-line tokenizer for completion. It finds the words that sit
// in "command position" (where a program name goes): at the start of the line,
// after a control operator (`|`, `||`, `&&`, `;`, `&`, `(`, `$(`, backtick) and
// after a wrapper such as `sudo`. The command dictionary uses this to complete
// `sudo sys` or `ps aux | gr`, and history uses it to count per-program usage.
//
// It understands whitespace, single/double quotes, backslash escapes, the
// common control operators and `2>&1`-style redirections. It is not a shell
// parser: anything it can't classify is simply not treated as a command name.

// Words that run the command that follows them. Only the option-less form is
// recognised (`sudo docker`, not `sudo -u root docker`).
const WRAPPERS = new Set([
  'sudo',
  'doas',
  'time',
  'nohup',
  'nice',
  'watch',
  'exec',
  'command',
  'builtin',
  'env',
]);
// `FOO=1 make` — leading assignments keep the next word in command position.
const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
// Characters a completable command name may contain.
const COMMAND_WORD_RE = /^[A-Za-z0-9_.+-]*$/;
const OPERATOR_CHARS = '|&;()`';

interface Token {
  kind: 'word' | 'op';
  text: string;
  start: number;
  end: number;
  /** For words: whether the word sat in command position. */
  commandPos?: boolean;
}

function isRedirectAmp(line: string, i: number): boolean {
  // `>&`, `<&` (fd duplication) and `&>` (redirect both) are redirections,
  // not the background operator.
  return line[i - 1] === '>' || line[i - 1] === '<' || line[i + 1] === '>';
}

function tokenize(line: string): { tokens: Token[]; openQuote: boolean } {
  const tokens: Token[] = [];
  const n = line.length;
  let i = 0;
  while (i < n) {
    const c = line[i];
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }
    if (c === '$' && line[i + 1] === '(') {
      tokens.push({ kind: 'op', text: '$(', start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (OPERATOR_CHARS.includes(c) && !(c === '&' && isRedirectAmp(line, i))) {
      let j = i + 1;
      if ((c === '|' || c === '&') && line[j] === c) j++;
      else if (c === '|' && line[j] === '&') j++;
      tokens.push({ kind: 'op', text: line.slice(i, j), start: i, end: j });
      i = j;
      continue;
    }
    const start = i;
    let quote: string | null = null;
    while (i < n) {
      const ch = line[i];
      if (quote) {
        if (ch === quote) quote = null;
        else if (ch === '\\' && quote === '"') i++;
        i++;
        continue;
      }
      if (ch === "'" || ch === '"') {
        quote = ch;
        i++;
        continue;
      }
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === ' ' || ch === '\t' || (ch === '$' && line[i + 1] === '(')) break;
      if (OPERATOR_CHARS.includes(ch) && !(ch === '&' && isRedirectAmp(line, i))) break;
      i++;
    }
    const end = Math.min(i, n);
    tokens.push({ kind: 'word', text: line.slice(start, end), start, end });
    if (quote) return { tokens, openQuote: true };
  }
  return { tokens, openQuote: false };
}

interface Walked {
  tokens: Token[];
  openQuote: boolean;
  /** Whether a word typed after the last token would be in command position. */
  expectCommand: boolean;
}

function walk(line: string): Walked {
  const { tokens, openQuote } = tokenize(line);
  let expectCommand = true;
  let afterWrapper = false;
  for (const t of tokens) {
    if (t.kind === 'op') {
      expectCommand = t.text !== ')';
      afterWrapper = false;
      continue;
    }
    t.commandPos = expectCommand && !(afterWrapper && t.text.startsWith('-'));
    if (!t.commandPos) {
      expectCommand = false;
      afterWrapper = false;
      continue;
    }
    if (ASSIGNMENT_RE.test(t.text)) continue;
    if (WRAPPERS.has(t.text)) {
      afterWrapper = true;
      continue;
    }
    expectCommand = false;
    afterWrapper = false;
  }
  return { tokens, openQuote, expectCommand };
}

/**
 * The word being typed at the end of `line`, if it is in command position.
 * Returns its start offset and text (possibly empty right after an operator or
 * a trailing space), or null when the cursor is in an argument, inside a
 * quote, or on a word that can't be a plain command name.
 */
export function commandWordAt(line: string): { start: number; word: string } | null {
  const { tokens, openQuote, expectCommand } = walk(line);
  if (openQuote) return null;
  const last = tokens[tokens.length - 1];
  if (!last || last.kind === 'op' || last.end < line.length) {
    return expectCommand ? { start: line.length, word: '' } : null;
  }
  if (!last.commandPos || !COMMAND_WORD_RE.test(last.text)) return null;
  return { start: last.start, word: last.text };
}

/** Every program name in a full command line (wrappers included), in order. */
export function commandNames(line: string): string[] {
  const { tokens } = walk(line);
  const out: string[] = [];
  for (const t of tokens) {
    if (t.kind === 'word' && t.commandPos && !ASSIGNMENT_RE.test(t.text)) {
      if (COMMAND_WORD_RE.test(t.text) && t.text) out.push(t.text);
    }
  }
  return out;
}
