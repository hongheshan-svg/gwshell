import { ACTION_BY_ID, KEY_ACTIONS } from './actions';
import { parseBinding, matchStep, type Chord } from './match';

export interface ResolvedBinding { actionId: string; chord: Chord }

export function resolveBindings(overrides: Record<string, string | null>): ResolvedBinding[] {
  const out: ResolvedBinding[] = [];
  for (const action of KEY_ACTIONS) {
    const ov = overrides[action.id];
    const binding = ov === undefined ? action.defaultBinding : ov;
    if (binding === null) continue;
    const chord = parseBinding(binding);
    if (chord) out.push({ actionId: action.id, chord });
  }
  return out;
}

const CHORD_TIMEOUT_MS = 1000;

export function createKeymapHandler(getOverrides: () => Record<string, string | null>): (e: KeyboardEvent) => void {
  let pending: { binding: ResolvedBinding; stepIndex: number; timer: ReturnType<typeof setTimeout> } | null = null;
  const clearPending = () => { if (pending) { clearTimeout(pending.timer); pending = null; } };

  return (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta') return;
    const bindings = resolveBindings(getOverrides());

    if (pending) {
      const next = pending.binding.chord[pending.stepIndex];
      if (next && matchStep(e, next)) {
        e.preventDefault(); e.stopPropagation();
        if (pending.stepIndex + 1 >= pending.binding.chord.length) {
          const id = pending.binding.actionId; clearPending(); ACTION_BY_ID.get(id)?.run();
        } else {
          pending.stepIndex += 1; clearTimeout(pending.timer); pending.timer = setTimeout(clearPending, CHORD_TIMEOUT_MS);
        }
        return;
      }
      clearPending();
    }

    for (const b of bindings) {
      if (matchStep(e, b.chord[0])) {
        e.preventDefault(); e.stopPropagation();
        if (b.chord.length === 1) ACTION_BY_ID.get(b.actionId)?.run();
        else pending = { binding: b, stepIndex: 1, timer: setTimeout(clearPending, CHORD_TIMEOUT_MS) };
        return;
      }
    }
  };
}
