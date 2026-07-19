// src/lib/terminalPlatform.ts
// Platform detection and OS info caching for terminal features.
// Extracted from TerminalView.tsx to reduce its size and isolate platform
// concerns. Module-level cache (cachedOsInfo) is a singleton shared across
// all terminal instances, same pattern as terminalRegistry.ts.

import type { Terminal } from '@xterm/xterm';
import { invoke } from '@tauri-apps/api/core';

const isMacPlatform = () => {
  if (cachedOsInfo?.os === 'macos') return true;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
};

// Cached platform info (fetched once, shared by all terminals)
let cachedOsInfo: { os: string; windowsBuild?: number } | null = null;
let osInfoPromise: Promise<{ os: string; windowsBuild?: number }> | null = null;

async function getOsInfo(): Promise<{ os: string; windowsBuild?: number }> {
  if (cachedOsInfo) return cachedOsInfo;
  osInfoPromise ??= invoke<{ os: string; windowsBuild?: number }>('get_os_info')
    .then((info) => {
      cachedOsInfo = info;
      return info;
    })
    .catch(() => {
      const fallback = { os: 'unknown' };
      cachedOsInfo = fallback;
      return fallback;
    });
  return osInfoPromise;
}

// Pre-warm: start fetching OS info immediately at module load time
// so it's ready before the first terminal is created.
void getOsInfo();

// Dev-only WebGL renderer observability. Toggle from devtools at runtime:
//   localStorage.setItem('gwshell:webgl-debug', '1')
// When enabled, the WebGL addon's texture-atlas lifecycle events (atlas
// rebuild / page add / page remove) are traced to the console. This is the
// runtime signal that the renderer is exercising the atlas - e.g. confirming
// a DPR/resize-triggered atlas swap, or that a context-loss -> DOM fallback
// happened. Matches VSCode's WebGL renderer logging/telemetry path. Silent
// in production (the read is cheap and cached per call). Used by the atlas
// event wiring in the WebGL load block below.
function webglDebugEnabled(): boolean {
  try {
    return localStorage.getItem('gwshell:webgl-debug') === '1';
  } catch {
    return false;
  }
}

function isInteractiveTerminal(type: string): boolean {
  return type === 'ssh' || type === 'localshell' || type === 'serial' || type === 'docker';
}

/**
 * Per-cell CSS pixel size as xterm itself uses for row/column layout.
 * Prefer the render service's exact cell dimensions - `clientHeight / rows`
 * is only an average and its rounding error accumulates, drifting the ghost
 * overlay down by a row on lower lines. Falls back to the average if the
 * (proposed/internal) render service shape is unavailable.
 */
function cellSize(term: Terminal, el: HTMLElement): { w: number; h: number } {
  // eslint-disable-next-line no-restricted-syntax
  const termWithCore = term as unknown as {
    _core?: {
      _renderService?: { dimensions?: { css?: { cell?: { width: number; height: number } } } };
    };
  };
  const cell = termWithCore._core?._renderService?.dimensions?.css?.cell;
  if (cell && cell.width > 0 && cell.height > 0) return { w: cell.width, h: cell.height };
  return { w: el.clientWidth / term.cols, h: el.clientHeight / term.rows };
}

export { isMacPlatform, getOsInfo, webglDebugEnabled, isInteractiveTerminal, cellSize };
