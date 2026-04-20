import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';

export interface TerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  rendererAddon?: { dispose(): void };
}

export const terminalInstances = new Map<string, TerminalInstance>();
