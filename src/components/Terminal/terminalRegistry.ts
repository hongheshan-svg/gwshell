import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';

export interface TerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
}

export const terminalInstances = new Map<string, TerminalInstance>();
