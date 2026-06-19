export interface TerminalOsInfo {
  os: string;
  windowsBuild?: number;
}

export interface XtermWindowsPtyOptions {
  backend: "conpty";
  buildNumber: number;
}

export const XTERM_CONPTY_SAFE_REFLOW_BUILD = 21376;

export function normalizeConptyBuildForXterm(build: unknown): number {
  if (typeof build !== "number" || !Number.isFinite(build)) {
    return XTERM_CONPTY_SAFE_REFLOW_BUILD;
  }

  return Math.max(Math.trunc(build), XTERM_CONPTY_SAFE_REFLOW_BUILD);
}

export function getXtermWindowsPty(
  osInfo: TerminalOsInfo,
  usesLocalConpty: boolean,
): XtermWindowsPtyOptions | undefined {
  if (!usesLocalConpty || osInfo.os !== "windows") return undefined;

  // This is renderer compatibility metadata, not the real OS build. xterm.js
  // enables old Windows wrap heuristics below this build; those heuristics leave
  // stale cursor cells in full-screen TUIs that repaint status/tree rows.
  return {
    backend: "conpty",
    buildNumber: normalizeConptyBuildForXterm(osInfo.windowsBuild),
  };
}
