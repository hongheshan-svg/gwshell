// src/lib/terminalCompletionState.ts
// Per-tab completion and command-history state. Module-level Maps are
// singletons shared across all terminal instances (same pattern as
// terminalRegistry.ts). Extracted from TerminalView.tsx.

import type { Completion } from './completion';
import type { CommandTable } from './commandDictionary';
import { tableForShellName, tableForRemoteShell } from './commandDictionary';

// Command history: per-tab line buffer, completion state, and callbacks.
export const inputBuffers = new Map<string, string>();
export const completionSetters = new Map<
  string,
  (items: Completion[], index: number, x: number, y: number, above: boolean) => void
>();
export const completionAccept = new Map<string, (suffix: string) => void>();

export const tabCwd = new Map<string, string>();
// Cache of remote-OS probe results keyed by host, so opening multiple SSH
// tabs to the same host doesn't re-run `uname`/`%COMSPEC%` exec probes each
// time. Entries expire after 5 minutes (a host's OS doesn't change often,
// but a re-provisioned box should eventually be re-detected).
export const remoteOsCache = new Map<string, { table: CommandTable; at: number }>();
export const REMOTE_OS_TTL_MS = 5 * 60 * 1000;
export const tabCompletions = new Map<string, Completion[]>();
export const tabCompletionIdx = new Map<string, number>();
export const completionNav = new Map<string, boolean>(); // user moved selection with ↑/↓
export const tabInputSenders = new Map<string, (data: string) => void>(); // populated by the snippet input-sender task
export const bracketedPaste = new Map<string, boolean>();
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

// Estimate how many terminal rows a completion dropdown will occupy, so the
// `placeAbove` heuristic can decide whether it fits below the cursor. Command-
// dictionary items carry a description line (~1.5x row height), history items
// are single-row. Capped at 8 visible items.
export function estimateDropdownRows(items: Completion[]): number {
  const visible = items.slice(0, 8);
  let rows = 0;
  for (const it of visible) {
    rows += it.desc ? 1.5 : 1;
  }
  return Math.ceil(rows);
}

/** Clear all completion state for a tab. Called by destroyTerminal + reconnect. */
export function resetCompletionState(tabId: string): void {
  inputBuffers.delete(tabId);
  tabCommandTable.delete(tabId);
  completionSetters.delete(tabId);
  completionAccept.delete(tabId);
  tabCwd.delete(tabId);
  tabCompletions.delete(tabId);
  tabCompletionIdx.delete(tabId);
  completionNav.delete(tabId);
  tabInputSenders.delete(tabId);
  bracketedPaste.delete(tabId);
  const apTimer = awaitingPasswordTimer.get(tabId);
  if (apTimer) {
    clearTimeout(apTimer);
    awaitingPasswordTimer.delete(tabId);
  }
  awaitingPassword.delete(tabId);
}
