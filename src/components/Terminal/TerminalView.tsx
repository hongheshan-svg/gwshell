import React, { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { TabInfo } from "../../types";
import { useAppStore } from "../../stores/appStore";
import "@xterm/xterm/css/xterm.css";

interface TerminalViewProps {
  tab: TabInfo;
  isActive: boolean;
}

// Global map to preserve terminal instances across re-renders
const terminalInstances = new Map<string, { terminal: Terminal; fitAddon: FitAddon }>();

export const TerminalView: React.FC<TerminalViewProps> = ({ tab, isActive }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  // Read session list once on mount — the session was added before addTab was called
  const sessions = useAppStore((s) => s.sessions);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

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
    if (!containerRef.current || initializedRef.current) return;
    initializedRef.current = true;

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

    instance.terminal.open(containerRef.current);

    requestAnimationFrame(() => {
      try { instance!.fitAddon.fit(); } catch {}
    });

    // ----------------------------------------------------------------
    // Connection setup
    // ----------------------------------------------------------------
    const setupConnection = async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const { listen } = await import("@tauri-apps/api/event");

      // Determine event/command names per session type
      let eventPrefix: string;
      let writeCmd: string;
      let resizeCmd: string | null;
      let closeCmd: string;

      if (tab.type === "ssh") {
        eventPrefix = "ssh";
        writeCmd = "write_to_ssh";
        resizeCmd = "resize_ssh";
        closeCmd = "close_ssh";
      } else if (tab.type === "serial") {
        eventPrefix = "serial";
        writeCmd = "write_to_serial";
        resizeCmd = null;
        closeCmd = "close_serial";
      } else {
        // localshell / default PTY
        eventPrefix = "pty";
        writeCmd = "write_to_pty";
        resizeCmd = "resize_pty";
        closeCmd = "close_pty";
      }

      // Subscribe to backend data/exit events
      const unlistenData = await listen<string>(
        `${eventPrefix}-data-${tab.sessionId}`,
        (event) => { instance?.terminal.write(event.payload); }
      );

      const unlistenExit = await listen(
        `${eventPrefix}-exit-${tab.sessionId}`,
        () => { instance?.terminal.write("\r\n\x1b[33m[Session ended]\x1b[0m\r\n"); }
      );

      // Forward terminal input → backend
      const dataDispose = instance!.terminal.onData((data) => {
        invoke(writeCmd, { sessionId: tab.sessionId, data }).catch(() => {});
      });

      // Forward resize → backend
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

      // Initiate the actual backend connection
      const session = sessionsRef.current.find((s) => s.id === tab.sessionId);

      try {
        if (tab.type === "localshell") {
          instance?.terminal.write("\r\n\x1b[90mStarting local shell...\x1b[0m\r\n");
          await invoke("create_local_shell", {
            sessionId: tab.sessionId,
            rows: instance!.terminal.rows,
            cols: instance!.terminal.cols,
            shellName: session?.shell_name ?? null,
            workingDir: session?.working_dir ?? null,
            charset: session?.charset ?? null,
          });
          // Send init command after shell starts
          if (session?.init_command) {
            const cmd = session.init_command;
            setTimeout(() => {
              invoke("write_to_pty", { sessionId: tab.sessionId, data: cmd + "\n" }).catch(() => {});
            }, 300);
          }
        } else if (tab.type === "ssh") {
          if (!session?.host) {
            instance?.terminal.write("\r\n\x1b[31mError: SSH session config not found\x1b[0m\r\n");
          } else {
            instance?.terminal.write(
              `\r\n\x1b[90mConnecting to ${session.username || "root"}@${session.host}:${session.port || 22}...\x1b[0m\r\n`
            );
            await invoke("ssh_connect", {
              sessionId: tab.sessionId,
              host: session.host,
              port: session.port || 22,
              username: session.username || "root",
              password: session.password ?? null,
              privateKeyPath: session.private_key_path ?? null,
              rows: instance!.terminal.rows,
              cols: instance!.terminal.cols,
            });
          }
        } else if (tab.type === "serial") {
          if (!session?.serial_port) {
            instance?.terminal.write(
              "\r\n\x1b[31mError: Serial port not configured. Please edit the session.\x1b[0m\r\n"
            );
          } else {
            instance?.terminal.write(
              `\r\n\x1b[90mOpening ${session.serial_port} @ ${session.serial_baud_rate || "115200"} baud...\x1b[0m\r\n`
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
      } catch (err) {
        instance?.terminal.write(`\r\n\x1b[31mConnection error: ${err}\x1b[0m\r\n`);
      }

      return () => {
        unlistenData();
        unlistenExit();
        dataDispose.dispose();
        resizeDispose?.dispose();
        // Close the backend session
        invoke(closeCmd, { sessionId: tab.sessionId }).catch(() => {});
      };
    };

    let cleanup: (() => void) | undefined;
    setupConnection().then((fn) => { cleanup = fn; });

    return () => { cleanup?.(); };
  }, [tab.id, tab.sessionId, tab.type, getThemeColors]);

  // Fit + focus when tab becomes active
  useEffect(() => {
    if (isActive) {
      const inst = terminalInstances.get(tab.id);
      if (inst) {
        requestAnimationFrame(() => {
          try {
            inst.fitAddon.fit();
            inst.terminal.focus();
          } catch {}
        });
      }
    }
  }, [isActive, tab.id]);

  // Refit on window resize
  useEffect(() => {
    const handleResize = () => {
      if (isActive) {
        const inst = terminalInstances.get(tab.id);
        if (inst) {
          try { inst.fitAddon.fit(); } catch {}
        }
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isActive, tab.id]);

  return (
    <div
      ref={containerRef}
      className="terminal-pane"
      style={{ display: isActive ? "block" : "none" }}
    />
  );
};

/** Call this when a tab is removed to dispose the xterm instance. */
export const destroyTerminal = (tabId: string) => {
  const inst = terminalInstances.get(tabId);
  if (inst) {
    inst.terminal.dispose();
    terminalInstances.delete(tabId);
  }
};