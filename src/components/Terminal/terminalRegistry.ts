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
  /** Live WebGL texture-atlas canvas pages, maintained via the WebglAddon's
   *  onChangeTextureAtlas / onAddTextureAtlasCanvas / onRemoveTextureAtlasCanvas
   *  lifecycle events — the same surface VSCode wires (its "Show Terminal
   *  Texture Atlas" debug command renders these). Undefined while the DOM
   *  renderer is active or the WebGL addon isn't loaded yet; reset to an
   *  empty array on addon load/dispose. A future debug viewer can read this
   *  list to render the atlas without re-touching the addon. */
  textureAtlasCanvases?: HTMLCanvasElement[];
}

export const terminalInstances = new Map<string, TerminalInstance>();
