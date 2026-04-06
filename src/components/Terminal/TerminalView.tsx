import React, { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { TabInfo } from '../../types';
import '@xterm/xterm/css/xterm.css';

interface TerminalViewProps {
  tab: TabInfo;
  isActive: boolean;
}

// Track terminal instances globally to avoid recreating
const terminalInstances = new Map<string, { terminal: Terminal; fitAddon: FitAddon }>();

export const TerminalView: React.FC<TerminalViewProps> = ({ tab, isActive }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);

  const getThemeColors = useCallback(() => {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    return isDark
      ? {
          background: '#0f1019',
          foreground: '#e4e6f0',
          cursor: '#4c8dff',
          cursorAccent: '#0f1019',
          selectionBackground: 'rgba(76, 141, 255, 0.3)',
          black: '#1c1e2d',
          red: '#ef4444',
          green: '#42d392',
          yellow: '#f5a623',
          blue: '#4c8dff',
          magenta: '#c084fc',
          cyan: '#22d3ee',
          white: '#e4e6f0',
          brightBlack: '#5c6078',
          brightRed: '#f87171',
          brightGreen: '#6ee7b7',
          brightYellow: '#fbbf24',
          brightBlue: '#6aa1ff',
          brightMagenta: '#d8b4fe',
          brightCyan: '#67e8f9',
          brightWhite: '#ffffff',
        }
      : {
          background: '#f5f6fa',
          foreground: '#1a1b2e',
          cursor: '#3b7dff',
          cursorAccent: '#ffffff',
          selectionBackground: 'rgba(59, 125, 255, 0.2)',
          black: '#1a1b2e',
          red: '#dc2626',
          green: '#16a34a',
          yellow: '#ca8a04',
          blue: '#3b7dff',
          magenta: '#9333ea',
          cyan: '#0891b2',
          white: '#e4e6f0',
          brightBlack: '#8b8fa7',
          brightRed: '#ef4444',
          brightGreen: '#22c55e',
          brightYellow: '#eab308',
          brightBlue: '#5b93ff',
          brightMagenta: '#a855f7',
          brightCyan: '#06b6d4',
          brightWhite: '#ffffff',
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
        cursorStyle: 'bar',
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

    // Delay fit to ensure container has dimensions
    requestAnimationFrame(() => {
      try {
        instance!.fitAddon.fit();
      } catch {}
    });

    // Set up Tauri event listeners
    const setupConnection = async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      const { listen } = await import('@tauri-apps/api/event');

      const eventPrefix = tab.type === 'ssh' ? 'ssh' : 'pty';
      const writeCmd = tab.type === 'ssh' ? 'write_to_ssh' : 'write_to_pty';
      const resizeCmd = tab.type === 'ssh' ? 'resize_ssh' : 'resize_pty';

      // Listen for data from backend
      const unlistenData = await listen<string>(`${eventPrefix}-data-${tab.sessionId}`, (event) => {
        instance?.terminal.write(event.payload);
      });

      const unlistenExit = await listen(`${eventPrefix}-exit-${tab.sessionId}`, () => {
        instance?.terminal.write('\r\n\x1b[33m[Session ended]\x1b[0m\r\n');
      });

      // Send terminal input to backend
      instance!.terminal.onData((data) => {
        invoke(writeCmd, { sessionId: tab.sessionId, data }).catch(() => {});
      });

      // Handle resize
      instance!.terminal.onResize(({ rows, cols }) => {
        if (tab.type === 'ssh') {
          invoke(resizeCmd, { sessionId: tab.sessionId, cols, rows }).catch(() => {});
        } else {
          invoke(resizeCmd, { sessionId: tab.sessionId, rows, cols }).catch(() => {});
        }
      });

      // Create session
      try {
        if (tab.type === 'localshell') {
          const { rows, cols } = instance!.terminal;
          await invoke('create_local_shell', {
            sessionId: tab.sessionId,
            rows,
            cols,
            shellPath: null,
          });
        }
        // SSH connection is initiated from the NewSessionModal
      } catch (err) {
        instance?.terminal.write(`\r\n\x1b[31mError: ${err}\x1b[0m\r\n`);
      }

      return () => {
        unlistenData();
        unlistenExit();
      };
    };

    let cleanup: (() => void) | undefined;
    setupConnection().then((fn) => {
      cleanup = fn;
    });

    return () => {
      cleanup?.();
    };
  }, [tab.id, tab.sessionId, tab.type, getThemeColors]);

  // Handle resize when tab becomes active
  useEffect(() => {
    if (isActive) {
      const instance = terminalInstances.get(tab.id);
      if (instance) {
        requestAnimationFrame(() => {
          try {
            instance.fitAddon.fit();
            instance.terminal.focus();
          } catch {}
        });
      }
    }
  }, [isActive, tab.id]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (isActive) {
        const instance = terminalInstances.get(tab.id);
        if (instance) {
          try {
            instance.fitAddon.fit();
          } catch {}
        }
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isActive, tab.id]);

  return (
    <div
      ref={containerRef}
      className="terminal-pane"
      style={{ display: isActive ? 'block' : 'none' }}
    />
  );
};

// Cleanup terminal instance when tab is removed
export const destroyTerminal = (tabId: string) => {
  const instance = terminalInstances.get(tabId);
  if (instance) {
    instance.terminal.dispose();
    terminalInstances.delete(tabId);
  }
};
