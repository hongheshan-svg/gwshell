import React, { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
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
        };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    let instance = terminalInstances.get(tab.id);

    if (!instance) {
      const terminal = new Terminal({
        fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace",
        fontSize: 13,
        lineHeight: 1.2,
        cursorBlink: true,
        cursorStyle: "bar",
        theme: getThemeColors(),
        allowProposedApi: true,
        scrollback: 10000,
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(new WebLinksAddon());

      instance = { terminal, fitAddon };
      terminalInstances.set(tab.id, instance);
    }

    // Re-attach the terminal if its parent is a different container
    const currentParent = instance.terminal.element?.parentElement;
    if (currentParent !== containerRef.current) {
      if (instance.terminal.element) {
        // Move existing xterm DOM to the new container (open() cannot be called twice in xterm v5)
        containerRef.current.appendChild(instance.terminal.element);
      } else {
        instance.terminal.open(containerRef.current);
        // Load WebGL renderer for GPU-accelerated rendering (fallback to canvas on failure)
        try {
          instance.terminal.loadAddon(new WebglAddon());
        } catch {
          // WebGL not supported, canvas renderer is fine
        }
      }
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          instance!.fitAddon.fit();
          instance!.terminal.clearTextureAtlas();
        } catch {}
      });
    });

    // ── Listener setup ─────────────────────────────────────
    // Always clean up previous listeners for this tab BEFORE registering
    // new ones.  This prevents duplicate handlers when:
    //  • React StrictMode double-invokes effects (dev mode)
    //  • Component remounts during single↔split layout transitions
    //  • Same tab rendered in multiple split panes (edge case)
    cleanupTabListeners(tab.id);

    let cancelled = false;

    const setupConnection = async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const { listen } = await import("@tauri-apps/api/event");

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

    return () => {
      cancelled = true;
      cleanupTabListeners(tab.id);
      // Only close backend connection if tab is being removed (not just relocated to split pane)
      const store = useAppStore.getState();
      const tabStillExists = store.tabs.some(t2 => t2.id === tab.id);
      if (!tabStillExists) {
        connectedTabs.delete(tab.id);
        const closeCmd = tab.type === "ssh" ? "close_ssh" : tab.type === "serial" ? "close_serial" : "close_pty";
        import("@tauri-apps/api/core").then(({ invoke }) => {
          invoke(closeCmd, { sessionId: tab.sessionId }).catch(() => {});
        });
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
        // Double-RAF: wait for layout to settle (especially after display:none → block)
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            try {
              inst.fitAddon.fit();
              inst.terminal.clearTextureAtlas();
              inst.terminal.focus();
            } catch {}
          });
        });
      }
    }
  }, [isActive, tab.id]);

  // Use ResizeObserver on the container element so that ANY size change –
  // sidebar collapse/expand, split-pane open/close, window resize, SFTP panel
  // toggle – automatically re-fits the terminal.  A 150ms debounce avoids
  // thrashing during CSS transitions (sidebar 0.2s ease) and ensures we fit
  // to the *final* size.  After fitting, clearTextureAtlas() forces the
  // renderer to rebuild its glyph cache for the new dimensions.
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
        const inst = terminalInstances.get(tab.id);
        if (inst && w > 0 && h > 0) {
          try {
            inst.fitAddon.fit();
            inst.terminal.clearTextureAtlas();
          } catch {}
        }
      }, 150);
    });
    observer.observe(el);
    return () => { if (timerId) clearTimeout(timerId); observer.disconnect(); };
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