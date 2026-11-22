import { WebglAddon } from '@xterm/addon-webgl';
import type { TerminalInstance } from '../components/Terminal/terminalRegistry';
import type { TabInfo } from '../types';
import {
  forceTerminalRedraw,
  getSuggestedRendererTypeDom,
  safeFit,
  setSuggestedRendererTypeDom,
} from './terminalLifecycle';

function webglDebugEnabled(): boolean {
  try {
    return localStorage.getItem('gwshell:webgl-debug') === '1';
  } catch {
    return false;
  }
}

/**
 * Attach the xterm WebGL renderer addon (with custom glyphs, context-loss
 * fallback, and texture-atlas lifecycle tracking) when eligible.
 */
export function attachWebglRenderer(
  instance: TerminalInstance,
  tab: TabInfo,
  wasFreshlyOpened: boolean,
  isSshBacked: () => boolean,
): void {
  if (!(wasFreshlyOpened || instance.rendererLost) || getSuggestedRendererTypeDom()) {
    return;
  }
  try {
    instance.rendererAddon?.dispose();
  } catch {}
  instance.rendererAddon = undefined;
  instance.textureAtlasCanvases = undefined;

  try {
    const webgl = new WebglAddon({ customGlyphs: true });
    webgl.onContextLoss(() => {
      instance.rendererLost = true;
      instance.textureAtlasCanvases = undefined;
      try {
        webgl.dispose();
      } catch {}
      safeFit(tab.id);
      forceTerminalRedraw(tab.id, tab.sessionId, tab.type, isSshBacked());
    });

    instance.textureAtlasCanvases = [];
    const dbg = webglDebugEnabled();
    try {
      webgl.onChangeTextureAtlas((canvas) => {
        instance.textureAtlasCanvases = [canvas];
        if (dbg) {
          console.debug('[gwshell:webgl] atlas rebuilt (page 0)', canvas.width, 'x', canvas.height);
        }
      });
    } catch {
      /* onChangeTextureAtlas unavailable on this addon version */
    }
    try {
      webgl.onAddTextureAtlasCanvas((canvas) => {
        const list = instance.textureAtlasCanvases ?? (instance.textureAtlasCanvases = []);
        if (!list.includes(canvas)) list.push(canvas);
        if (dbg) console.debug('[gwshell:webgl] atlas page added →', list.length, 'page(s)');
      });
    } catch {
      /* onAddTextureAtlasCanvas unavailable */
    }
    try {
      webgl.onRemoveTextureAtlasCanvas((canvas) => {
        const list = instance.textureAtlasCanvases;
        if (list) {
          const i = list.indexOf(canvas);
          if (i >= 0) list.splice(i, 1);
        }
        if (dbg) {
          console.debug(
            '[gwshell:webgl] atlas page removed →',
            instance.textureAtlasCanvases?.length ?? 0,
            'page(s)',
          );
        }
      });
    } catch {
      /* onRemoveTextureAtlasCanvas unavailable */
    }

    instance.terminal.loadAddon(webgl);
    instance.rendererAddon = webgl;
    instance.rendererLost = false;
    safeFit(tab.id);
    try {
      instance.terminal.clearTextureAtlas();
    } catch {}
    try {
      instance.terminal.refresh(0, instance.terminal.rows - 1);
    } catch {}
  } catch {
    setSuggestedRendererTypeDom(true);
  }
}
