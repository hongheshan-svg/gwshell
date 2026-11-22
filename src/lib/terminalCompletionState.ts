// src/lib/terminalCompletionState.ts
// Per-tab completion and command-history state. Module-level Maps are
// singletons shared across all terminal instances (same pattern as
// terminalRegistry.ts). Extracted from TerminalView.tsx.

import type { Completion } from './completion';
import type { CommandTable } from './commandDictionary';
import { tableForShellName, tableForRemoteShell } from './commandDictionary';
import type { LineTracker } from './inputLineTracker';

/** What the completion dropdown should show; `items: []` hides it. */
export interface CompletionView {
  items: Completion[];
  index: number;
  /** The user moved the selection with ↑/↓, so Enter accepts it. */
  navigated: boolean;
  x: number; // column the item text should start at
  y: number; // cursor row (viewport)
  above: boolean; // render above the cursor row instead of below
  /** Length of the typed line; each item's text starts with it. */
  typedLen: number;
}

export const HIDDEN_COMPLETIONS: CompletionView = {
  items: [],
  index: 0,
  navigated: false,
  x: 0,
  y: 0,
  above: false,
  typedLen: 0,
};

// Command history: per-tab typed-line tracker, completion state, and callbacks.
export const lineTrackers = new Map<string, LineTracker>();
export const completionSetters = new Map<string, (view: CompletionView) => void>();
export const completionAccept = new Map<string, (suffix: string) => void>();

export const tabCwd = new Map<string, string>();
// Cache of remote-OS + installed-command probe results keyed by host:port, so
// opening multiple SSH tabs to the same host doesn't re-run exec probes each
// time. Entries expire after 5 minutes.
export const remoteOsCache = new Map<
  string,
  { table: CommandTable; commands?: ReadonlySet<string>; at: number }
>();
export const REMOTE_OS_TTL_MS = 5 * 60 * 1000;
export const tabAvailableCommands = new Map<string, ReadonlySet<string>>();
export const tabCompletions = new Map<string, Completion[]>();
export const tabCompletionIdx = new Map<string, number>();
export const completionNav = new Map<string, boolean>(); // user moved selection with ↑/↓
export const tabInputSenders = new Map<string, (data: string) => void>(); // populated by the snippet input-sender task
// Set when the terminal's last output line looks like a password / passphrase
// / verification-code prompt. While set, typed input is NOT recorded as command
// history and completions are suppressed - otherwise a password entered at a
// sudo/mysql/su prompt would be captured verbatim and later surfaced as a
// completion suggestion.
export const awaitingPassword = new Map<string, boolean>();
// Auto-clears awaitingPassword after a few seconds so a stale prompt (or a rare
// false positive) can't permanently disable history/completions for a tab.
export const awaitingPasswordTimer = new Map<string, ReturnType<typeof setTimeout>>();
// Resolved completion table per tab. For SSH 'auto', filled in asynchronously
// by detect_remote_os; for other types it is derived synchronously (see syncTable).
export const tabCommandTable = new Map<string, CommandTable>();

// Per-tab scope key for history ranking.

export function tabScope(
  type: string,
  session: { host?: string; serial_port?: string; name?: string } | undefined,
): string {
  if (type === 'ssh') return session?.host ?? '';
  if (type === 'localshell') return 'local';
  if (type === 'serial') return session?.serial_port ?? 'serial';
  if (type === 'docker') return session?.name ?? 'docker';
  return '';
}

// Synchronous best-guess completion table for a tab. SSH with an 'auto'/unset
// override returns 'unix' until the async probe (detect_remote_os) resolves and
// writes the real value into tabCommandTable.
export function syncTable(
  type: string,
  session: { shell_name?: string; remote_shell?: string } | undefined,
): CommandTable {
  if (type === 'localshell') return tableForShellName(session?.shell_name);
  if (type === 'ssh') return tableForRemoteShell(session?.remote_shell) ?? 'unix';
  return 'unix'; // docker, serial
}

// Normalize a backend table string to a CommandTable (defensive against drift).
export function normalizeTable(s: string): CommandTable {
  return s === 'cmd' || s === 'powershell' ? s : 'unix';
}

// How many terminal rows a completion dropdown occupies, so the `placeAbove`
// heuristic can decide whether it fits below the cursor. Each item is exactly
// one terminal row tall (see .terminal-completion-row); padding and border add
// up to about one more. Capped at 8 visible items.
export function estimateDropdownRows(items: Completion[]): number {
  return Math.min(items.length, 8) + 1;
}

/** Clear all completion state for a tab. Called by destroyTerminal + reconnect. */
export function resetCompletionState(tabId: string): void {
  lineTrackers.delete(tabId);
  tabCommandTable.delete(tabId);
  tabAvailableCommands.delete(tabId);
  completionSetters.delete(tabId);
  completionAccept.delete(tabId);
  tabCwd.delete(tabId);
  tabCompletions.delete(tabId);
  tabCompletionIdx.delete(tabId);
  completionNav.delete(tabId);
  tabInputSenders.delete(tabId);
  const apTimer = awaitingPasswordTimer.get(tabId);
  if (apTimer) {
    clearTimeout(apTimer);
    awaitingPasswordTimer.delete(tabId);
  }
  awaitingPassword.delete(tabId);
}
