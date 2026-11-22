// src/lib/inputLineTracker.ts
// Tracks the command line the user is typing, from the keystrokes sent to the
// shell (xterm onData). The tracked text drives completions and is what gets
// recorded as command history on Enter, so it must never drift from what the
// shell actually has: a wrong line recorded once is suggested forever after.
//
// The shell owns the real line, and keys like Tab, ↑ or Ctrl+R let it rewrite
// the line in ways keystrokes alone can't reproduce. So each line is in one of
// three states:
//   tracked  the buffer matches the line exactly (cursor at the end).
//   resync   the shell changed the line but the cursor is still at the end
//            (Tab completion, ↑ history recall, accepting an autosuggestion).
//            The text is re-read from the screen, between the cell where the
//            line started (anchor) and the cursor, before the next use.
//   unknown  the cursor moved or the line was edited unpredictably. Nothing
//            is suggested or recorded until the line ends.

/** Absolute buffer position: row = baseY + cursorY. */
export interface CellPos {
  row: number;
  col: number;
}

export type LineState = 'tracked' | 'resync' | 'unknown';

export interface LineTracker {
  buf: string;
  state: LineState;
  /** Where the line's first character went; null when unknown (e.g. after Ctrl+L). */
  anchor: CellPos | null;
  /** buf at the moment the line stopped being tracked, used to validate a resync. */
  stalePrefix: string;
  inPaste: boolean;
  pasteBuf: string;
}

export interface TrackerEnv {
  /** Current cursor position. onData runs before the key is echoed. */
  cursor(): CellPos;
  /** Screen text from `from` (inclusive) to `to` (exclusive), or null if unreadable. */
  readLine(from: CellPos, to: CellPos): string | null;
  /** Windows shells (cmd/PowerShell) compare case-insensitively. */
  caseInsensitive: boolean;
  /** Full-screen programs (vim, less, top) run on the alternate screen. */
  alternateScreen: boolean;
}

export interface InputResult {
  /** show: recompute completions; hide: close them; none: leave as is. */
  effect: 'show' | 'hide' | 'none';
  /** The line the user submitted with Enter, when it is reliable and should be recorded. */
  submitted?: string;
}

export function createLineTracker(): LineTracker {
  return { buf: '', state: 'tracked', anchor: null, stalePrefix: '', inPaste: false, pasteBuf: '' };
}

function resetLine(t: LineTracker): void {
  t.buf = '';
  t.state = 'tracked';
  t.anchor = null;
  t.stalePrefix = '';
}

function markStale(t: LineTracker, state: 'resync' | 'unknown'): void {
  if (t.state === 'tracked') t.stalePrefix = t.buf;
  if (t.state !== 'unknown') t.state = state;
}

function ensureAnchor(t: LineTracker, env: TrackerEnv): void {
  if (t.anchor === null && t.buf === '' && t.state === 'tracked') t.anchor = env.cursor();
}

/**
 * Bring a resync line back to tracked by reading it from the screen. The read
 * text must keep everything the user had typed before the current word (Tab
 * completion only rewrites the word under the cursor); otherwise the anchor is
 * stale or the screen shows something else, and the line becomes unknown.
 * Returns whether the line is tracked afterwards.
 */
function resync(t: LineTracker, env: TrackerEnv): boolean {
  if (t.state !== 'resync') return t.state === 'tracked';
  const text = t.anchor ? env.readLine(t.anchor, env.cursor()) : null;
  const keep = t.stalePrefix.slice(0, t.stalePrefix.search(/\S*$/));
  const ok =
    text !== null &&
    (env.caseInsensitive
      ? text.toLowerCase().startsWith(keep.toLowerCase())
      : text.startsWith(keep));
  if (!ok) {
    t.state = 'unknown';
    return false;
  }
  t.buf = text;
  t.state = 'tracked';
  t.stalePrefix = '';
  return true;
}

// Keys that may change the line but leave the cursor at its end.
const RESYNC_KEYS = new Set([
  '\t', // shell Tab completion
  '\x1b[A', // ↑ / ↓ history recall (CSI and SS3 / application-cursor forms)
  '\x1bOA',
  '\x1b[B',
  '\x1bOB',
  '\x1b[C', // → / End / Ctrl-E / Ctrl-F: may accept a shell autosuggestion
  '\x1bOC',
  '\x1b[F',
  '\x1bOF',
  '\x1b[4~',
  '\x1b[8~',
  '\x05',
  '\x06',
  '\x1b[3~', // Delete: nothing to delete at the end of the line
  '\x04', // Ctrl+D on a non-empty line: delete-char / list-choices
]);

// eslint-disable-next-line no-control-regex -- C0 control characters are what this matches
const CONTROL_RE = /[\x00-\x1f\x7f]/;

/** Apply one onData chunk to the tracker (mutates it). */
export function applyInput(t: LineTracker, data: string, env: TrackerEnv): InputResult {
  if (env.alternateScreen) {
    resetLine(t);
    t.inPaste = false;
    t.pasteBuf = '';
    return { effect: 'hide' };
  }

  // Bracketed paste: the content can arrive over several chunks.
  if (t.inPaste || data.includes('\x1b[200~')) {
    ensureAnchor(t, env);
    t.inPaste = true;
    const end = data.indexOf('\x1b[201~');
    t.pasteBuf += (end >= 0 ? data.slice(0, end) : data).split('\x1b[200~').join('');
    if (end >= 0) {
      const chunk = t.pasteBuf;
      t.inPaste = false;
      t.pasteBuf = '';
      if (CONTROL_RE.test(chunk)) markStale(t, 'unknown');
      else if (resync(t, env)) t.buf += chunk;
    }
    return { effect: 'hide' };
  }

  if (data === '\r' || data === '\n') {
    resync(t, env);
    const line = t.state === 'tracked' ? t.buf : '';
    resetLine(t);
    // Leading whitespace means "keep this out of history" (bash/zsh ignorespace).
    const submitted = line.trim() && !/^\s/.test(line) ? line : undefined;
    return { effect: 'hide', submitted };
  }

  if (data === '\x03' || data === '\x1a') {
    // Ctrl+C aborts the line; Ctrl+Z suspends whatever was running.
    resetLine(t);
    return { effect: 'hide' };
  }

  if (data === '\x7f' || data === '\b' || data === '\x17') {
    if (!resync(t, env)) return { effect: 'hide' };
    // Backspace deletes one code point (don't split surrogate pairs); Ctrl+W
    // deletes the previous word and the whitespace after it, like readline.
    t.buf =
      data === '\x17' ? t.buf.replace(/\S*\s*$/, '') : Array.from(t.buf).slice(0, -1).join('');
    return { effect: t.buf ? 'show' : 'hide' };
  }

  if (data === '\x15') {
    // Ctrl+U clears the line when the cursor is at its end.
    if (t.state !== 'unknown') {
      t.buf = '';
      t.state = 'tracked';
      t.stalePrefix = '';
    }
    return { effect: 'hide' };
  }

  if (data === '\x0b') {
    // Ctrl+K kills to the end of the line: nothing, when the cursor is there.
    return { effect: 'none' };
  }

  if (data === '\x0c') {
    // Ctrl+L redraws the prompt at the top: the text survives, the anchor doesn't.
    t.anchor = null;
    if (t.state === 'resync') t.state = 'unknown';
    return { effect: 'hide' };
  }

  if (RESYNC_KEYS.has(data)) {
    if (data === '\x04' && t.buf === '' && t.state === 'tracked') return { effect: 'hide' };
    ensureAnchor(t, env);
    markStale(t, 'resync');
    return { effect: 'hide' };
  }

  if (CONTROL_RE.test(data)) {
    if (data.length > 1 && /[\r\n]/.test(data)) {
      // Unbracketed multi-line paste: the shell ran every line but the last,
      // which is now being edited. Track it, but without a known anchor.
      const rest = data.slice(Math.max(data.lastIndexOf('\r'), data.lastIndexOf('\n')) + 1);
      resetLine(t);
      t.buf = rest;
      if (CONTROL_RE.test(rest)) markStale(t, 'unknown');
      return { effect: 'hide' };
    }
    // ←, Home, Ctrl+A/B/R/T/Y, Alt+key, … the cursor may have left the end of
    // the line, or the line changed in a way we can't follow.
    markStale(t, 'unknown');
    return { effect: 'hide' };
  }

  // Printable text: a typed character, an IME commit, or fast typing.
  ensureAnchor(t, env);
  if (!resync(t, env)) return { effect: 'hide' };
  t.buf += data;
  return { effect: 'show' };
}

/** Structural subset of xterm's IBuffer, so tests can pass a fake. */
export interface BufferLike {
  getLine(y: number):
    | {
        isWrapped: boolean;
        translateToString(trim?: boolean, start?: number, end?: number): string;
      }
    | undefined;
}

/**
 * Read the cells from `from` up to (not including) `to`, following soft-wrapped
 * rows. Returns null when the range is backwards, too tall, or crosses a hard
 * line break (a continuation prompt or program output, not the typed line).
 */
export function readBufferRange(
  buffer: BufferLike,
  from: CellPos,
  to: CellPos,
  maxRows = 8,
): string | null {
  if (to.row < from.row || (to.row === from.row && to.col < from.col)) return null;
  if (to.row - from.row >= maxRows) return null;
  let out = '';
  for (let row = from.row; row <= to.row; row++) {
    const line = buffer.getLine(row);
    if (!line || (row > from.row && !line.isWrapped)) return null;
    out += line.translateToString(
      false,
      row === from.row ? from.col : 0,
      row === to.row ? to.col : undefined,
    );
  }
  return out;
}

/**
 * Column for the completion dropdown, so its items line up under the typed
 * line: the line's starting column while the line is on the cursor's row,
 * column 0 once it has wrapped, and the cursor itself when the start is unknown.
 */
export function dropdownColumn(anchor: CellPos | null, cursor: CellPos): number {
  if (!anchor) return cursor.col;
  return anchor.row === cursor.row ? anchor.col : 0;
}
