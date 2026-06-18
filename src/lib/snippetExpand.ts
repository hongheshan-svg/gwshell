// A send plan is an ordered list of segments. `delayMs` segments pause the
// sender; `text` segments are written to the terminal.
export type SendSegment =
  | { kind: 'text'; text: string }
  | { kind: 'delay'; delayMs: number };

// Expands snippet escapes into a send plan:
//   \xNN  -> control byte from two hex digits (e.g. \x03 = Ctrl-C)
//   \sNNN -> delay NNN milliseconds (1-4 digits)
//   \n \r \t \\ -> newline / carriage-return / tab / literal backslash
export function expandSnippet(raw: string): SendSegment[] {
  const segments: SendSegment[] = [];
  let buf = '';
  const flush = () => {
    if (buf) {
      segments.push({ kind: 'text', text: buf });
      buf = '';
    }
  };

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== '\\') {
      buf += ch;
      continue;
    }
    const next = raw[i + 1];
    if (next === 'x') {
      const hex = raw.slice(i + 2, i + 4);
      if (/^[0-9a-fA-F]{2}$/.test(hex)) {
        buf += String.fromCharCode(parseInt(hex, 16));
        i += 3;
        continue;
      }
      // \x not followed by two hex digits — warn so the author notices the
      // typo (e.g. \x3 expecting Ctrl-C) instead of silently getting literal text.
      console.warn(`snippet: \\x escape needs two hex digits near index ${i}; got "${raw.slice(i, i + 4)}"`);
    } else if (next === 's') {
      const m = /^(\d{1,4})/.exec(raw.slice(i + 2));
      if (m) {
        flush();
        segments.push({ kind: 'delay', delayMs: parseInt(m[1], 10) });
        i += 1 + m[1].length;
        continue;
      }
      // \s not followed by digits — warn similarly.
      console.warn(`snippet: \\s escape needs 1-4 digits near index ${i}; got "${raw.slice(i, i + 4)}"`);
    } else if (next === 'n') {
      buf += '\n'; i += 1; continue;
    } else if (next === 'r') {
      buf += '\r'; i += 1; continue;
    } else if (next === 't') {
      buf += '\t'; i += 1; continue;
    } else if (next === '\\') {
      buf += '\\'; i += 1; continue;
    }
    // Unknown escape — keep the backslash literally.
    buf += ch;
  }
  flush();
  return segments;
}
