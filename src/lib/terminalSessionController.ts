import type { MutableRefObject } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { TFunction } from 'i18next';
import type { SessionConfig, TabInfo } from '../types';
import { useAppStore } from '../stores/appStore';
import { useSettingsStore } from '../stores/settingsStore';
import { terminalInstances, type TerminalInstance } from '../components/Terminal/terminalRegistry';
import type { FingerprintInfo, TerminalContextMenuState } from '../components/Terminal/types';
import * as commandHistory from './commandHistory';
import { resolveTerminalTheme } from './terminalThemes';
import { runLoginScript } from './sendScript';
import { applyGroupDefaults, loadGroupDefaults } from './groupDefaults';
import { buildDockerHost, buildSshConnectParams } from './terminalConnectors';
import { attachWebglRenderer } from './terminalRenderer';
import { buildCompletions } from './completion';
import { applyInput, createLineTracker, readBufferRange } from './inputLineTracker';
import { listenTypedEvent, type DockerCancelPayload, type DockerPickPayload } from './ipcEvents';
import { tableForRemoteShell } from './commandDictionary';
import { getXtermWindowsPty } from './terminalPtyOptions';
import { appendTerminalOutput, setTerminalCwd } from './terminalContext';
import { cellSize, getOsInfo, isInteractiveTerminal } from './terminalPlatform';
import {
  awaitingPassword,
  awaitingPasswordTimer,
  completionAccept,
  completionNav,
  lineTrackers,
  normalizeTable,
  REMOTE_OS_TTL_MS,
  remoteOsCache,
  syncTable,
  tabAvailableCommands,
  tabCommandTable,
  tabCompletionIdx,
  tabCompletions,
  tabCwd,
  tabInputSenders,
  tabScope,
} from './terminalCompletionState';
import { PASSWORD_PROMPT_RE } from './terminalClipboard';
import {
  cleanupTabListeners,
  cleanupTerminalInteractions,
  connectedTabs,
  destroyTerminal,
  forceTerminalRedraw,
  pendingBackendResize,
  reconnectableTabs,
  safeFit,
  scheduleTerminalFit,
  scheduleTerminalResizeSettle,
  sendInputToTab,
  sentFirstResize,
  tabListenerCleanups,
} from './terminalLifecycle';
import { buildVscodeTerminalOptions } from './terminalVscodeOptions';
import { attachShellIntegration } from './shellIntegration';
import { handleTerminalLinkActivate } from './terminalLinks';
import { parseHostKeyError } from './hostKeyError';
import {
  attachBellAudio,
  attachTerminalInteractions,
  attachWheelZoom,
  hideCompletions,
  paintCompletions,
} from './terminalInteractions';
import i18n from '../i18n';

// eslint-disable-next-line no-control-regex -- ANSI escape sequence, control chars intentional
const ANSI_RE = /\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;

export interface MountTerminalSessionOptions {
  tab: TabInfo;
  container: HTMLDivElement;
  sessionsRef: MutableRefObject<SessionConfig[]>;
  selectionSnapshotRef: MutableRefObject<string>;
  fingerprintResolveRef: MutableRefObject<(accepted: boolean) => void>;
  isSshBacked: () => boolean;
  maybePasteText: (text: string) => void;
  setContextMenu: (state: TerminalContextMenuState | null) => void;
  setFingerprintInfo: (info: FingerprintInfo | null) => void;
  setTerminalReady: (ready: boolean) => void;
  t: TFunction<'gwshell', undefined>;
}

/**
 * Mounts (or reparents) a terminal instance into `container`, wires backend
 * data/exit streams, input coalescing, completion/broadcast hooks, and kicks
 * off the protocol connection. Returns a cleanup function for React teardown.
 */
export function mountTerminalSession(opts: MountTerminalSessionOptions): () => void {
  const {
    tab,
    container,
    sessionsRef,
    selectionSnapshotRef,
    fingerprintResolveRef,
    isSshBacked,
    maybePasteText,
    setContextMenu,
    setFingerprintInfo,
    setTerminalReady,
    t,
  } = opts;

  let cancelled = false;
  let resolveDockerPick: ((id: string | null) => void) | null = null;
  let cancelDockerPick: (() => void) | null = null;
  const initScriptTimers: ReturnType<typeof setTimeout>[] = [];
  const initScriptCancels: (() => void)[] = [];
  const mountDisposes: { dispose(): void }[] = [];
  let disposeBell: (() => void) | null = null;
  let disposeWheel: (() => void) | null = null;

  const disposeMountHooks = () => {
    while (mountDisposes.length > 0) {
      const d = mountDisposes.pop();
      try {
        d?.dispose();
      } catch {}
    }
    try {
      disposeBell?.();
    } catch {}
    disposeBell = null;
    try {
      disposeWheel?.();
    } catch {}
    disposeWheel = null;
  };

  const usesLocalPty = (): boolean => {
    if (tab.type === 'localshell') return true;
    if (tab.type === 'docker') {
      const dsess = sessionsRef.current.find((s) => s.id === tab.sessionId);
      return (dsess?.docker_connect_method ?? '').toLowerCase() !== 'ssh';
    }
    return false;
  };

  const closeBackendSession = () => {
    const isSshDocker =
      tab.type === 'docker' &&
      (
        sessionsRef.current.find((s) => s.id === tab.sessionId)?.docker_connect_method ?? ''
      ).toLowerCase() === 'ssh';
    const closeCmd =
      tab.type === 'ssh' || isSshDocker
        ? 'close_ssh'
        : tab.type === 'serial'
          ? 'close_serial'
          : 'close_pty';
    invoke(closeCmd, { sessionId: tab.sessionId }).catch(() => {});
  };

  const extractPrimaryFontFamily = (rawFont: string): string | null => {
    const first = rawFont
      .split(',')[0]
      ?.trim()
      .replace(/^["']+|["']+$/g, '');
    if (!first) return null;
    const lower = first.toLowerCase();
    if (
      lower === 'monospace' ||
      lower === 'sans-serif' ||
      lower === 'serif' ||
      lower === 'system-ui' ||
      lower === 'ui-monospace'
    ) {
      return null;
    }
    return first;
  };

  const initTerminal = async () => {
    const existingInstance = terminalInstances.get(tab.id);
    let instance: TerminalInstance | undefined = existingInstance;
    const osInfo = await getOsInfo();
    if (cancelled) return;
    const isWindowsConpty = osInfo.os === 'windows' && usesLocalPty();

    if (!instance) {
      const s = useSettingsStore.getState().settings;
      const termOpts = buildVscodeTerminalOptions(
        s,
        resolveTerminalTheme(s.terminalColorScheme, useAppStore.getState().theme),
      );
      const windowsPty = getXtermWindowsPty(osInfo, usesLocalPty());
      if (windowsPty) termOpts.windowsPty = windowsPty;
      termOpts.vtExtensions = {
        win32InputMode: isWindowsConpty,
        kittyKeyboard: false,
      };

      try {
        const primaryFont = extractPrimaryFontFamily(s.terminalFont || '');
        if (primaryFont && typeof document !== 'undefined' && document.fonts?.load) {
          const fs = parseInt(s.terminalFontSize) || 13;
          await Promise.race([
            document.fonts.load(`${fs}px "${primaryFont.replace(/"/g, '')}"`),
            new Promise<void>((resolve) => setTimeout(resolve, 600)),
          ]);
        }
      } catch {
        // Non-fatal
      }
      if (cancelled) return;

      const terminal = new Terminal(termOpts);
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      const searchAddon = new SearchAddon();
      terminal.loadAddon(searchAddon);
      terminal.loadAddon(new WebLinksAddon(handleTerminalLinkActivate));
      attachShellIntegration(tab.id, terminal);

      instance = { terminal, fitAddon, searchAddon };
      terminalInstances.set(tab.id, instance);
    }

    if (cancelled) return;

    const currentParent = instance.terminal.element?.parentElement;
    const wasReparented = !!existingInstance && currentParent !== container;
    const wasFreshlyOpened = !instance.terminal.element;
    if (currentParent !== container) {
      if (instance.terminal.element) {
        container.appendChild(instance.terminal.element);
      } else {
        instance.terminal.open(container);
      }
    }
    setTerminalReady(true);

    attachTerminalInteractions({
      tab,
      terminal: instance.terminal,
      selectionSnapshotRef,
      maybePasteText,
      setContextMenu,
    });

    attachWebglRenderer(instance, tab, wasFreshlyOpened, isSshBacked);

    if (isWindowsConpty) {
      try {
        const da1Dispose = instance.terminal.parser.registerCsiHandler({ final: 'c' }, (params) => {
          if (params.length === 0 || (params.length === 1 && params[0] === 0)) {
            sendInputToTab(tab.id, '\x1b[?61;4c');
            return true;
          }
          return false;
        });
        mountDisposes.push(da1Dispose);
      } catch {}
    }

    safeFit(tab.id);

    const instNow = terminalInstances.get(tab.id);
    if (instNow && container.clientWidth > 0 && instNow.terminal.cols > 0) {
      const { w, h } = cellSize(instNow.terminal, container);
      container.style.setProperty('--cell-w', `${w}px`);
      container.style.setProperty('--cell-h', `${h}px`);
      const parentEl = container.parentElement;
      if (parentEl) {
        parentEl.style.setProperty('--cell-w', `${w}px`);
        parentEl.style.setProperty('--cell-h', `${h}px`);
      }
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        if (wasReparented) {
          forceTerminalRedraw(tab.id, tab.sessionId, tab.type, isSshBacked());
        } else {
          scheduleTerminalFit(tab.id);
          scheduleTerminalResizeSettle(tab.id, tab.sessionId, tab.type, 80, isSshBacked());
        }
      });
    });

    disposeBell = attachBellAudio(instance.terminal);
    disposeWheel = attachWheelZoom(tab.id, instance.terminal.element);

    // ── Listener setup ─────────────────────────────────────
    cleanupTabListeners(tab.id);

    const setupConnection = async () => {
      if (cancelled || !instance) return;

      let eventPrefix: string;
      let writeCmd: string;
      let resizeCmd: string | null;

      if (tab.type === 'ssh') {
        eventPrefix = 'ssh';
        writeCmd = 'write_to_ssh';
        resizeCmd = 'resize_ssh';
      } else if (tab.type === 'serial') {
        eventPrefix = 'serial';
        writeCmd = 'write_to_serial';
        resizeCmd = null;
      } else if (tab.type === 'docker') {
        const dsess = sessionsRef.current.find((s) => s.id === tab.sessionId);
        const isSshDocker = (dsess?.docker_connect_method ?? '').toLowerCase() === 'ssh';
        eventPrefix = isSshDocker ? 'ssh' : 'pty';
        writeCmd = isSshDocker ? 'write_to_ssh' : 'write_to_pty';
        resizeCmd = isSshDocker ? 'resize_ssh' : 'resize_pty';
      } else {
        eventPrefix = 'pty';
        writeCmd = 'write_to_pty';
        resizeCmd = 'resize_pty';
      }

      let renderQueue = '';
      let renderRaf = 0;
      const RENDER_CAP = 1 << 18;
      const flushRender = () => {
        renderRaf = 0;
        if (!renderQueue) return;
        const chunk = renderQueue;
        renderQueue = '';
        instance?.terminal.write(chunk);
      };
      const enqueueRender = (payload: string) => {
        appendTerminalOutput(tab.id, payload);
        if (payload) {
          const stripped = payload.replace(ANSI_RE, '');
          if (PASSWORD_PROMPT_RE.test(stripped)) {
            awaitingPassword.set(tab.id, true);
            const prev = awaitingPasswordTimer.get(tab.id);
            if (prev) clearTimeout(prev);
            awaitingPasswordTimer.set(
              tab.id,
              setTimeout(() => {
                awaitingPassword.delete(tab.id);
                awaitingPasswordTimer.delete(tab.id);
              }, 5000),
            );
          }
        }
        renderQueue += payload;
        if (renderQueue.length >= RENDER_CAP) {
          if (renderRaf) {
            cancelAnimationFrame(renderRaf);
            renderRaf = 0;
          }
          flushRender();
          return;
        }
        if (!renderRaf) renderRaf = requestAnimationFrame(flushRender);
      };

      const logName =
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        sessionsRef.current.find((s) => s.id === tab.sessionId)?.name || tab.title || tab.sessionId;
      let logQueue = '';
      let logTimer: ReturnType<typeof setTimeout> | null = null;
      let logDisposed = false;
      const flushLog = () => {
        logTimer = null;
        if (!logQueue) return;
        const data = logQueue.replace(ANSI_RE, '');
        logQueue = '';
        if (!data) return;
        invoke('append_session_log', { sessionName: logName, data }).catch(() => {});
      };
      const enqueueLog = (payload: string) => {
        if (logDisposed || !useSettingsStore.getState().settings.sessionLogEnabled) return;
        logQueue += payload;
        logTimer ??= setTimeout(flushLog, 1000);
      };

      const unlistenData = await listen<string>(`${eventPrefix}-data-${tab.sessionId}`, (event) => {
        enqueueRender(event.payload);
        enqueueLog(event.payload);
      });
      if (cancelled) {
        unlistenData();
        return;
      }

      const unlistenExit = await listen(`${eventPrefix}-exit-${tab.sessionId}`, () => {
        flushRender();
        instance?.terminal.write(`\r\n\x1b[33m${t('term_session_ended')}\x1b[0m\r\n`);
        useAppStore.getState().updateTabConnected(tab.id, false);
        if (tab.type === 'ssh' || tab.type === 'serial') {
          instance?.terminal.write(`\x1b[33m${t('term_press_any_key_to_reconnect')}\x1b[0m\r\n`);
          reconnectableTabs.add(tab.id);
        }
      });
      if (cancelled) {
        unlistenData();
        unlistenExit();
        return;
      }

      let writeQueue = '';
      let writeTimer: ReturnType<typeof setTimeout> | null = null;
      let writesInFlight = 0;
      let writeDisposed = false;
      let consecutiveWriteRetries = 0;
      const WRITE_FLUSH_MS = 8;
      const WRITE_RETRY_MS = 24;
      const WRITE_RETRY_MAX_DELAY_MS = 250;
      const WRITE_CHUNK_SIZE = 16 * 1024;
      // Watchdog only: if an invoke has not settled by then, stop waiting on it
      // so later input is not blocked behind it. The payload is NOT resent —
      // the original call may still deliver it, and resending would duplicate
      // keystrokes once the backend catches up.
      const WRITE_INVOKE_TIMEOUT_MS = 1500;
      const WRITE_MAX_IN_FLIGHT = 1;
      // Backends return "buffer full" without enqueuing when their input queue
      // is saturated (slow link / stalled remote window); only that is safe to
      // retry. ~12s of backoff before giving up on the chunk.
      const WRITE_MAX_RETRIES = 50;
      const scheduleWriteFlush = (delayMs = WRITE_FLUSH_MS) => {
        if (writeTimer || writeDisposed) return;
        writeTimer = setTimeout(flushWrites, delayMs);
      };
      const flushWrites = () => {
        writeTimer = null;
        if (!writeQueue || writeDisposed) return;
        while (writeQueue && writesInFlight < WRITE_MAX_IN_FLIGHT && !writeDisposed) {
          const payload =
            writeQueue.length > WRITE_CHUNK_SIZE
              ? writeQueue.slice(0, WRITE_CHUNK_SIZE)
              : writeQueue;
          writeQueue = writeQueue.slice(payload.length);
          writesInFlight += 1;
          let released = false;
          const release = () => {
            if (released) return;
            released = true;
            clearTimeout(watchdog);
            writesInFlight -= 1;
            if (writeQueue) scheduleWriteFlush(0);
          };
          const watchdog = setTimeout(() => {
            console.warn(`[terminal] ${writeCmd} slow; continuing without resend`);
            release();
          }, WRITE_INVOKE_TIMEOUT_MS);
          invoke(writeCmd, { sessionId: tab.sessionId, data: payload })
            .then(() => {
              consecutiveWriteRetries = 0;
            })
            .catch((err: unknown) => {
              const errText = String(err);
              const isRetryable =
                !released && isInteractiveTerminal(tab.type) && errText.includes('buffer full');
              if (isRetryable && consecutiveWriteRetries < WRITE_MAX_RETRIES) {
                consecutiveWriteRetries += 1;
                writeQueue = payload + writeQueue;
                const delay = Math.min(
                  WRITE_RETRY_MS * consecutiveWriteRetries,
                  WRITE_RETRY_MAX_DELAY_MS,
                );
                // Release the slot without the immediate re-flush so the
                // backoff below is honored.
                if (!released) {
                  released = true;
                  clearTimeout(watchdog);
                  writesInFlight -= 1;
                }
                scheduleWriteFlush(delay);
              } else {
                consecutiveWriteRetries = 0;
                console.error(`[terminal] ${writeCmd} failed:`, err);
              }
            })
            .finally(release);
        }
        if (writeQueue && writesInFlight >= WRITE_MAX_IN_FLIGHT) scheduleWriteFlush(WRITE_RETRY_MS);
      };

      const enqueueWritePayload = (payload: string) => {
        writeQueue += payload;
        if (writeQueue.length >= WRITE_CHUNK_SIZE) {
          if (writeTimer) {
            clearTimeout(writeTimer);
            writeTimer = null;
          }
          flushWrites();
        } else {
          scheduleWriteFlush();
        }
      };

      const broadcastPayload = (payload: string, isPasswordState: boolean) => {
        const app = useAppStore.getState();
        if (!app.broadcastInput || isPasswordState) return;
        for (const tb of app.tabs) {
          if (
            tb.id !== tab.id &&
            tb.connected &&
            (tb.type === 'ssh' ||
              tb.type === 'localshell' ||
              tb.type === 'serial' ||
              tb.type === 'docker')
          ) {
            sendInputToTab(tb.id, payload);
          }
        }
      };

      const osc7Dispose = instance.terminal.parser.registerOscHandler(7, (payload) => {
        const m = /^file:\/\/[^/]*(\/.*)$/.exec(payload);
        if (m) {
          let cwd: string;
          try {
            cwd = decodeURIComponent(m[1]);
          } catch {
            return false;
          }
          tabCwd.set(tab.id, cwd);
          setTerminalCwd(tab.id, cwd);
        }
        return false;
      });

      const clearPasswordFlag = () => {
        const apT = awaitingPasswordTimer.get(tab.id);
        if (apT) {
          clearTimeout(apT);
          awaitingPasswordTimer.delete(tab.id);
        }
        awaitingPassword.delete(tab.id);
      };

      const dataDispose = instance.terminal.onData((data) => {
        if (reconnectableTabs.has(tab.id)) {
          reconnectableTabs.delete(tab.id);
          void reconnect();
          return;
        }

        const wasAwaitingPassword = !!awaitingPassword.get(tab.id);
        try {
          const st = useSettingsStore.getState().settings;
          const trackingOn =
            (st.sshHistoryCmd || st.terminalCmdHint) &&
            isInteractiveTerminal(tab.type) &&
            (tab.type === 'ssh' || st.cmdHintAllSessions);
          if (trackingOn) {
            const sess = sessionsRef.current.find((s) => s.id === tab.sessionId);
            const scope = st.cmdHintScopeByHost ? tabScope(tab.type, sess) : '';
            const cwd = st.cmdHintScopeByHost ? (tabCwd.get(tab.id) ?? '') : '';
            const sessionType = tab.type;
            const table = tabCommandTable.get(tab.id) ?? syncTable(tab.type, sess);

            let tracker = lineTrackers.get(tab.id);
            if (!tracker) {
              tracker = createLineTracker();
              lineTrackers.set(tab.id, tracker);
            }
            const buffer = terminalInstances.get(tab.id)?.terminal.buffer.active;
            const result = applyInput(tracker, data, {
              cursor: () => ({
                row: (buffer?.baseY ?? 0) + (buffer?.cursorY ?? 0),
                col: buffer?.cursorX ?? 0,
              }),
              readLine: (from, to) => (buffer ? readBufferRange(buffer, from, to) : null),
              caseInsensitive: table !== 'unix',
              alternateScreen: buffer?.type === 'alternate',
            });

            if (data === '\r' || data === '\n') {
              if (st.sshHistoryCmd && result.submitted && !wasAwaitingPassword) {
                commandHistory.record(result.submitted.trim(), { scope, cwd, sessionType });
              }
              clearPasswordFlag();
            }

            if (!st.terminalCmdHint || awaitingPassword.get(tab.id)) {
              if ((tabCompletions.get(tab.id)?.length ?? 0) > 0) hideCompletions(tab.id);
            } else if (result.effect === 'show') {
              const locale = i18n.language?.startsWith('zh') ? 'zh' : 'en';
              const availableCommands = tabAvailableCommands.get(tab.id);
              const items = buildCompletions(
                tracker.buf,
                { scope, cwd, sessionType, table, availableCommands },
                locale,
              );
              tabCompletions.set(tab.id, items);
              tabCompletionIdx.set(tab.id, 0);
              completionNav.set(tab.id, false);
              paintCompletions(tab.id, items, 0, false);
            } else if (result.effect === 'hide') {
              hideCompletions(tab.id);
            }
          } else if (data === '\r' || data === '\n') {
            clearPasswordFlag();
          }
        } catch (err) {
          // Never let history/completion tracking break raw terminal input.
          console.error('[terminal] input tracking error:', err);
        }

        broadcastPayload(data, wasAwaitingPassword);
        enqueueWritePayload(data);
      });

      if (isInteractiveTerminal(tab.type)) {
        completionAccept.set(tab.id, (suffix: string) => {
          if (writeDisposed) return;
          const tracker = lineTrackers.get(tab.id);
          if (tracker) tracker.buf += suffix;
          hideCompletions(tab.id);
          broadcastPayload(suffix, !!awaitingPassword.get(tab.id));
          enqueueWritePayload(suffix);
        });
      }

      tabInputSenders.set(tab.id, (payload: string) => {
        if (writeDisposed || !payload) return;
        enqueueWritePayload(payload);
      });

      let resizeDispose: { dispose(): void } | null = null;
      if (resizeCmd) {
        const cmd = resizeCmd;
        const tabId = tab.id;
        const sessionId = tab.sessionId;
        const isSsh = cmd === 'resize_ssh';
        resizeDispose = instance.terminal.onResize(({ rows, cols }) => {
          const fire = () => {
            if (isSsh) {
              invoke(cmd, { sessionId, cols, rows }).catch(() => {});
            } else {
              invoke(cmd, { sessionId, rows, cols }).catch(() => {});
            }
          };
          if (!sentFirstResize.has(tabId)) {
            sentFirstResize.add(tabId);
            fire();
            return;
          }
          const existing = pendingBackendResize.get(tabId);
          if (existing) clearTimeout(existing);
          pendingBackendResize.set(
            tabId,
            setTimeout(() => {
              pendingBackendResize.delete(tabId);
              fire();
            }, 40),
          );
        });
      }

      if (cancelled) {
        unlistenData();
        unlistenExit();
        try {
          dataDispose.dispose();
        } catch {}
        try {
          resizeDispose?.dispose();
        } catch {}
        try {
          osc7Dispose.dispose();
        } catch {}
        return;
      }

      tabListenerCleanups.set(tab.id, () => {
        unlistenData();
        unlistenExit();
        if (renderRaf) {
          cancelAnimationFrame(renderRaf);
          renderRaf = 0;
        }
        if (renderQueue) {
          const chunk = renderQueue;
          renderQueue = '';
          try {
            instance?.terminal.write(chunk);
          } catch {}
        }
        if (logTimer) clearTimeout(logTimer);
        flushLog();
        logDisposed = true;
        writeDisposed = true;
        if (writeTimer) {
          clearTimeout(writeTimer);
          writeTimer = null;
        }
        writeQueue = '';
        const pendingResize = pendingBackendResize.get(tab.id);
        if (pendingResize) {
          clearTimeout(pendingResize);
          pendingBackendResize.delete(tab.id);
        }
        sentFirstResize.delete(tab.id);
        disposeMountHooks();
        try {
          dataDispose.dispose();
        } catch {}
        try {
          resizeDispose?.dispose();
        } catch {}
        try {
          osc7Dispose.dispose();
        } catch {}
        completionAccept.delete(tab.id);
        tabInputSenders.delete(tab.id);
        tabCompletions.delete(tab.id);
        tabCompletionIdx.delete(tab.id);
        completionNav.delete(tab.id);
        const lineTracker = lineTrackers.get(tab.id);
        if (lineTracker) {
          lineTracker.inPaste = false;
          lineTracker.pasteBuf = '';
        }
        clearPasswordFlag();
      });

      const rawSession = sessionsRef.current.find((s) => s.id === tab.sessionId);
      const session = rawSession ? applyGroupDefaults(rawSession, loadGroupDefaults()) : rawSession;

      const invokeSshConnect = (sess: typeof session): Promise<void> => {
        if (sess && !sess._temporary) {
          const groupDefaultsMap = loadGroupDefaults();
          const groupDefaults = sess.group ? (groupDefaultsMap[sess.group] ?? null) : null;
          return invoke('ssh_connect_saved', {
            sessionId: tab.sessionId,
            rows: instance.terminal.rows,
            cols: instance.terminal.cols,
            groupDefaults,
          });
        }
        return invoke(
          'ssh_connect',
          buildSshConnectParams(
            tab.sessionId,
            sess,
            instance.terminal.rows,
            instance.terminal.cols,
          ),
        );
      };

      const scheduleInitCommand = (targetWriteCmd: string, cmd: string) => {
        initScriptTimers.push(
          setTimeout(() => {
            initScriptCancels.push(
              runLoginScript((d) => {
                invoke(targetWriteCmd, { sessionId: tab.sessionId, data: d }).catch(() => {});
              }, cmd),
            );
          }, 300),
        );
      };

      const startSessionTunnel = async (sess: NonNullable<typeof session>): Promise<void> => {
        const tunnelReady =
          sess.tunnel_enabled &&
          (sess.tunnel_type === 'dynamic'
            ? !!sess.tunnel_local_port
            : !!(sess.tunnel_local_port && sess.tunnel_remote_host && sess.tunnel_remote_port));
        if (!tunnelReady) return;
        try {
          const actualPort = await invoke<number>('start_tunnel', {
            sessionId: tab.sessionId,
            host: '',
            port: 22,
            username: '',
            password: null,
            privateKeyPath: null,
            authMethod: 'none',
            jumpHost: null,
            jumpPort: 22,
            jumpUsername: null,
            jumpPassword: null,
            jumpPrivateKeyPath: null,
            proxyType: null,
            proxyHost: null,
            proxyPort: 1080,
            proxyUsername: null,
            proxyPassword: null,
            localPort: sess.tunnel_local_port ?? 0,
            remoteHost: sess.tunnel_remote_host ?? '',
            remotePort: sess.tunnel_remote_port ?? 0,
            tunnelType: sess.tunnel_type ?? 'local',
          });
          instance?.terminal.write(
            sess.tunnel_type === 'dynamic'
              ? `\r\n\x1b[90m${t('term_tunnel_socks_ok', { localPort: actualPort })}\x1b[0m\r\n`
              : sess.tunnel_type === 'remote'
                ? `\r\n\x1b[90m${t('term_tunnel_remote_ok', { port: actualPort, host: sess.tunnel_remote_host!, localPort: sess.tunnel_remote_port! })}\x1b[0m\r\n`
                : `\r\n\x1b[90m${t('term_tunnel_ok', { localPort: actualPort, remoteHost: sess.tunnel_remote_host!, remotePort: sess.tunnel_remote_port! })}\x1b[0m\r\n`,
          );
        } catch (tunnelErr) {
          instance?.terminal.write(
            `\r\n\x1b[33m${t('term_tunnel_fail', { error: String(tunnelErr) })}\x1b[0m\r\n`,
          );
        }
      };

      const probeRemoteOs = (sess: NonNullable<typeof session>) => {
        const override = tableForRemoteShell(sess.remote_shell ?? null);
        // Skip probing only when the user explicitly forced Windows CMD/PowerShell.
        // For 'auto' and 'linux', probe `$PATH` so OpenWrt/Alpine/BusyBox hosts
        // only offer commands that actually exist on that machine.
        if (override === 'cmd' || override === 'powershell') return;

        const cacheKey = sess.host ? `${sess.host}:${sess.port ?? 22}` : '';
        const cached = cacheKey ? remoteOsCache.get(cacheKey) : undefined;
        if (cached && Date.now() - cached.at < REMOTE_OS_TTL_MS) {
          tabCommandTable.set(tab.id, override ?? cached.table);
          if (cached.commands && cached.commands.size > 0) {
            tabAvailableCommands.set(tab.id, cached.commands);
          }
          return;
        }
        invoke<{ table: string; commands: string[] }>('probe_remote_env', {
          sessionId: tab.sessionId,
        })
          .then((res) => {
            const norm = override ?? normalizeTable(res.table);
            const cmdSet =
              res.commands && res.commands.length > 0 ? new Set(res.commands) : undefined;
            tabCommandTable.set(tab.id, norm);
            if (cmdSet) {
              tabAvailableCommands.set(tab.id, cmdSet);
            }
            if (cacheKey) {
              remoteOsCache.set(cacheKey, { table: norm, commands: cmdSet, at: Date.now() });
            }
          })
          .catch(() => {});
      };

      const doSshConnect = async (sess: typeof session): Promise<void> => {
        try {
          await invokeSshConnect(sess);
        } catch (rawErr) {
          const errStr = String(rawErr);
          const hostKeyError = parseHostKeyError(errStr);
          if (hostKeyError) {
            const isMismatch = hostKeyError.kind === 'mismatch';
            const { fingerprint, keyType, knownKeyType } = hostKeyError;
            const host = hostKeyError.host ?? sess?.host ?? '';
            const port = hostKeyError.port ?? sess?.port ?? 22;

            const accepted = await new Promise<boolean>((resolve) => {
              fingerprintResolveRef.current = resolve;
              setFingerprintInfo({ fingerprint, keyType, host, port, knownKeyType });
            });
            fingerprintResolveRef.current = () => {};
            if (cancelled) return;
            setFingerprintInfo(null);

            if (accepted && !isMismatch) {
              try {
                await invoke('ssh_trust_host', { host, port, fingerprint, keyType });
              } catch (trustErr) {
                instance?.terminal.write(`\r\n\x1b[31m[SECURITY] ${String(trustErr)}\x1b[0m\r\n`);
                throw new Error('HOST_KEY_ABORTED');
              }
              await doSshConnect(sess);
              return;
            }
            if (isMismatch) {
              instance?.terminal.write(
                `\r\n\x1b[31m[SECURITY] ${t('fp_mismatch_warning')}\x1b[0m\r\n` +
                  `\r\n\x1b[31m${t('fp_current_fingerprint', { fingerprint })}\x1b[0m\r\n` +
                  `\r\n\x1b[33m${t('fp_mismatch_hint')}\x1b[0m\r\n`,
              );
              throw new Error('HOST_KEY_ABORTED');
            }
            instance?.terminal.write(`\r\n\x1b[33m[${t('fp_cancelled')}]\x1b[0m\r\n`);
            throw new Error('HOST_KEY_ABORTED');
          }
          throw rawErr;
        }
      };

      const reconnect = async (): Promise<void> => {
        instance?.terminal.write(`\r\n\x1b[90m${t('term_reconnecting')}\x1b[0m\r\n`);
        tabCommandTable.delete(tab.id);
        tabAvailableCommands.delete(tab.id);
        tabCwd.delete(tab.id);
        tabCompletions.delete(tab.id);
        tabCompletionIdx.delete(tab.id);
        completionNav.delete(tab.id);
        lineTrackers.delete(tab.id);
        clearPasswordFlag();

        const rawFreshSession = sessionsRef.current.find((s) => s.id === tab.sessionId);
        const freshSession = rawFreshSession
          ? applyGroupDefaults(rawFreshSession, loadGroupDefaults())
          : rawFreshSession;
        if (tab.type === 'ssh') {
          await invoke('close_ssh', { sessionId: tab.sessionId }).catch(() => {});
        } else if (tab.type === 'serial') {
          await invoke('close_serial', { sessionId: tab.sessionId }).catch(() => {});
        }

        try {
          if (!freshSession) throw new Error('session not found in store');
          if (tab.type === 'ssh') {
            await doSshConnect(freshSession);
            if (cancelled) return;
            if (freshSession.init_command) {
              scheduleInitCommand('write_to_ssh', freshSession.init_command);
            }
            await startSessionTunnel(freshSession);
          } else if (tab.type === 'serial') {
            if (!freshSession.serial_port) throw new Error('serial port not configured');
            await invoke('serial_open', {
              sessionId: freshSession.id,
              portName: freshSession.serial_port,
              // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
              baudRate: parseInt(freshSession.serial_baud_rate || '115200', 10),
              // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
              dataBits: freshSession.serial_data_bits || '8',
              // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
              stopBits: freshSession.serial_stop_bits || '1',
              // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
              parity: freshSession.serial_parity || 'None',
              flowControl: freshSession.serial_flow_control ?? 'none',
              // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
              serialEncoding: freshSession.serial_encoding || null,
            });
            if (cancelled) return;
            if (freshSession.serial_init_commands) {
              scheduleInitCommand('write_to_serial', freshSession.serial_init_commands);
            }
          }
          if (cancelled) return;
          connectedTabs.add(tab.id);
          useAppStore.getState().updateTabConnected(tab.id, true);
          reconnectableTabs.delete(tab.id);
          if (tab.type === 'ssh' && freshSession) {
            probeRemoteOs(freshSession);
          }
        } catch (err) {
          if (cancelled) return;
          const isHostKeyAbort = err instanceof Error && err.message === 'HOST_KEY_ABORTED';
          if (!isHostKeyAbort) {
            instance?.terminal.write(`\r\n\x1b[31m${String(err)}\x1b[0m\r\n`);
          }
          instance?.terminal.write(`\x1b[33m${t('term_press_any_key_to_reconnect')}\x1b[0m\r\n`);
          reconnectableTabs.add(tab.id);
        }
      };

      const waitForLayoutFit = () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              safeFit(tab.id);
              resolve();
            });
          });
        });

      const alreadyConnected = connectedTabs.has(tab.id);
      const handleCancelledPostConnect = (): boolean => {
        if (!cancelled) return false;
        const stillExists = useAppStore.getState().tabs.some((t2) => t2.id === tab.id);
        if (!stillExists) {
          connectedTabs.delete(tab.id);
          closeBackendSession();
        } else {
          useAppStore.getState().updateTabConnected(tab.id, true);
        }
        return true;
      };

      try {
        let connectionReady = alreadyConnected;
        if (!alreadyConnected) {
          if (tab.type === 'localshell') {
            await waitForLayoutFit();
            if (cancelled) return;
            connectedTabs.add(tab.id);
            instance?.terminal.write(`\r\n\x1b[90m${t('term_starting_shell')}\x1b[0m\r\n`);
            await invoke('create_local_shell', {
              sessionId: tab.sessionId,
              rows: instance.terminal.rows,
              cols: instance.terminal.cols,
              shellName: session?.shell_name ?? null,
              workingDir: session?.working_dir ?? null,
              charset: session?.charset ?? null,
              envVars: session?.env_vars ?? null,
            });
            if (handleCancelledPostConnect()) return;
            connectionReady = true;
            if (session?.init_command) {
              scheduleInitCommand('write_to_pty', session.init_command);
            }
          } else if (tab.type === 'ssh') {
            if (!session?.host) {
              instance?.terminal.write(`\r\n\x1b[31m${t('term_ssh_not_found')}\x1b[0m\r\n`);
            } else {
              await waitForLayoutFit();
              if (cancelled) return;
              connectedTabs.add(tab.id);
              instance?.terminal.write(
                `\r\n\x1b[90m${t('term_connecting', {
                  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
                  user: session.username || 'root',
                  host: session.host,
                  port: session.port ?? 22,
                })}` +
                  `${session.jump_host ? ` ${t('term_via_jump', { jumpHost: session.jump_host })}` : ''}` +
                  `${session.proxy_type && session.proxy_type !== 'none' ? ` ${t('term_via_proxy', { proxyType: session.proxy_type })}` : ''}` +
                  `...\x1b[0m\r\n`,
              );
              await doSshConnect(session);
              if (handleCancelledPostConnect()) return;
              connectionReady = true;
              if (session.init_command) {
                scheduleInitCommand('write_to_ssh', session.init_command);
              }
              probeRemoteOs(session);
              await startSessionTunnel(session);
            }
          } else if (tab.type === 'serial') {
            if (!session?.serial_port) {
              instance?.terminal.write(`\r\n\x1b[31m${t('term_serial_not_configured')}\x1b[0m\r\n`);
            } else {
              connectedTabs.add(tab.id);
              instance?.terminal.write(
                // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
                `\r\n\x1b[90m${t('term_opening_serial', { port: session.serial_port, baud: session.serial_baud_rate || '115200' })}\x1b[0m\r\n`,
              );
              await invoke('serial_open', {
                sessionId: tab.sessionId,
                portName: session.serial_port,
                // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
                baudRate: parseInt(session.serial_baud_rate || '115200', 10),
                // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
                dataBits: session.serial_data_bits || '8',
                // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
                stopBits: session.serial_stop_bits || '1',
                // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
                parity: session.serial_parity || 'None',
                flowControl: session.serial_flow_control ?? 'none',
                // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
                serialEncoding: session.serial_encoding || null,
              });
              if (handleCancelledPostConnect()) return;
              connectionReady = true;
              if (session.serial_init_commands) {
                scheduleInitCommand('write_to_serial', session.serial_init_commands);
              }
            }
          } else if (tab.type === 'docker') {
            const method = session?.docker_connect_method ?? '';
            const tunnelId = session?.docker_ssh_tunnel ?? null;
            const dockerHost = buildDockerHost(session);
            instance?.terminal.write(`\r\n\x1b[90m${t('docker_listing')}\x1b[0m\r\n`);
            let containers: { id: string; name: string; image: string; status: string }[];
            try {
              containers = await invoke('docker_list_containers', {
                connectMethod: method,
                tunnelSessionId: tunnelId,
                dockerHost,
              });
            } catch (err) {
              instance?.terminal.write(`\r\n\x1b[31m${String(err)}\x1b[0m\r\n`);
              useAppStore.getState().updateTabConnected(tab.id, false);
              connectedTabs.delete(tab.id);
              return;
            }
            if (cancelled) return;
            if (containers.length === 0) {
              instance?.terminal.write(`\r\n\x1b[33m${t('docker_no_containers')}\x1b[0m\r\n`);
              useAppStore.getState().updateTabConnected(tab.id, false);
              connectedTabs.delete(tab.id);
              return;
            }
            const containerId = await new Promise<string | null>((resolve) => {
              resolveDockerPick = resolve;
              const unlistenPick = listenTypedEvent<DockerPickPayload>(
                'gwshell:docker-pick',
                (d) => {
                  if (d?.tabId === tab.id) {
                    cleanup();
                    resolve(d.id);
                  }
                },
              );
              const unlistenCancel = listenTypedEvent<DockerCancelPayload>(
                'gwshell:docker-cancel',
                (d) => {
                  if (d?.tabId === tab.id) {
                    cleanup();
                    resolve(null);
                  }
                },
              );
              const cleanup = () => {
                cancelDockerPick = null;
                resolveDockerPick = null;
                unlistenPick();
                unlistenCancel();
              };
              cancelDockerPick = cleanup;
              useAppStore.getState().setDockerPicker({ tabId: tab.id, containers });
            });
            cancelDockerPick = null;
            resolveDockerPick = null;
            if (cancelled) return;
            if (!containerId) {
              destroyTerminal(tab.id);
              useAppStore.getState().removeTab(tab.id);
              return;
            }
            connectedTabs.add(tab.id);
            instance?.terminal.write(`\r\n\x1b[90m${t('docker_connecting_container')}\x1b[0m\r\n`);
            await invoke('docker_exec', {
              sessionId: tab.sessionId,
              containerId,
              rows: instance.terminal.rows,
              cols: instance.terminal.cols,
              connectMethod: method,
              tunnelSessionId: tunnelId,
              dockerHost,
            });
            if (handleCancelledPostConnect()) return;
            connectionReady = true;
          }
        }
        if (cancelled) return;
        if (!connectionReady && !alreadyConnected) {
          connectedTabs.delete(tab.id);
        }
        useAppStore.getState().updateTabConnected(tab.id, connectionReady);
      } catch (err) {
        connectedTabs.delete(tab.id);
        if (cancelled) return;
        useAppStore.getState().updateTabConnected(tab.id, false);
        const isHostKeyAbort = err instanceof Error && err.message === 'HOST_KEY_ABORTED';
        if (!isHostKeyAbort) {
          instance?.terminal.write(
            `\r\n\x1b[31m${t('term_conn_error', { error: String(err) })}\x1b[0m\r\n`,
          );
        }
        if (tab.type === 'ssh' || tab.type === 'serial') {
          reconnectableTabs.add(tab.id);
          instance?.terminal.write(`\x1b[33m${t('term_press_any_key_to_reconnect')}\x1b[0m\r\n`);
        }
      }
    };

    void setupConnection();
  };

  void initTerminal();

  return () => {
    cancelled = true;
    initScriptTimers.forEach(clearTimeout);
    initScriptCancels.forEach((fn) => fn());
    const pendingResolve = resolveDockerPick;
    cancelDockerPick?.();
    pendingResolve?.(null);
    useAppStore.getState().setDockerPicker(null);
    fingerprintResolveRef.current(false);
    cleanupTabListeners(tab.id);
    disposeMountHooks();
    cleanupTerminalInteractions(tab.id);
    const store = useAppStore.getState();
    const tabStillExists = store.tabs.some((t2) => t2.id === tab.id);
    if (!tabStillExists) {
      connectedTabs.delete(tab.id);
      useAppStore.getState().updateTabConnected(tab.id, false);
      closeBackendSession();
    }
  };
}
