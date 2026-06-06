export interface Step { ctrl: boolean; shift: boolean; alt: boolean; meta: boolean; key: string }
export type Chord = Step[];

function normKey(k: string): string {
  const m: Record<string, string> = {
    ',': 'Comma', comma: 'Comma', ' ': 'Space', space: 'Space',
    esc: 'Escape', escape: 'Escape', del: 'Delete', delete: 'Delete',
    ins: 'Insert', insert: 'Insert', return: 'Enter', enter: 'Enter',
    tab: 'Tab', backspace: 'Backspace',
  };
  const lower = k.toLowerCase();
  if (m[lower]) return m[lower];
  if (/^[a-z]$/.test(lower)) return lower.toUpperCase();
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return 'F' + lower.slice(1);
  return k.length === 1 ? k.toUpperCase() : k;
}

export function parseBinding(binding: string): Chord | null {
  const steps = binding.trim().split(/\s+/).filter(Boolean);
  if (steps.length === 0) return null;
  const chord: Chord = [];
  for (const step of steps) {
    const parts = step.split('+').map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return null;
    const s: Step = { ctrl: false, shift: false, alt: false, meta: false, key: '' };
    for (const p of parts) {
      const lp = p.toLowerCase();
      if (lp === 'ctrl' || lp === 'control') s.ctrl = true;
      else if (lp === 'shift') s.shift = true;
      else if (lp === 'alt' || lp === 'option') s.alt = true;
      else if (lp === 'meta' || lp === 'cmd' || lp === 'command' || lp === 'win' || lp === 'super') s.meta = true;
      else s.key = normKey(p);
    }
    if (!s.key) return null;
    chord.push(s);
  }
  return chord;
}

function eventKey(e: KeyboardEvent): string {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
  if (/^Digit[0-9]$/.test(e.code)) return e.code.slice(5);
  if (e.code === 'Comma') return 'Comma';
  if (e.code === 'Space') return 'Space';
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.code)) return e.code;
  return normKey(e.key);
}

export function matchStep(e: KeyboardEvent, st: Step): boolean {
  return e.ctrlKey === st.ctrl && e.shiftKey === st.shift && e.altKey === st.alt && e.metaKey === st.meta
    && eventKey(e).toLowerCase() === st.key.toLowerCase();
}

export function eventToStep(e: KeyboardEvent): Step | null {
  if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta') return null;
  return { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey, key: eventKey(e) };
}

export function formatStep(st: Step): string {
  const mods: string[] = [];
  if (st.ctrl) mods.push('Ctrl');
  if (st.shift) mods.push('Shift');
  if (st.alt) mods.push('Alt');
  if (st.meta) mods.push('Meta');
  return [...mods, st.key].join('+');
}

export function stepToBinding(st: Step): string { return formatStep(st); }
