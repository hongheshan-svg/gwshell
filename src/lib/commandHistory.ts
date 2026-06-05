import { invoke } from '@tauri-apps/api/core';

// Ordered oldest→newest. Index 0 = oldest, last = newest.
let history: string[] = [];

export async function init(limit: number): Promise<void> {
  try {
    // Backend returns newest-first; reverse so newest is at array end.
    const newest = await invoke<string[]>('get_command_history', { limit });
    history = [...newest].reverse();
  } catch {
    history = [];
  }
}

export function record(command: string): void {
  history.push(command);
  invoke('save_command_history', { command }).catch(() => {});
}

// Returns the suffix to append (everything after prefix) for the most recent match.
// Returns '' when there is no match.
export function getSuggestion(prefix: string): string {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].startsWith(prefix) && history[i].length > prefix.length) {
      return history[i].slice(prefix.length);
    }
  }
  return '';
}
