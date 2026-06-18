import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { SearchAddon } from '@xterm/addon-search';

export interface TerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  rendererAddon?: { dispose(): void };
  /** Set when the WebGL renderer was lost (context-loss) and not yet restored.
   *  The mount effect re-loads a WebGL addon when this is true. */
  rendererLost?: boolean;
}

export const terminalInstances = new Map<string, TerminalInstance>();
