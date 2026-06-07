/**
 * blocks.ts — per-tab command-block model for OSC 133 shell integration.
 *
 * Each "block" tracks one command cycle: prompt → input → execution → done.
 * Blocks are keyed by xterm IMarker so their buffer positions survive scrollback
 * compaction. The module exposes pure functions; no React state is involved.
 *
 * Lifecycle (driven by OSC 133 sequences parsed in TerminalView.tsx):
 *   A (or B fallback) → startBlock()
 *   C                 → markOutput() + setCommand()
 *   D;exitcode        → finishBlock()
 *   tab close         → clearTab()
 */

import type { Terminal, IMarker, IDecoration } from '@xterm/xterm';

export interface CommandBlock {
  /** Monotonically increasing sequence number across all tabs. */
  id: number;
  /** Marker placed at the prompt line (OSC 133 A / B). */
  promptMarker: IMarker | null;
  /** Marker placed just before command output starts (OSC 133 C). */
  outputMarker: IMarker | null;
  /** The command text captured from the input buffer at OSC 133 C. */
  command: string;
  /** Shell exit code from OSC 133 D;N — undefined if shell did not report. */
  exitCode?: number;
  /** 'running' until OSC 133 D is received. */
  state: 'running' | 'done';
  /** Unix timestamp (ms) when the block was started. */
  startedAt: number;
  /** xterm decoration handle for the left-gutter status bar (P4). null when
   *  the terminal does not support decorations or OSC 133 is not active. */
  deco?: IDecoration | null;
}

/** Maximum number of blocks retained per tab (oldest are evicted). */
const MAX_BLOCKS = 200;

/** Module-level map: tabId → CommandBlock[]. Mirrors the pattern used by
 *  inputBuffers / tabHasOsc133 etc. in TerminalView.tsx. */
const tabBlocks = new Map<string, CommandBlock[]>();

/** Global sequence counter — never resets during the page lifetime. */
let seq = 0;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Return the current block list for a tab (empty array if none). */
export function blocksFor(tabId: string): CommandBlock[] {
  return tabBlocks.get(tabId) ?? [];
}

/**
 * Start a new block at the current cursor position (OSC 133 A / B).
 * Registers an xterm marker so the prompt line can be located later.
 * Evicts the oldest block(s) when the list exceeds MAX_BLOCKS.
 */
export function startBlock(tabId: string, term: Terminal): CommandBlock {
  const list = tabBlocks.get(tabId) ?? [];

  // Reclaim orphan: if the last block is still running but never had an
  // outputMarker set, it is a prompt that was reprompted without executing a
  // command (fish bare-Enter, Ctrl+C reprompt, etc.).  Pop and dispose it so
  // these stale entries do not accumulate.  A running block WITH an
  // outputMarker is a genuinely-executing command — do NOT remove that.
  if (list.length > 0) {
    const prev = list[list.length - 1];
    if (prev.state === 'running' && prev.outputMarker === null) {
      list.pop();
      prev.promptMarker?.dispose();
      try { prev.deco?.dispose(); } catch {}
    }
  }

  // registerMarker() is typed as returning IMarker (non-optional) in xterm v6,
  // but we guard with || null for safety in case a future version changes.
  const marker: IMarker | null = term.registerMarker() || null;

  const block: CommandBlock = {
    id: ++seq,
    promptMarker: marker,
    outputMarker: null,
    command: '',
    state: 'running',
    startedAt: Date.now(),
  };

  list.push(block);

  // Trim oldest blocks beyond MAX_BLOCKS, disposing their markers and
  // decoration handles to avoid leaking xterm resources.
  while (list.length > MAX_BLOCKS) {
    const old = list.shift();
    old?.promptMarker?.dispose();
    old?.outputMarker?.dispose();
    try { old?.deco?.dispose(); } catch {}
  }

  tabBlocks.set(tabId, list);
  return block;
}

/**
 * Place the output marker at the current cursor position (OSC 133 C).
 * This marks the line just before command output begins.
 * Returns the block that was marked (the lastRunning), or undefined if none.
 */
export function markOutput(tabId: string, term: Terminal): CommandBlock | undefined {
  const b = lastRunning(tabId);
  if (b && !b.outputMarker) {
    b.outputMarker = term.registerMarker() || null;
  }
  return b;
}

/**
 * Set the command text on the last running block (called at OSC 133 C,
 * using the input buffer that was accumulated during the prompt phase).
 */
export function setCommand(tabId: string, cmd: string): void {
  const b = lastRunning(tabId);
  if (b) b.command = cmd;
}

/**
 * Mark the last running block as done and record its exit code (OSC 133 D).
 * exitCode is undefined when the shell did not send a numeric exit code.
 * Returns the block that was finished, or undefined if none.
 */
export function finishBlock(tabId: string, exitCode?: number): CommandBlock | undefined {
  const b = lastRunning(tabId);
  if (b) {
    b.state = 'done';
    b.exitCode = exitCode;
  }
  return b;
}

/**
 * Dispose all markers for a tab and remove its block list.
 * Must be called when a tab is closed to prevent IMarker leaks.
 */
export function clearTab(tabId: string): void {
  const list = tabBlocks.get(tabId);
  if (list) {
    list.forEach((b) => {
      b.promptMarker?.dispose();
      b.outputMarker?.dispose();
      try { b.deco?.dispose(); } catch {}
    });
  }
  tabBlocks.delete(tabId);
}

/**
 * Read the output text of a completed (or still-running) block.
 *
 * Lines are taken from outputMarker.line (inclusive) up to the next
 * block's promptMarker.line (exclusive), or to the end of the buffer.
 * Returns an empty string when no outputMarker has been set yet.
 */
export function readOutput(
  tabId: string,
  term: Terminal,
  block: CommandBlock,
): string {
  const start = block.outputMarker?.line;
  if (start == null || start < 0) return '';

  const list = tabBlocks.get(tabId) ?? [];
  const idx = list.indexOf(block);
  const next = idx >= 0 ? list[idx + 1] : undefined;
  // A disposed IMarker returns .line === -1 (not null/undefined), so ?? doesn't
  // fire.  Treat negative lines the same as "no marker" and fall back to the
  // end of the buffer.
  const nextLine = next?.promptMarker?.line;
  const end = (nextLine == null || nextLine < 0) ? term.buffer.active.length : nextLine;

  const out: string[] = [];
  for (let i = start; i < end; i++) {
    const ln = term.buffer.active.getLine(i);
    if (ln) out.push(ln.translateToString(true));
  }
  return out.join('\n').replace(/\n+$/, '');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Return the most-recently-started block that is still running, or undefined. */
function lastRunning(tabId: string): CommandBlock | undefined {
  const list = tabBlocks.get(tabId);
  if (!list) return undefined;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].state === 'running') return list[i];
  }
  return undefined;
}
