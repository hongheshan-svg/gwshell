// src/lib/terminalStickyScroll.ts
// Sticky-scroll state computation for the terminal, modelled on VSCode's
// TerminalStickyScrollOverlay (microsoft/vscode,
// src/vs/workbench/contrib/terminalContrib/stickyScroll/browser/terminalStickyScrollOverlay.ts).
// The pure helper computes which buffer lines should be pinned at the top of
// the viewport (the prompt/command currently being scrolled past).

import type { Terminal } from '@xterm/xterm';
import type { CommandInfo } from './shellIntegration';
import { VSCODE_STICKY_SCROLL_DEFAULTS } from './terminalVscodeOptions';

const STICKY_SCROLL_PERCENTAGE_CAP = 0.4;

export interface StickyScrollState {
  /** Lines to render (prompt + command text). */
  lines: string[];
  /** Command powering this sticky header (empty when extracted text missing). */
  commandLine: string;
}

function isIgnoredCommand(command: string, ignored: readonly string[]): boolean {
  const trimmed = command.trim().toLowerCase();
  if (!trimmed) return false;
  return ignored.some((c) => c.toLowerCase() === trimmed);
}

/**
 * Compute the sticky lines for the given buffer state.
 *
 * `viewportY` is the top-most visible buffer line. We pin the prompt/command
 * rows from the command that owns that line — from its prompt start marker
 * up to (but excluding) the first output row. Only buffer lines are read;
 * it's safe to call on every scroll/line-feed/line-space event.
 */
export function computeStickyScroll(
  terminal: Terminal,
  command: CommandInfo | undefined,
  ignored: readonly string[] = VSCODE_STICKY_SCROLL_DEFAULTS.ignoredCommands,
  rawMaxLineCount: number = VSCODE_STICKY_SCROLL_DEFAULTS.maxLineCount,
): StickyScrollState | null {
  if (!command || command.promptStartLine === undefined) return null;
  if (isIgnoredCommand(command.commandLine, ignored)) return null;

  const buffer = terminal.buffer.active;
  // Never stick inside alternate screens (vim/less/htop etc.). While there,
  // buffer.active is the alt buffer and markers are from the normal buffer —
  // but guard anyway for safety.
  if (buffer !== terminal.buffer.normal) return null;

  const endLine =
    command.commandStartLine !== undefined
      ? Math.max(command.commandStartLine, command.promptStartLine)
      : command.promptStartLine;

  // Hide sticky scroll if the top viewport line is still above the prompt.
  if (buffer.viewportY <= command.promptStartLine) return null;
  // And if the prompt is entirely within viewportY already, nothing to stick.
  // (Viewport moved past the prompt rows → sticky becomes useful again.)

  // Clamp to maxLineCount and never exceed 40% of the viewport height,
  // matching VSCode's defensive cap.
  const maxLineCount = Math.min(rawMaxLineCount, Math.floor(terminal.rows * STICKY_SCROLL_PERCENTAGE_CAP));
  const rowsAvailable = endLine - command.promptStartLine + 1;
  const rows = Math.min(rowsAvailable, maxLineCount);
  if (rows < 1) return null;

  const lines: string[] = [];
  for (let line = endLine; line >= command.promptStartLine; line--) {
    const bufLine = buffer.getLine(line);
    if (!bufLine) break;
    lines.unshift(bufLine.translateToString(true));
  }
  if (lines.length === 0) return null;
  return { lines, commandLine: command.commandLine };
}
