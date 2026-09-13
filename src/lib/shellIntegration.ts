// src/lib/shellIntegration.ts
// Shell-integration command detection, modelled on VSCode's
// ShellIntegrationAddon + CommandDetectionCapability
// (microsoft/vscode: src/vs/platform/terminal/common/xterm/shellIntegrationAddon.ts,
//  src/vs/platform/terminal/common/capabilities/commandDetectionCapability.ts).
//
// The parser hooks OSC sequences emitted by shell integration scripts:
//   OSC 133 ; A/B/C/D        FinalTerm prompt/command markers
//   OSC 633 ; A/B/C/D/E/P    VSCode's own protocol (same markers + command line)
//   OSC 1337 ; CurrentDir=   iTerm2 cwd (handled upstream in TerminalView too)
//
// We keep a per-tab tracker of command boundaries (xterm markers) so UI
// features (sticky scroll, future scroll-to-command/history) can answer
// "which command is this buffer line part of" with O(1)-ish lookups without
// rescanning the whole buffer.

import type { IMarker, Terminal } from '@xterm/xterm';

/** One command record: prompt start → command start (input row) → finished. */
export interface TrackedCommand {
  promptStart: IMarker;
  commandStart?: IMarker;
  commandFinished?: IMarker;
  /** Command line as reported by OSC 633 ; E, or extracted from the buffer. */
  commandLine: string;
  /** Whether commandLine was explicitly set by OSC 633 ; E (VSCode 'E' marker). */
  explicit: boolean;
  exitCode?: number;
}

export interface CommandInfo {
  /** Buffer line of the prompt start marker (sticky scroll renders from this line). */
  promptStartLine: number;
  /** Buffer line of the command start marker, when markers survived. */
  commandStartLine?: number;
  /** Command text, if OSC 633 ; E or the buffer extraction produced one. */
  commandLine: string;
  /** Exit code from OSC 133/633 ; D when OSC markers terminated the command. */
  exitCode?: number;
  /** True when the command is currently being typed/executed (not finished). */
  running: boolean;
}

export interface TabCommandTracker {
  /** Finished commands (oldest → newest) with surviving commandStart markers. */
  commands: TrackedCommand[];
  /** The command currently being typed/executed. */
  current: {
    promptStart?: IMarker;
    commandStart?: IMarker;
    commandLine?: string;
    explicit: boolean;
  };
  /** Commands are pushed as they finish; shifted when markers are trimmed. */
  disposed: boolean;
}

const trackers = new Map<string, TabCommandTracker>();

function ensureTracker(tabId: string): TabCommandTracker {
  let t = trackers.get(tabId);
  if (!t) {
    t = { commands: [], current: { explicit: false }, disposed: false };
    trackers.set(tabId, t);
  }
  return t;
}

/** Extracted helpers mirroring VSCode's server-side OSC parsing. */
export function deserializeOscMessage(message: string): string {
  // VSCode's deserializeVSCodeOscMessage: \\(op) where op is '\\' or 'xXX'
  return message.replace(/\\(\\|x([0-9a-f]{2}))/gi, (_match: string, op: string, hex?: string) =>
    hex ? String.fromCharCode(parseInt(hex, 16)) : op,
  );
}

export function serializeOscMessage(message: string): string {
  // eslint-disable-next-line no-control-regex -- OSC protocol escaping, control chars intentional
  return message.replace(/[\\;\x00-\x20]/g, (char: string) => {
    if (char === '\\') return '\\\\';
    return `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`;
  });
}

export function parseKeyValueAssignment(message: string): {
  key: string;
  value: string | undefined;
} {
  const i = message.indexOf('=');
  if (i === -1) return { key: message, value: undefined };
  return { key: message.substring(0, i), value: message.substring(i + 1) };
}

function handlePromptStart(tabId: string, terminal: Terminal): void {
  const t = ensureTracker(tabId);
  t.current.promptStart = terminal.registerMarker(0) ?? undefined;
}

function handleCommandStart(tabId: string, terminal: Terminal): void {
  const t = ensureTracker(tabId);
  t.current.commandStart = terminal.registerMarker(0) ?? undefined;
}

function handleCommandFinished(tabId: string, terminal: Terminal, exitCode?: number): void {
  const t = ensureTracker(tabId);
  // Only finalize commands that have a surviving commandStart marker —
  // prompt-start-only partials (e.g. enter at an empty prompt) are discarded.
  if (t.current.commandStart) {
    t.commands.push({
      promptStart: t.current.promptStart ?? t.current.commandStart,
      commandStart: t.current.commandStart,
      commandFinished: terminal.registerMarker(0) ?? undefined,
      commandLine: t.current.commandLine ?? '',
      explicit: t.current.explicit,
      exitCode,
    });
    // Keep the list bounded — scrollback > 2x current scrollback is plenty.
    if (t.commands.length > 512) t.commands.splice(0, t.commands.length - 512);
  }
  t.current = { explicit: false };
}

function handleCommandLine(tabId: string, raw: string): void {
  const t = ensureTracker(tabId);
  t.current.commandLine = deserializeOscMessage(raw);
  t.current.explicit = true;
}

/**
 * Extract the command text from buffer lines between prompt start and
 * command start (VSCode's PartialTerminalCommand.extractCommandLine
 * heuristic, used when OSC 633 ; E never fires, e.g. FinalTerm-only shells).
 */
export function extractCommandLine(terminal: Terminal, tracker: TabCommandTracker): string {
  const start = tracker.current.promptStart;
  const end = tracker.current.commandStart;
  if (!start || start.line === -1) return '';
  if (!end || end.line === -1 || end.line < start.line) return '';

  // Single-line prompt: the current line, everything written by the shell
  // from promptStart.column onwards is the command. We can't reliably
  // delimit the prompt prefix (promptVariants differ), so join and trim.
  let text = '';
  for (let line = start.line; line <= end.line; line++) {
    const buf = terminal.buffer.active.getLine(line);
    if (!buf) break;
    text += buf.translateToString(true);
  }
  return text.trim();
}

function handleProperty(raw: string): void {
  const { key, value } = parseKeyValueAssignment(deserializeOscMessage(raw));
  if (value === undefined) return;
  switch (key) {
    case 'IsWindows':
      // ConPTY-specific heuristics could be armed here; parity marker only.
      break;
    case 'HasRichCommandDetection':
      // e.g. upstream decisions whether buffer-extraction is needed.
      break;
    case 'Cwd':
      // Reported through the dedicated OSC 7 handler in TerminalView already.
      break;
  }
}

function handleOsc(tabId: string, terminal: Terminal, data: string, protocol: 133 | 633): void {
  const [command, ...args] = data.split(';');
  switch (command) {
    case 'A':
      handlePromptStart(tabId, terminal);
      return;
    case 'B':
      handleCommandStart(tabId, terminal);
      // FinalTerm's B marker is unreliable for command text in many shells;
      // only the VSCode 633 protocol fills in commandLine via E markers.
      if (protocol === 633) return;
      return;
    case 'C':
      return;
    case 'D': {
      const exitCode = args.length === 1 && args[0] !== '' ? parseInt(args[0]) : undefined;
      handleCommandFinished(tabId, terminal, exitCode);
      return;
    }
    case 'E':
      if (protocol === 633) handleCommandLine(tabId, args[0] ?? '');
      return;
    case 'P':
      if (protocol === 633) handleProperty(args.join(';'));
      return;
  }
}

/**
 * Attach shell-integration OSC handlers to a terminal. Call once per tab at
 * Terminal construction (survives remounts/splits). The returned tracker lives
 * until disposeShellIntegration (called by destroyTerminal).
 */
export function attachShellIntegration(tabId: string, terminal: Terminal): void {
  const tracker = ensureTracker(tabId);
  try {
    terminal.parser.registerOscHandler(133, (data) => {
      handleOsc(tabId, terminal, data, 133);
      return true; // VSCode FinalTerm sequences fully handled here.
    });
    terminal.parser.registerOscHandler(633, (data) => {
      handleOsc(tabId, terminal, data, 633);
      return true;
    });
  } catch {
    // Non-fatal: tracking degrades (sticky scroll simply never shows).
  }
  tracker.disposed = false;
}

/** Get the tracker for a tab (undefined before attach or after dispose). */
export function getCommandTracker(tabId: string): TabCommandTracker | undefined {
  return trackers.get(tabId);
}

export function disposeShellIntegration(tabId: string): void {
  trackers.delete(tabId);
}

function toCommandInfo(
  cmd:
    | TrackedCommand
    | {
        promptStart: IMarker;
        commandStart?: IMarker;
        commandLine?: string;
        explicit?: boolean;
        exitCode?: number;
      },
  running: boolean,
): CommandInfo | undefined {
  if (!cmd.promptStart || cmd.promptStart.line === -1) return undefined;
  return {
    promptStartLine: cmd.promptStart.line,
    commandStartLine: cmd.commandStart?.line === -1 ? undefined : cmd.commandStart?.line,
    commandLine: cmd.commandLine ?? '',
    exitCode: cmd.exitCode,
    running,
  };
}

/**
 * Answer: which command does `line` (absolute buffer line, e.g. viewportY)
 * belong to? Last finished command whose prompt start precedes the line, or
 * the running command if the line is at/after its prompt start.
 */
export function getCommandForLine(
  tabId: string,
  terminal: Terminal,
  line: number,
): CommandInfo | undefined {
  const t = trackers.get(tabId);
  if (!t) return undefined;

  // Running command takes precedence from its prompt start line onwards.
  if (t.current.promptStart && t.current.promptStart.line <= line) {
    ensureLineCommandLine(t, terminal);
    return toCommandInfo(
      { ...t.current, exitCode: undefined, promptStart: t.current.promptStart },
      true,
    );
  }

  // Finished commands, newest first.
  for (let i = t.commands.length - 1; i >= 0; i--) {
    const cmd = t.commands[i];
    const startLine = cmd.promptStart.line;
    if (startLine === -1) continue; // trimmed from scrollback
    if (startLine > line) continue;
    if (!cmd.commandLine && !cmd.explicit) {
      // Backfill the extracted command line once (sticky scroll reads it).
      cmd.commandLine = extractCommandLine(terminal, {
        commands: [],
        current: {
          promptStart: cmd.promptStart,
          commandStart: cmd.commandStart,
          commandLine: undefined,
          explicit: false,
        },
        disposed: false,
      });
    }
    return toCommandInfo(cmd, false);
  }
  return undefined;
}

function ensureLineCommandLine(t: TabCommandTracker, terminal: Terminal): void {
  if (!t.current.commandLine && !t.current.explicit) {
    t.current.commandLine = extractCommandLine(terminal, t);
  }
}
