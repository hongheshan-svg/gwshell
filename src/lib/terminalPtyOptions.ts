export interface TerminalOsInfo {
  os: string;
  windowsBuild?: number;
}

export interface XtermWindowsPtyOptions {
  backend: "conpty";
  buildNumber: number;
}

/**
 * Returns xterm.js windowsPty compatibility metadata for local ConPTY
 * sessions. Passes the real Windows build number so xterm.js can apply the
 * correct ConPTY heuristics (reflow disabling, wrapping assumptions) based on
 * its own build-number thresholds. Returns undefined for non-Windows, non-PTY
 * sessions, or when the build number is unknown.
 */
export function getXtermWindowsPty(
  osInfo: TerminalOsInfo,
  usesLocalConpty: boolean,
): XtermWindowsPtyOptions | undefined {
  if (!usesLocalConpty || osInfo.os !== "windows") return undefined;

  const build = osInfo.windowsBuild;
  if (typeof build !== "number" || !Number.isFinite(build)) return undefined;

  return {
    backend: "conpty",
    buildNumber: Math.trunc(build),
  };
}
