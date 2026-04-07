import React, { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { TabInfo } from "../../types";
import { useAppStore } from "../../stores/appStore";
import "@xterm/xterm/css/xterm.css";

interface TerminalViewProps {
  tab: TabInfo;
  isActive: boolean;
  /** When true, always display the terminal (split-pane mode) instead of toggling display:none */
  forceVisible?: boolean;
}

interface FingerprintInfo {
  fingerprint: string;
  keyType: string;
  host: string;
  port: number;
}

// Cached platform info (fetched once, shared by all terminals)
let cachedOsInfo: { os: string; windowsBuild?: number } | null = null;
let osInfoPromise: Promise<{ os: string; windowsBuild?: number }> | null = null;

async function getOsInfo(): Promise<{ os: string; windowsBuild?: number }> {
  if (cachedOsInfo) return cachedOsInfo;
  if (!osInfoPromise) {
    osInfoPromise = invoke<{ os: string; windowsBuild?: number }>("get_os_info")
      .then((info) => { cachedOsInfo = info; return info; })
      .catch(() => { const fallback = { os: "unknown" }; cachedOsInfo = fallback; return fallback; });
  }
  return osInfoPromise;
}

// Pre-warm: start fetching OS info immediately at module load time
// so it's ready before the first terminal is created.
getOsInfo();

// Global map to preserve terminal instances across re-renders
export const terminalInstances = new Map<string, { terminal: Terminal; fitAddon: FitAddon }>();

// Track which tab IDs have active backend connections (SSH/PTY/serial)
// so we can avoid closing them during split-mode transitions.
const connectedTabs = new Set<string>();

// Global map of event-listener cleanup functions keyed by tab ID.
// Ensures only ONE set of listeners exists per tab at any time, even
// when React StrictMode double-invokes effects or when components
// remount during single↔split transitions.
const tabListenerCleanups = new Map<string, () => void>();

/** Remove event listeners for a tab (idempotent). */
function cleanupTabListeners(tabId: string): void {
  const fn = tabListenerCleanups.get(tabId);
  if (fn) { fn(); tabListenerCleanups.delete(tabId); }
}

/** Destroy a terminal instance associated with a tab (called when the tab closes). */
export function destroyTerminal(tabId: string): void {
  cleanupTabListeners(tabId);
  connectedTabs.delete(tabId);
  const inst = terminalInstances.get(tabId);
  if (inst) {
    inst.terminal.dispose();
    terminalInstances.delete(tabId);
  }
}

/**
 * Safely fit a terminal to its container.
 * Skips if the container is hidden or has zero dimensions.
 * After fitting, forces a full row redraw so the renderer always
 * shows content consistent with the new dimensions.
 */
export function safeFit(tabId: string): void {
  const inst = terminalInstances.get(tabId);
  if (!inst) return;
  const el = inst.terminal.element?.parentElement;
  if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) return;
  try {
    inst.fitAddon.fit();
    inst.terminal.refresh(0, inst.terminal.rows - 1);
  } catch {}
}

/**
 * Full renderer reset: fit, clear the glyph atlas, force a redraw, and
 * notify the backend of the current terminal size — even if xterm thinks
 * the size hasn't changed.
 *
 * Use this after the xterm element has been reparented to a new container
 * or its parent toggled from display:none to visible (split-mode open/close,
 * tab switch). These transitions leave three things out of sync:
 *  1. the glyph texture atlas may hold stale cells from the previous
 *     container/DPR — fixed by clearTextureAtlas + refresh
 *  2. the xterm buffer's wrap state may not match the on-screen rendering
 *     until a full refresh is forced
 *  3. the backend PTY/SSH session has the right *size* but TUI apps like
 *     Claude / vim / htop cache their UI and only redraw on SIGWINCH.
 *     fitAddon.fit() only fires onResize on dimension changes, so we
 *     re-issue resize_pty/resize_ssh unconditionally to trigger SIGWINCH
 *     and force the TUI to repaint.
 */
export function forceTerminalRedraw(
  tabId: string,
  sessionId: string,
  tabType: TabInfo['type']
): void {
  const inst = terminalInstances.get(tabId);
  if (!inst) return;
  const el = inst.terminal.element?.parentElement;
  if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) return;
  try { inst.fitAddon.fit(); } catch {}
  try { inst.terminal.clearTextureAtlas(); } catch {}
  try { inst.terminal.refresh(0, inst.terminal.rows - 1); } catch {}

  if (tabType === 'serial' || tabType === 'asset-list') return;
  const cols = inst.terminal.cols;
  const rows = inst.terminal.rows;
  if (tabType === 'ssh') {
    invoke('resize_ssh', { sessionId, cols, rows }).catch(() => {});
  } else {
    invoke('resize_pty', { sessionId, rows, cols }).catch(() => {});
  }
}

export const TerminalView: React.FC<TerminalViewProps> = ({ tab, isActive, forceVisible }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sessions = useAppStore((s) => s.sessions);
  const theme = useAppStore((s) => s.theme);
  const t = useAppStore((s) => s.t);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  const [fingerprintInfo, setFingerprintInfo] = useState<FingerprintInfo | null>(null);
  const fingerprintResolveRef = useRef<(accepted: boolean) => void>(() => {});

  const getThemeColors = useCallback(() => {
    const isDark = document.documentElement.getAttribute("data-theme") !== "light";
    return isDark
      ? {
          background: "#0f1019",
          foreground: "#e4e6f0",
          cursor: "#4c8dff",
          cursorAccent: "#0f1019",
          selectionBackground: "rgba(76, 141, 255, 0.3)",
          black: "#1c1e2d",
          red: "#ef4444",
          green: "#42d392",
          yellow: "#f5a623",
          blue: "#4c8dff",
          magenta: "#c084fc",
          cyan: "#22d3ee",
          white: "#e4e6f0",
          brightBlack: "#5c6078",
          brightRed: "#f87171",
          brightGreen: "#6ee7b7",
          brightYellow: "#fbbf24",
          brightBlue: "#6aa1ff",
          brightMagenta: "#d8b4fe",
          brightCyan: "#67e8f9",
          brightWhite: "#ffffff",
          scrollbarSliderBackground: "rgba(255, 255, 255, 0.28)",
          scrollbarSliderHoverBackground: "rgba(255, 255, 255, 0.42)",
          scrollbarSliderActiveBackground: "rgba(255, 255, 255, 0.56)",
        }
      : {
          background: "#f5f6fa",
          foreground: "#1a1b2e",
          cursor: "#3b7dff",
          cursorAccent: "#ffffff",
          selectionBackground: "rgba(59, 125, 255, 0.2)",
          black: "#1a1b2e",
          red: "#dc2626",
          green: "#16a34a",
          yellow: "#ca8a04",
          blue: "#3b7dff",
          magenta: "#9333ea",
          cyan: "#0891b2",
          white: "#e4e6f0",
          brightBlack: "#8b8fa7",
          brightRed: "#ef4444",
          brightGreen: "#22c55e",
          brightYellow: "#eab308",
          brightBlue: "#5b93ff",
          brightMagenta: "#a855f7",
          brightCyan: "#06b6d4",
          brightWhite: "#ffffff",
          scrollbarSliderBackground: "rgba(0, 0, 0, 0.22)",
          scrollbarSliderHoverBackground: "rgba(0, 0, 0, 0.34)",
          scrollbarSliderActiveBackground: "rgba(0, 0, 0, 0.46)",
        };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;
    const container = containerRef.current;

    const initTerminal = async () => {
      const existingInstance = terminalInstances.get(tab.id);
      let instance = existingInstance;

      if (!instance) {
        // Fetch platform info to configure windowsPty for ConPTY on Windows.
        // This tells xterm.js how to interpret ConPTY escape sequences so that
        // TUI apps (claude, vim, htop etc.) render correctly.
        const osInfo = await getOsInfo();
        if (cancelled) return;

        const termOpts: Record<string, unknown> = {
          fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace",
          fontSize: 13,
          lineHeight: 1.2,
          cursorBlink: true,
          cursorStyle: "bar",
          theme: getThemeColors(),
          allowProposedApi: true,
          scrollback: 10000,
        };

        if (osInfo.os === "windows") {
          termOpts.windowsPty = {
            backend: "conpty",
            buildNumber: osInfo.windowsBuild ?? 0,
          };
        }

        const terminal = new Terminal(termOpts as ConstructorParameters<typeof Terminal>[0]);

        const fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.loadAddon(new WebLinksAddon());

        instance = { terminal, fitAddon };
        terminalInstances.set(tab.id, instance);
      }

      if (cancelled) return;

      // Re-attach the terminal if its parent is a different container.
      // Track whether we actually moved the element to a new container —
      // that's the case where we need a full renderer reset (clear glyph
      // atlas + force SIGWINCH) so TUI apps like Claude redraw cleanly.
      const currentParent = instance.terminal.element?.parentElement;
      const wasReparented = !!existingInstance && currentParent !== container;
      if (currentParent !== container) {
        if (instance.terminal.element) {
          container.appendChild(instance.terminal.element);
        } else {
          instance.terminal.open(container);
        }
      }

      // Immediate fit attempt — reading offsetWidth triggers a synchronous
      // reflow so dimensions are often already available after open().
      safeFit(tab.id);

      // Deferred fit as safety-net (covers edge-cases where layout isn't
      // settled on the first synchronous reflow). When we just reparented
      // the xterm element, do a full renderer reset instead of a plain fit
      // — fitAddon.fit() alone won't fire onResize when dimensions are
      // unchanged, leaving Claude's cached UI stale.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (wasReparented) {
            forceTerminalRedraw(tab.id, tab.sessionId, tab.type);
          } else {
            safeFit(tab.id);
          }
        });
      });

      // ── Listener setup ─────────────────────────────────────
      cleanupTabListeners(tab.id);

      const setupConnection = async () => {

      if (cancelled) return;

      let eventPrefix: string;
      let writeCmd: string;
      let resizeCmd: string | null;

      if (tab.type === "ssh") {
        eventPrefix = "ssh";
        writeCmd = "write_to_ssh";
        resizeCmd = "resize_ssh";
      } else if (tab.type === "serial") {
        eventPrefix = "serial";
        writeCmd = "write_to_serial";
        resizeCmd = null;
      } else {
        eventPrefix = "pty";
        writeCmd = "write_to_pty";
        resizeCmd = "resize_pty";
      }

      const unlistenData = await listen<string>(
        `${eventPrefix}-data-${tab.sessionId}`,
        (event) => { instance?.terminal.write(event.payload); }
      );
      if (cancelled) { unlistenData(); return; }

      const unlistenExit = await listen(
        `${eventPrefix}-exit-${tab.sessionId}`,
        () => { instance?.terminal.write(`\r\n\x1b[33m${t('term_session_ended')}\x1b[0m\r\n`); }
      );
      if (cancelled) { unlistenData(); unlistenExit(); return; }

      const dataDispose = instance!.terminal.onData((data) => {
        invoke(writeCmd, { sessionId: tab.sessionId, data }).catch(() => {});
      });

      let resizeDispose: { dispose(): void } | null = null;
      if (resizeCmd) {
        const cmd = resizeCmd;
        resizeDispose = instance!.terminal.onResize(({ rows, cols }) => {
          if (tab.type === "ssh") {
            invoke(cmd, { sessionId: tab.sessionId, cols, rows }).catch(() => {});
          } else {
            invoke(cmd, { sessionId: tab.sessionId, rows, cols }).catch(() => {});
          }
        });
      }

      if (cancelled) {
        unlistenData(); unlistenExit();
        try { dataDispose.dispose(); } catch {}
        try { resizeDispose?.dispose(); } catch {}
        return;
      }

      // Store listener cleanup in the global map so it can be called from
      // anywhere (next effect run, unmount, or destroyTerminal).
      tabListenerCleanups.set(tab.id, () => {
        unlistenData();
        unlistenExit();
        try { dataDispose.dispose(); } catch {}
        try { resizeDispose?.dispose(); } catch {}
      });

      const session = sessionsRef.current.find((s) => s.id === tab.sessionId);

      const buildSshParams = (sess: typeof session) => ({
        sessionId: tab.sessionId,
        host: sess?.host ?? "",
        port: sess?.port ?? 22,
        username: sess?.username ?? "root",
        password: sess?.password ?? null,
        privateKeyPath: sess?.private_key_path ?? null,
        authMethod: sess?.auth_method ?? "password",
        totpCode: sess?.totp_code ?? null,
        jumpHost: sess?.jump_host ?? null,
        jumpPort: sess?.jump_port ?? 22,
        jumpUsername: sess?.jump_username ?? null,
        jumpPassword: sess?.jump_password ?? null,
        jumpPrivateKeyPath: sess?.jump_private_key_path ?? null,
        proxyType: sess?.proxy_type ?? null,
        proxyHost: sess?.proxy_host ?? null,
        proxyPort: sess?.proxy_port ?? 1080,
        proxyUsername: sess?.proxy_username ?? null,
        proxyPassword: sess?.proxy_password ?? null,
        connectionTimeout: sess?.connection_timeout ?? 30,
        rows: instance!.terminal.rows,
        cols: instance!.terminal.cols,
      });

      const doSshConnect = async (sess: typeof session): Promise<void> => {
        try {
          await invoke("ssh_connect", buildSshParams(sess));
        } catch (rawErr) {
          const errStr = String(rawErr);
          if (errStr.startsWith("FINGERPRINT_UNKNOWN:") || errStr.startsWith("FINGERPRINT_MISMATCH:")) {
            const parts = errStr.split(":");
            const isMismatch = parts[0] === "FINGERPRINT_MISMATCH";
            const fingerprint = `${parts[1]}:${parts[2]}`;
            const keyType = parts.slice(3).join(":") || "unknown";
            const host = sess?.host ?? "";
            const port = sess?.port ?? 22;

            const accepted = await new Promise<boolean>((resolve) => {
              fingerprintResolveRef.current = resolve;
              setFingerprintInfo({ fingerprint, keyType, host, port });
            });
            setFingerprintInfo(null);

            if (accepted && !isMismatch) {
              await invoke("ssh_trust_host", { host, port, fingerprint, keyType });
              await invoke("ssh_connect", buildSshParams(sess));
            } else if (isMismatch) {
              instance?.terminal.write(
                `\r\n\x1b[31m[SECURITY] ${t('fp_mismatch_warning')}\x1b[0m\r\n` +
                `\r\n\x1b[31m${t('fp_current_fingerprint', { fingerprint })}\x1b[0m\r\n` +
                `\r\n\x1b[33m${t('fp_mismatch_hint')}\x1b[0m\r\n`
              );
            } else {
              instance?.terminal.write(`\r\n\x1b[33m[${t('fp_cancelled')}]\x1b[0m\r\n`);
            }
            return;
          }
          throw rawErr;
        }
      };

      // Only establish backend connection if not already connected (avoids race on split-mode transitions)
      const alreadyConnected = connectedTabs.has(tab.id);
      if (!alreadyConnected) {
        connectedTabs.add(tab.id);
      }

      try {
        if (!alreadyConnected) {
        if (tab.type === "localshell") {
          // Wait for layout to settle so the PTY is created with the
          // terminal's real dimensions instead of the default 80×24.
          // Without this the shell outputs text formatted for 80 cols
          // but xterm renders at the actual (larger) width → garbled.
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                safeFit(tab.id);
                resolve();
              });
            });
          });
          if (cancelled) return;

          instance?.terminal.write(`\r\n\x1b[90m${t('term_starting_shell')}\x1b[0m\r\n`);
          await invoke("create_local_shell", {
            sessionId: tab.sessionId,
            rows: instance!.terminal.rows,
            cols: instance!.terminal.cols,
            shellName: session?.shell_name ?? null,
            workingDir: session?.working_dir ?? null,
            charset: session?.charset ?? null,
          });
          if (session?.init_command) {
            const cmd = session.init_command;
            setTimeout(() => {
              invoke("write_to_pty", { sessionId: tab.sessionId, data: cmd + "\n" }).catch(() => {});
            }, 300);
          }
        } else if (tab.type === "ssh") {
          if (!session?.host) {
            instance?.terminal.write(`\r\n\x1b[31m${t('term_ssh_not_found')}\x1b[0m\r\n`);
          } else {
            // Wait for layout to settle so request_pty is sized to the
            // actual terminal dimensions instead of the default 80×24.
            // Without this the remote shell formats output for 80 cols
            // while xterm renders at the real (wider) width → garbled.
            await new Promise<void>((resolve) => {
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  safeFit(tab.id);
                  resolve();
                });
              });
            });
            if (cancelled) return;

            instance?.terminal.write(
              `\r\n\x1b[90m${t('term_connecting', { user: session.username || 'root', host: session.host, port: session.port || 22 })}` +
              `${session.jump_host ? ` ${t('term_via_jump', { jumpHost: session.jump_host })}` : ''}` +
              `${session.proxy_type && session.proxy_type !== 'none' ? ` ${t('term_via_proxy', { proxyType: session.proxy_type })}` : ''}` +
              `...\x1b[0m\r\n`
            );
            await doSshConnect(session);

            if (session.tunnel_enabled && session.tunnel_local_port && session.tunnel_remote_host && session.tunnel_remote_port) {
              try {
                const actualPort = await invoke<number>("start_tunnel", {
                  sessionId: tab.sessionId,
                  host: session.host,
                  port: session.port ?? 22,
                  username: session.username ?? "root",
                  password: session.password ?? null,
                  privateKeyPath: session.private_key_path ?? null,
                  authMethod: session.auth_method ?? "password",
                  jumpHost: session.jump_host ?? null,
                  jumpPort: session.jump_port ?? 22,
                  jumpUsername: session.jump_username ?? null,
                  jumpPassword: session.jump_password ?? null,
                  jumpPrivateKeyPath: session.jump_private_key_path ?? null,
                  proxyType: session.proxy_type ?? null,
                  proxyHost: session.proxy_host ?? null,
                  proxyPort: session.proxy_port ?? 1080,
                  proxyUsername: session.proxy_username ?? null,
                  proxyPassword: session.proxy_password ?? null,
                  localPort: session.tunnel_local_port,
                  remoteHost: session.tunnel_remote_host,
                  remotePort: session.tunnel_remote_port,
                });
                instance?.terminal.write(
                  `\r\n\x1b[90m${t('term_tunnel_ok', { localPort: actualPort, remoteHost: session.tunnel_remote_host!, remotePort: session.tunnel_remote_port! })}\x1b[0m\r\n`
                );
              } catch (tunnelErr) {
                instance?.terminal.write(`\r\n\x1b[33m${t('term_tunnel_fail', { error: String(tunnelErr) })}\x1b[0m\r\n`);
              }
            }
          }
        } else if (tab.type === "serial") {
          if (!session?.serial_port) {
            instance?.terminal.write(`\r\n\x1b[31m${t('term_serial_not_configured')}\x1b[0m\r\n`);
          } else {
            instance?.terminal.write(
              `\r\n\x1b[90m${t('term_opening_serial', { port: session.serial_port, baud: session.serial_baud_rate || '115200' })}\x1b[0m\r\n`
            );
            await invoke("serial_open", {
              sessionId: tab.sessionId,
              portName: session.serial_port,
              baudRate: parseInt(session.serial_baud_rate || "115200", 10),
              dataBits: session.serial_data_bits || "8",
              stopBits: session.serial_stop_bits || "1",
              parity: session.serial_parity || "None",
            });
          }
        }
        } // end if (!alreadyConnected)
      } catch (err) {
        instance?.terminal.write(`\r\n\x1b[31m${t('term_conn_error', { error: String(err) })}\x1b[0m\r\n`);
      }
    };

      setupConnection();
    }; // end initTerminal

    initTerminal();

    return () => {
      cancelled = true;
      cleanupTabListeners(tab.id);
      // Only close backend connection if tab is being removed (not just relocated to split pane)
      const store = useAppStore.getState();
      const tabStillExists = store.tabs.some(t2 => t2.id === tab.id);
      if (!tabStillExists) {
        connectedTabs.delete(tab.id);
        const closeCmd = tab.type === "ssh" ? "close_ssh" : tab.type === "serial" ? "close_serial" : "close_pty";
        invoke(closeCmd, { sessionId: tab.sessionId }).catch(() => {});
      }
    };
  }, [tab.id, tab.sessionId, tab.type, getThemeColors]);

  // Update terminal theme when app theme changes
  useEffect(() => {
    const inst = terminalInstances.get(tab.id);
    if (inst) {
      inst.terminal.options.theme = getThemeColors();
    }
  }, [theme, tab.id, getThemeColors]);

  useEffect(() => {
    if (isActive) {
      const inst = terminalInstances.get(tab.id);
      if (inst) {
        // Double-RAF: wait for layout to settle (especially after
        // display:none → block). Going from hidden → visible may leave the
        // glyph atlas stale and the cached TUI state out of sync, so do a
        // full renderer reset instead of a plain fit.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            forceTerminalRedraw(tab.id, tab.sessionId, tab.type);
            try { inst.terminal.focus(); } catch {}
          });
        });
      }
    }
  }, [isActive, tab.id, tab.sessionId, tab.type]);

  // Use ResizeObserver on the container element so that ANY size change –
  // sidebar collapse/expand, split-pane open/close, window resize, SFTP panel
  // toggle – automatically re-fits the terminal.  A 150ms debounce avoids
  // thrashing during CSS transitions (sidebar 0.2s ease) and ensures we fit
  // to the *final* size.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let timerId: ReturnType<typeof setTimeout> | null = null;
    let lastW = el.offsetWidth;
    let lastH = el.offsetHeight;
    const observer = new ResizeObserver(() => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      // Only react to actual dimension changes (ignore sub-pixel jitter)
      if (w === lastW && h === lastH) return;
      lastW = w;
      lastH = h;
      if (timerId) clearTimeout(timerId);
      timerId = setTimeout(() => {
        safeFit(tab.id);
      }, 150);
    });
    observer.observe(el);

    // Detect browser zoom (Ctrl+/−) via devicePixelRatio changes.
    // When DPR changes, character cell sizes change → must rebuild the
    // glyph texture atlas, refit rows/cols and notify the PTY.
    let currentDpr = window.devicePixelRatio;
    let activeDprMedia: MediaQueryList | null = null;
    const handleDprChange = () => {
      if (window.devicePixelRatio !== currentDpr) {
        currentDpr = window.devicePixelRatio;
        setupDprListener();
        if (timerId) clearTimeout(timerId);
        timerId = setTimeout(() => {
          const inst = terminalInstances.get(tab.id);
          if (inst) {
            try { inst.terminal.clearTextureAtlas(); } catch {}
          }
          safeFit(tab.id);
        }, 100);
      }
    };
    const setupDprListener = () => {
      if (activeDprMedia) activeDprMedia.removeEventListener("change", handleDprChange);
      activeDprMedia = window.matchMedia(`screen and (resolution: ${currentDpr}dppx)`);
      activeDprMedia.addEventListener("change", handleDprChange);
    };
    setupDprListener();

    return () => {
      if (timerId) clearTimeout(timerId);
      observer.disconnect();
      if (activeDprMedia) activeDprMedia.removeEventListener("change", handleDprChange);
    };
  }, [tab.id]);

  return (
    <>
      <div
        ref={containerRef}
        className="terminal-pane"
        style={{ display: (forceVisible || isActive) ? "block" : "none" }}
      />

      {fingerprintInfo && isActive && (
        <div className="fingerprint-overlay">
          <div className="fingerprint-dialog">
            <div className="fingerprint-dialog-title">🔒 {t('fp_title')}</div>
            <div className="fingerprint-dialog-body">
              <p>{t('fp_desc')}</p>
              <div className="fingerprint-host">{fingerprintInfo.host}:{fingerprintInfo.port}</div>
              <div className="fingerprint-hash">
                <span className="fingerprint-label">{fingerprintInfo.keyType}</span>
                <code>{fingerprintInfo.fingerprint}</code>
              </div>
              <p className="fingerprint-warning">
                {t('fp_warning')}
              </p>
            </div>
            <div className="fingerprint-dialog-footer">
              <button
                className="fingerprint-btn fingerprint-btn-reject"
                onClick={() => fingerprintResolveRef.current(false)}
              >
                {t('fp_reject')}
              </button>
              <button
                className="fingerprint-btn fingerprint-btn-accept"
                onClick={() => fingerprintResolveRef.current(true)}
              >
                {t('fp_accept')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};