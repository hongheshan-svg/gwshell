import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import type { TabInfo } from '../../types';
import { useAppStore } from '../../stores/appStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { terminalInstances } from './terminalRegistry';
import * as commandHistory from '../../lib/commandHistory';
import { resolveTerminalTheme } from '../../lib/terminalThemes';
import { runLoginScript } from '../../lib/sendScript';
import { applyGroupDefaults, loadGroupDefaults } from '../../lib/groupDefaults';
import { buildDockerHost, buildSshConnectParams } from '../../lib/terminalConnectors';
import { attachWebglRenderer } from '../../lib/terminalRenderer';
import { buildCompletions, type Completion } from '../../lib/completion';
import {
  applyInput,
  createLineTracker,
  dropdownColumn,
  readBufferRange,
} from '../../lib/inputLineTracker';
import {
  listenTypedEvent,
  type DockerPickPayload,
  type DockerCancelPayload,
} from '../../lib/ipcEvents';
import { tableForRemoteShell } from '../../lib/commandDictionary';
import { getXtermWindowsPty } from '../../lib/terminalPtyOptions';
import {
  appendTerminalOutput,
  setTerminalCwd,
  setTerminalSelection,
} from '../../lib/terminalContext';
import {
  getOsInfo,
  webglDebugEnabled,
  isInteractiveTerminal,
  cellSize,
} from '../../lib/terminalPlatform';
import {
  lineTrackers,
  completionSetters,
  HIDDEN_COMPLETIONS,
  type CompletionView,
  completionAccept,
  tabCwd,
  remoteOsCache,
  REMOTE_OS_TTL_MS,
  tabCompletions,
  tabCompletionIdx,
  completionNav,
  tabInputSenders,
  awaitingPassword,
  awaitingPasswordTimer,
  tabCommandTable,
  tabScope,
  syncTable,
  normalizeTable,
  estimateDropdownRows,
} from '../../lib/terminalCompletionState';
import {
  PASSWORD_PROMPT_RE,
  isPasteAction,
  writeClipboardText,
  readClipboardText,
  readTerminalSelection,
  isCopyShortcut,
  isPasteShortcut,
} from '../../lib/terminalClipboard';
import {
  connectedTabs,
  reconnectableTabs,
  tabListenerCleanups,
  terminalInteractionCleanups,
  fitFrameIds,
  settleTimerIds,
  pendingBackendResize,
  sentFirstResize,
  cleanupTabListeners,
  cleanupTerminalInteractions,
  sendInputToTab,
  destroyTerminal,
  safeFit,
  scheduleTerminalFit,
  scheduleTerminalResizeSettle,
  forceTerminalRedraw,
} from '../../lib/terminalLifecycle';
import { buildVscodeTerminalOptions } from '../../lib/terminalVscodeOptions';
import { attachShellIntegration } from '../../lib/shellIntegration';
import { parseHostKeyError } from '../../lib/hostKeyError';
import { CompletionDropdown } from './CompletionDropdown';
import { StickyScrollOverlay } from './StickyScrollOverlay';
import { TerminalContextMenu } from './TerminalContextMenu';
import { FingerprintDialog } from './FingerprintDialog';
import { PasteConfirmDialog } from './PasteConfirmDialog';
import type { FingerprintInfo, TerminalContextMenuState } from './types';
import i18n from '../../i18n';
import '@xterm/xterm/css/xterm.css';

/**
 * Show `items` in a tab's completion dropdown (or hide it when empty). The
 * dropdown is anchored to where the typed line starts rather than to the
 * cursor, so it stays still while typing and its items line up under the line.
 */
function paintCompletions(
  tabId: string,
  items: Completion[],
  index: number,
  navigated: boolean,
): void {
  const setter = completionSetters.get(tabId);
  if (!setter) return;
  const term = terminalInstances.get(tabId)?.terminal;
  if (items.length === 0 || !term) {
    setter(HIDDEN_COMPLETIONS);
    return;
  }
  const b = term.buffer.active;
  const tracker = lineTrackers.get(tabId);
  const x = dropdownColumn(tracker?.anchor ?? null, { row: b.baseY + b.cursorY, col: b.cursorX });
  const above = b.cursorY > term.rows - estimateDropdownRows(items) - 1;
  setter({ items, index, navigated, x, y: b.cursorY, above, typedLen: tracker?.buf.length ?? 0 });
}

function hideCompletions(tabId: string): void {
  tabCompletions.set(tabId, []);
  tabCompletionIdx.set(tabId, 0);
  completionNav.set(tabId, false);
  paintCompletions(tabId, [], 0, false);
}

interface TerminalViewProps {
  tab: TabInfo;
  isActive: boolean;
  // Opt-in split: when defined, controls pane visibility independently of
  // isActive (so a non-active tab can still be shown as a side-by-side pane).
  // When undefined the pane falls back to isActive - the single-pane path,
  // byte-for-byte unchanged.
  visible?: boolean;
}

export const TerminalView: React.FC<TerminalViewProps> = ({ tab, isActive, visible }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sessions = useAppStore((s) => s.sessions);
  const theme = useAppStore((s) => s.theme);
  const terminalCmdHint = useSettingsStore((s) => s.settings.terminalCmdHint);
  const terminalFont = useSettingsStore((s) => s.settings.terminalFont);
  const terminalFontSize = useSettingsStore((s) => s.settings.terminalFontSize);
  const terminalStickyScroll = useSettingsStore((s) => s.settings.terminalStickyScroll);
  const broadcastInput = useAppStore((s) => s.broadcastInput);
  const { t } = useTranslation();
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const selectionSnapshotRef = useRef('');

  useEffect(() => {
    completionSetters.set(tab.id, setCompletionView);
    return () => {
      completionSetters.delete(tab.id);
    };
  }, [tab.id]);

  const [fingerprintInfo, setFingerprintInfo] = useState<FingerprintInfo | null>(null);
  const [contextMenu, setContextMenu] = useState<TerminalContextMenuState | null>(null);
  const [completionView, setCompletionView] = useState<CompletionView>(HIDDEN_COMPLETIONS);
  const [pasteConfirm, setPasteConfirm] = useState<string | null>(null);
  const [terminalReady, setTerminalReady] = useState<boolean>(() => terminalInstances.has(tab.id));
  const fingerprintResolveRef = useRef<(accepted: boolean) => void>(() => {});

  const isSshBacked = useCallback((): boolean => {
    if (tab.type === 'ssh') return true;
    if (tab.type === 'docker') {
      const dsess = sessionsRef.current.find((s) => s.id === tab.sessionId);
      return (dsess?.docker_connect_method ?? '').toLowerCase() === 'ssh';
    }
    return false;
  }, [tab.sessionId, tab.type]);

  useEffect(() => {
    if (pasteConfirm === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setPasteConfirm(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        terminalInstances.get(tab.id)?.terminal.paste(pasteConfirm);
        setPasteConfirm(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pasteConfirm, tab.id]);

  const copySelection = useCallback(() => {
    const inst = terminalInstances.get(tab.id);
    const terminal = inst?.terminal;
    if (!terminal) return;

    const selection = readTerminalSelection(terminal) || selectionSnapshotRef.current;
    if (selection) {
      void writeClipboardText(selection);
      terminal.clearSelection();
      selectionSnapshotRef.current = '';
    }
    terminal.focus();
    setContextMenu(null);
  }, [tab.id]);

  const maybePasteText = useCallback(
    (text: string) => {
      if (!text) return;
      if (useSettingsStore.getState().settings.pasteWarnMultiline && /[\r\n]/.test(text)) {
        setPasteConfirm(text);
      } else {
        terminalInstances.get(tab.id)?.terminal.paste(text);
      }
    },
    [tab.id],
  );

  const pasteClipboard = useCallback(() => {
    const inst = terminalInstances.get(tab.id);
    const terminal = inst?.terminal;
    if (!terminal) return;

    readClipboardText()
      .then((text) => {
        if (text) maybePasteText(text);
      })
      .catch(() => {});
    terminal.focus();
    setContextMenu(null);
  }, [tab.id, maybePasteText]);

  const selectAllTerminal = useCallback(() => {
    const inst = terminalInstances.get(tab.id);
    inst?.terminal.selectAll();
    inst?.terminal.focus();
    setContextMenu(null);
  }, [tab.id]);

  const clearTerminal = useCallback(() => {
    const inst = terminalInstances.get(tab.id);
    inst?.terminal.clear();
    inst?.terminal.focus();
    setContextMenu(null);
  }, [tab.id]);

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;
    let resolveDockerPick: ((id: string | null) => void) | null = null;
    let cancelDockerPick: (() => void) | null = null;
    const container = containerRef.current;
    // Track init-script timers so they can be cancelled on unmount/reconnect,
    // preventing a deferred runLoginScript from writing to a closed/reused session.
    const initScriptTimers: ReturnType<typeof setTimeout>[] = [];
    // runLoginScript schedules nested setTimeouts for delayed segments; collect
    // their cancel functions too so teardown aborts the whole script, not just
    // the outer 300ms trigger.
    const initScriptCancels: (() => void)[] = [];

    const initTerminal = async () => {
      const existingInstance = terminalInstances.get(tab.id);
      let instance = existingInstance;

      // Only the LOCAL PTY backend (local shell, and Docker-over-local-PTY)
      // runs through Windows ConPTY. SSH and serial sessions talk to a remote
      // Unix PTY / a serial device and never touch the local ConPTY, so
      // advertising `windowsPty` for them is wrong. Defined here (outside the
      // `if (!instance)` block) so it's available throughout initTerminal.
      const usesLocalConpty = (): boolean => {
        if (tab.type === 'localshell') return true;
        if (tab.type === 'docker') {
          const dsess = sessionsRef.current.find((s) => s.id === tab.sessionId);
          return (dsess?.docker_connect_method ?? '').toLowerCase() !== 'ssh';
        }
        return false;
      };

      // Collects dispose functions for per-tab xterm parser handlers (e.g. the
      // ConPTY DA1 response handler) that need to be torn down with the rest
      // of the tab's listeners on remount/close.
      const pendingDisposes: { dispose(): void }[] = [];

      if (!instance) {
        // Fetch platform info to configure windowsPty for the LOCAL ConPTY
        // backend on Windows (see usesLocalConpty below). This tells xterm.js
        // how to interpret ConPTY escape sequences so that local TUI apps
        // (claude, vim, htop etc.) render correctly.
        const osInfo = await getOsInfo();
        if (cancelled) return;

        const s = useSettingsStore.getState().settings;
        // VSCode-aligned terminal.integrated.* → ITerminalOptions mapping,
        // kept central in terminalVscodeOptions.ts. Per-option VSCode comments
        // live there; additional per-tab/platform-specific bits (windowsPty,
        // vtExtensions) come below.
        const termOpts = buildVscodeTerminalOptions(
          s,
          resolveTerminalTheme(
            useSettingsStore.getState().settings.terminalColorScheme,
            useAppStore.getState().theme,
          ),
        );

        // Only the LOCAL PTY backend (local shell, and Docker-over-local-PTY)
        // runs through Windows ConPTY. SSH and serial sessions talk to a remote
        // Unix PTY / a serial device and never touch the local ConPTY, so
        // advertising `windowsPty` for them is wrong.
        const windowsPty = getXtermWindowsPty(osInfo, usesLocalConpty());
        if (windowsPty) termOpts.windowsPty = windowsPty;

        // Match VSCode: enable VT extensions for ALL terminals (not just
        // local ConPTY). win32InputMode (DECSET 9001) lets ConPTY encode
        // keyboard events as Win32 INPUT_RECORD, preserving complex modifier
        // keys (Ctrl+Shift+letter, Alt+arrows). kittyKeyboard enables the kitty
        // keyboard protocol for enhanced key reporting. Both are opt-in: apps
        // must request them via CSI sequences to activate, so setting them for
        // SSH/serial is safe — remote TUI apps can then use these protocols.
        termOpts.vtExtensions = {
          win32InputMode: usesLocalConpty(),
          kittyKeyboard: false,
        };

        // Wait for the configured terminal font to load before constructing the
        // terminal. xterm measures character cell width once, on construction;
        // if the font hasn't loaded yet the fallback font's metrics are baked in
        // and every render misaligns (column drift / overlap) until something
        // forces a re-measure. Race against a 600ms cap because document.fonts
        // .load hangs indefinitely for a missing/404'd font.
        try {
          if (typeof document !== 'undefined' && document.fonts?.load) {
            const fs = parseInt(s.terminalFontSize) || 13;
            const family = (s.terminalFont || 'monospace').trim();
            await Promise.race([
              document.fonts.load(`${fs}px "${family}"`),
              new Promise<void>((resolve) => setTimeout(resolve, 600)),
            ]);
          }
        } catch {
          // Non-fatal — construct with whatever metrics the browser has.
        }
        if (cancelled) return;

        const terminal = new Terminal(termOpts);

        const fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        const searchAddon = new SearchAddon();
        terminal.loadAddon(searchAddon);
        terminal.loadAddon(new WebLinksAddon());

        // Shell integration (VSCode parity): OSC 133/633 prompt & command
        // markers drive sticky scroll and future command-navigation features.
        // Attached once per terminal so split/remount keeps the markers.
        attachShellIntegration(tab.id, terminal);

        instance = { terminal, fitAddon, searchAddon };
        terminalInstances.set(tab.id, instance);
      }

      if (cancelled) return;
      setTerminalReady(true);

      // Re-attach the terminal if its parent is a different container.
      // (renderer addon attaches after terminal.open below)
      // Track whether we actually moved the element to a new container —
      // that's the case where we need a full renderer reset (clear glyph
      // atlas + force SIGWINCH) so TUI apps like Claude redraw cleanly.
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

      // Copy/paste support: attach to the current React view so context-menu
      // state still works after tab moves or split-pane reparenting.
      if (instance.terminal.element) {
        cleanupTerminalInteractions(tab.id);
        const termEl = instance.terminal.element;
        const termRef = instance.terminal;

        const doPaste = () => {
          readClipboardText()
            .then((text) => {
              if (text) maybePasteText(text);
            })
            .catch(() => {});
        };

        const doCopy = () => {
          const sel = readTerminalSelection(termRef) || selectionSnapshotRef.current;
          if (!sel) return false;
          void writeClipboardText(sel);
          termRef.clearSelection();
          selectionSnapshotRef.current = '';
          return true;
        };

        let selectionCopyTimer: ReturnType<typeof setTimeout> | null = null;
        const copyCurrentSelection = () => {
          const selection = readTerminalSelection(termRef);
          if (!selection) return false;
          selectionSnapshotRef.current = selection;
          void writeClipboardText(selection);
          return true;
        };

        const selectionDispose = termRef.onSelectionChange(() => {
          if (termRef.hasSelection()) {
            const selection = readTerminalSelection(termRef);
            selectionSnapshotRef.current = selection;
            setTerminalSelection(tab.id, selection);
            if (selection && useSettingsStore.getState().settings.autoCopyOnSelect) {
              if (selectionCopyTimer) clearTimeout(selectionCopyTimer);
              selectionCopyTimer = setTimeout(() => {
                if (selectionSnapshotRef.current) {
                  void writeClipboardText(selectionSnapshotRef.current);
                }
              }, 120);
            }
          } else {
            selectionSnapshotRef.current = '';
            setTerminalSelection(tab.id, '');
          }
        });

        const snapshotSelection = () => {
          if (termRef.hasSelection()) {
            selectionSnapshotRef.current = readTerminalSelection(termRef);
          }
        };

        let lastRightActionAt = 0;
        const runCmdRightClickAction = () => {
          const now = Date.now();
          if (now - lastRightActionAt < 120) return;
          lastRightActionAt = now;
          setTimeout(() => {
            snapshotSelection();
            if (!doCopy()) doPaste();
            termRef.focus();
            setContextMenu(null);
          }, 0);
        };

        const handleContextMenu = (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          const s = useSettingsStore.getState().settings;
          if (isPasteAction(s.rightClickAction)) {
            runCmdRightClickAction();
          } else {
            snapshotSelection();
            setContextMenu({
              x: e.clientX,
              y: e.clientY,
              canCopy: !!(readTerminalSelection(termRef) || selectionSnapshotRef.current),
            });
            termRef.focus();
          }
        };

        const handleMouseDown = (e: MouseEvent) => {
          const s = useSettingsStore.getState().settings;
          if (e.button === 0) {
            selectionSnapshotRef.current = '';
            setTerminalSelection(tab.id, '');
            setContextMenu(null);
            return;
          }
          if (e.button === 2 && (termRef.hasSelection() || selectionSnapshotRef.current)) {
            snapshotSelection();
            return;
          }
          if (e.button === 1 && isPasteAction(s.middleClickAction)) {
            e.preventDefault();
            doPaste();
            termRef.focus();
          }
        };

        const handlePointerDown = (e: PointerEvent) => {
          if (e.button === 2) {
            snapshotSelection();
          }
        };

        const handleMouseUp = (e: MouseEvent) => {
          if (e.button === 0) {
            setTimeout(() => {
              if (useSettingsStore.getState().settings.autoCopyOnSelect) {
                copyCurrentSelection();
              }
            }, 30);
          }
          // Right-click (button 2) is handled solely by the `contextmenu`
          // event, which fires exactly once per click regardless of how long
          // the button is held. Triggering paste here too caused a second
          // paste on slow releases (outside the 120ms guard) — i.e. the
          // multi-paste bug. Keep mouseup out of the right-click path.
        };

        const handleKeyDown = (e: KeyboardEvent) => {
          if (e.defaultPrevented) return;
          const s = useSettingsStore.getState().settings;

          if (isPasteShortcut(e, s.ctrlVPaste)) {
            e.preventDefault();
            e.stopPropagation();
            doPaste();
            return;
          }

          if (isCopyShortcut(e) && (termRef.hasSelection() || selectionSnapshotRef.current)) {
            e.preventDefault();
            e.stopPropagation();
            doCopy();
          }
        };

        termRef.attachCustomKeyEventHandler((e) => {
          if (e.type !== 'keydown') return true;

          // Completion dropdown: navigate (↑/↓/Ctrl-N/Ctrl-P), accept (Tab/→),
          // dismiss (Esc), smart Enter (accept only if the user navigated).
          // Only while hints are on: with the dropdown hidden these keys must
          // reach the shell, never an invisible list.
          if (
            isInteractiveTerminal(tab.type) &&
            useSettingsStore.getState().settings.terminalCmdHint
          ) {
            const items = tabCompletions.get(tab.id) ?? [];
            const plainArrow = !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;

            if (items.length > 0) {
              const idx = tabCompletionIdx.get(tab.id) ?? 0;
              const buf = lineTrackers.get(tab.id)?.buf ?? '';

              const accept = (i: number): false => {
                e.preventDefault();
                completionAccept.get(tab.id)?.(items[i].text.slice(buf.length));
                return false;
              };

              // Accept with → always, or with Tab only when the user actively
              // navigated the dropdown (so plain Tab still reaches native shell
              // filename/flag completion).
              if (e.key === 'ArrowRight' && plainArrow) {
                return accept(idx);
              }
              if (e.key === 'Tab') {
                if (completionNav.get(tab.id)) {
                  return accept(idx);
                }
                hideCompletions(tab.id);
                return true;
              }

              // Dismiss with Esc
              if (e.key === 'Escape') {
                e.preventDefault();
                hideCompletions(tab.id);
                return false;
              }

              // Navigate with ↑/↓ (or Ctrl-N/Ctrl-P)
              const next = (e.key === 'ArrowDown' && plainArrow) || (e.key === 'n' && e.ctrlKey);
              const prev = (e.key === 'ArrowUp' && plainArrow) || (e.key === 'p' && e.ctrlKey);
              if (next || prev) {
                e.preventDefault();
                const n = items.length;
                const ni = next ? (idx + 1) % n : (idx - 1 + n) % n;
                tabCompletionIdx.set(tab.id, ni);
                completionNav.set(tab.id, true);
                paintCompletions(tab.id, items, ni, true);
                return false;
              }

              // Smart Enter: accept the highlighted item only if the user has
              // actively navigated; otherwise fall through so the shell runs it.
              if (e.key === 'Enter' && completionNav.get(tab.id)) {
                return accept(idx);
              }
            }
          }

          if (isCopyShortcut(e)) {
            const selection = readTerminalSelection(termRef) || selectionSnapshotRef.current;
            if (selection) {
              e.preventDefault();
              void writeClipboardText(selection);
              termRef.clearSelection();
              selectionSnapshotRef.current = '';
              return false;
            }
          }

          if (isPasteShortcut(e, useSettingsStore.getState().settings.ctrlVPaste)) {
            e.preventDefault();
            doPaste();
            return false;
          }

          return true;
        });

        const handleCopy = (e: ClipboardEvent) => {
          const selection = readTerminalSelection(termRef) || selectionSnapshotRef.current;
          if (!selection) return;
          e.preventDefault();
          e.clipboardData?.setData('text/plain', selection);
          void writeClipboardText(selection);
          termRef.clearSelection();
          selectionSnapshotRef.current = '';
        };

        const handlePaste = (e: ClipboardEvent) => {
          e.preventDefault();
          const text = e.clipboardData?.getData('text/plain');
          if (text) {
            maybePasteText(text);
          } else {
            doPaste();
          }
        };

        const closeContextMenu = () => setContextMenu(null);

        termEl.addEventListener('contextmenu', handleContextMenu, true);
        termEl.addEventListener('pointerdown', handlePointerDown, true);
        termEl.addEventListener('mousedown', handleMouseDown, true);
        termEl.addEventListener('mouseup', handleMouseUp, true);
        termEl.addEventListener('keydown', handleKeyDown, true);
        termEl.addEventListener('copy', handleCopy, true);
        termEl.addEventListener('paste', handlePaste, true);
        window.addEventListener('click', closeContextMenu);
        window.addEventListener('blur', closeContextMenu);

        terminalInteractionCleanups.set(tab.id, () => {
          termEl.removeEventListener('contextmenu', handleContextMenu, true);
          termEl.removeEventListener('pointerdown', handlePointerDown, true);
          termEl.removeEventListener('mousedown', handleMouseDown, true);
          termEl.removeEventListener('mouseup', handleMouseUp, true);
          termEl.removeEventListener('keydown', handleKeyDown, true);
          termEl.removeEventListener('copy', handleCopy, true);
          termEl.removeEventListener('paste', handlePaste, true);
          window.removeEventListener('click', closeContextMenu);
          window.removeEventListener('blur', closeContextMenu);
          if (selectionCopyTimer) clearTimeout(selectionCopyTimer);
          termRef.attachCustomKeyEventHandler(() => true);
          try {
            selectionDispose.dispose();
          } catch {}
        });
      }

      // Attach the WebGL renderer once the terminal is in the DOM. WebGL is
      // xterm.js's preferred GPU renderer (fastest, scales best, and in v6
      // supports DEC 2026 synchronized output that reduces TUI tearing). On
      // WebGL context loss or load failure, dispose the addon so the terminal
      // falls back to xterm's built-in DOM renderer. This matches VSCode's
      // renderer chain: WebGL → DOM (no intermediate Canvas layer).
      //
      // Sticky fallback: once WebGL fails for one terminal, skip the WebGL
      // attempt for subsequent terminals in the same session (VSCode's
      // _suggestedRendererType mechanism).
      attachWebglRenderer(instance, tab, wasFreshlyOpened, isSshBacked);

      // ConPTY 1.22+ sends a DA1 request (CSI c) at startup and waits for a
      // terminal response before continuing to render. If we don't respond,
      // ConPTY waits for a timeout, causing TUI apps (Claude Code, Codex) to
      // appear frozen on launch. Register a CSI handler that responds
      // immediately with VT220-level device attributes. Only for local ConPTY
      // sessions — SSH/serial PTYs don't go through ConPTY.
      if (usesLocalConpty()) {
        try {
          const da1Dispose = instance.terminal.parser.registerCsiHandler(
            { final: 'c' },
            (params) => {
              if (params.length === 0 || (params.length === 1 && params[0] === 0)) {
                // Send the DA1 response to the PTY input (not terminal.write,
                // which only writes to xterm's local render buffer). ConPTY
                // needs to receive the response on its input pipe to avoid the
                // 1.22+ startup timeout. Matches VSCode's _handleOnData path.
                sendInputToTab(tab.id, '\x1b[?61;4c');
                return true;
              }
              return false;
            },
          );
          pendingDisposes.push(da1Dispose);
        } catch {}
      }

      // Immediate fit attempt — reading offsetWidth triggers a synchronous
      // reflow so dimensions are often already available after open().
      safeFit(tab.id);

      // Set initial cell-size CSS variables for ghost text overlay.
      const el2 = containerRef.current;
      const inst2 = terminalInstances.get(tab.id);
      if (el2 && inst2 && el2.clientWidth > 0 && inst2.terminal.cols > 0) {
        const { w, h } = cellSize(inst2.terminal, el2);
        el2.style.setProperty('--cell-w', `${w}px`);
        el2.style.setProperty('--cell-h', `${h}px`);
        // The ghost-text overlay is a SIBLING of the pane, so it can't inherit
        // these vars from the pane. Also set them on the shared parent
        // (.terminal-container) so the sibling overlay can read them.
        const parent2 = el2.parentElement;
        if (parent2) {
          parent2.style.setProperty('--cell-w', `${w}px`);
          parent2.style.setProperty('--cell-h', `${h}px`);
        }
      }

      // Deferred fit as safety-net (covers edge-cases where layout isn't
      // settled on the first synchronous reflow). When we just reparented
      // the xterm element, do a full renderer reset instead of a plain fit
      // — fitAddon.fit() alone won't fire onResize when dimensions are
      // unchanged, leaving Claude's cached UI stale.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (wasReparented) {
            forceTerminalRedraw(tab.id, tab.sessionId, tab.type, isSshBacked());
            // For local ConPTY sessions, force ConPTY to re-send the current
            // screen content by toggling alt-screen mode. \x1b[?1049h enters
            // alt-screen (saving current screen), \x1b[?1049l exits (restoring)
            // — the net effect is a full repaint. Unsupported terminals ignore
            // these sequences safely.
            if (usesLocalConpty()) {
              sendInputToTab(tab.id, '\x1b[?1049h\x1b[?1049l');
            }
          } else {
            scheduleTerminalFit(tab.id);
            scheduleTerminalResizeSettle(tab.id, tab.sessionId, tab.type, 80, isSshBacked());
          }
        });
      });

      // Bell listener: plays a short WebAudio beep when terminalSound is enabled.
      // Registered here (before cleanupTabListeners) so it gets torn down with
      // the rest of the per-tab xterm listeners.
      // Reuse a single AudioContext across bells instead of creating one per
      // BEL — rapid bells (e.g. a script emitting several) would otherwise hit
      // the browser's concurrent-AudioContext cap and silently drop sound.
      let bellCtx: AudioContext | null = null;
      const bellDispose = instance.terminal.onBell(() => {
        if (!useSettingsStore.getState().settings.terminalSound) return;
        try {
          if (!bellCtx || bellCtx.state === 'closed') bellCtx = new AudioContext();
          const ctx = bellCtx;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = 'sine';
          osc.frequency.setValueAtTime(880, ctx.currentTime);
          gain.gain.setValueAtTime(0.3, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.08);
          // The oscillator self-stops; leave the context open for reuse.
        } catch {
          /* AudioContext unavailable — silently skip */
        }
      });

      // Mouse-wheel zoom: Ctrl+wheel adjusts terminalFontSize when enabled.
      // Attached to the terminal element; reads the setting live so toggling
      // takes effect without reconnect.
      const termElForWheel = instance.terminal.element;
      const handleWheelZoom = (e: WheelEvent) => {
        if (!e.ctrlKey) return;
        if (!useSettingsStore.getState().settings.mouseWheelZoom) return;
        e.preventDefault();
        const inst = terminalInstances.get(tab.id);
        if (!inst) return;
        const st = useSettingsStore.getState().settings;
        const current = parseInt(st.terminalFontSize) || 13;
        const next = e.deltaY < 0 ? Math.min(current + 1, 32) : Math.max(current - 1, 8);
        if (next === current) return;
        const newSize = `${next}px`;
        inst.terminal.options.fontSize = next;
        try {
          inst.fitAddon.fit();
        } catch {}
        useSettingsStore
          .getState()
          .save({ ...st, terminalFontSize: newSize })
          .catch(() => {});
      };
      if (termElForWheel) {
        termElForWheel.addEventListener('wheel', handleWheelZoom, { passive: false });
      }

      // ── Listener setup ─────────────────────────────────────
      cleanupTabListeners(tab.id);

      const setupConnection = async () => {
        if (cancelled) return;

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

        // Render flow control: coalesce incoming data events and flush to xterm
        // once per animation frame. Under heavy output (cat, build logs, top) this
        // caps xterm parsing to one write per frame so the WebView main thread
        // never saturates and input stays responsive. A byte cap forces an
        // immediate flush if a single frame accumulates a very large burst.
        let renderQueue = '';
        let renderRaf = 0;
        const RENDER_CAP = 1 << 18; // 256 KB
        const flushRender = () => {
          renderRaf = 0;
          if (!renderQueue) return;
          const chunk = renderQueue;
          renderQueue = '';
          instance?.terminal.write(chunk);
        };
        const enqueueRender = (payload: string) => {
          appendTerminalOutput(tab.id, payload);
          // Detect password / passphrase / verification prompts in the terminal's
          // output so we can stop treating the user's next input as a command.
          // sudo, su, mysql, ssh-keygen, TOTP, etc. all print a prompt ending in
          // ':' on its own line; matching the tail of the (ANSI-stripped) payload
          // keeps this cheap. The flag is cleared on the next Enter.
          if (payload) {
            const stripped = payload.replace(ANSI_RE, '');
            if (PASSWORD_PROMPT_RE.test(stripped)) {
              awaitingPassword.set(tab.id, true);
              // Auto-clear after 5s so a false positive (banner/help text) can't
              // permanently suppress history/completions. Re-armed on each match.
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

        // ── Session logging (optional) ─────────────────────────
        // When enabled in settings, terminal output is appended (ANSI-stripped)
        // to a per-session daily log file via the backend. Output is buffered
        // and flushed on a 1s timer so logging adds no per-chunk IPC overhead.
        const ANSI_RE =
          // CSI sequences, OSC sequences (BEL or ST terminated), and other
          // single/short ESC sequences.
          // eslint-disable-next-line no-control-regex -- ANSI escape sequence, control chars intentional
          /\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;
        const logName =
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          sessionsRef.current.find((s) => s.id === tab.sessionId)?.name ||
          tab.title ||
          tab.sessionId;
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

        const unlistenData = await listen<string>(
          `${eventPrefix}-data-${tab.sessionId}`,
          (event) => {
            enqueueRender(event.payload);
            enqueueLog(event.payload);
          },
        );
        if (cancelled) {
          unlistenData();
          return;
        }

        const unlistenExit = await listen(`${eventPrefix}-exit-${tab.sessionId}`, () => {
          flushRender();
          instance?.terminal.write(`\r\n\x1b[33m${t('term_session_ended')}\x1b[0m\r\n`);
          useAppStore.getState().updateTabConnected(tab.id, false);

          // Only SSH and serial offer press-any-key reconnect. Local shell
          // exit is user-driven; SFTP has no onData handler.
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

        // Coalesce input: normal typing flushes after a tiny delay, while paste
        // bursts are sliced into bounded IPC payloads. Backend terminal commands
        // only enqueue to per-session owner threads, so keep a few writes in
        // flight instead of letting one slow IPC promise stall later keystrokes.
        let writeQueue = '';
        let writeTimer: ReturnType<typeof setTimeout> | null = null;
        let writesInFlight = 0;
        let writeDisposed = false;
        const WRITE_FLUSH_MS = 8;
        const WRITE_RETRY_MS = 24;
        const WRITE_CHUNK_SIZE = 16 * 1024;
        const WRITE_INVOKE_TIMEOUT_MS = 1500;
        // Serialize writes: only one chunk in flight at a time. Parallel dispatch
        // (with >1 in-flight) reorders bytes on retry — a failed chunk is pushed
        // back to the queue head while later chunks may already have landed,
        // corrupting large pastes. Serial dispatch preserves byte order.
        const WRITE_MAX_IN_FLIGHT = 1;
        const scheduleWriteFlush = (delayMs = WRITE_FLUSH_MS) => {
          if (writeTimer || writeDisposed) return;
          writeTimer = setTimeout(flushWrites, delayMs);
        };
        const invokeWrite = (payload: string) =>
          new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error('terminal write timeout')),
              WRITE_INVOKE_TIMEOUT_MS,
            );
            invoke(writeCmd, { sessionId: tab.sessionId, data: payload })
              .then(() => resolve())
              .catch(reject)
              .finally(() => clearTimeout(timeout));
          });
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
            invokeWrite(payload)
              .catch((err) => {
                // Any interactive backend can transiently reject a write when its
                // input buffer is full (PTY/serial return "input buffer full";
                // SSH's mpsc channel blocks until the 1.5s IPC timeout). Requeue
                // the chunk and retry with backoff instead of dropping bytes,
                // which would corrupt pasted input on any backend type.
                if (
                  isInteractiveTerminal(tab.type) &&
                  (String(err).includes('buffer full') || String(err).includes('timeout'))
                ) {
                  writeQueue = payload + writeQueue;
                  scheduleWriteFlush(WRITE_RETRY_MS);
                }
              })
              .finally(() => {
                writesInFlight -= 1;
                if (writeQueue) scheduleWriteFlush(0);
              });
          }
          if (writeQueue) scheduleWriteFlush(WRITE_RETRY_MS);
        };
        // OSC 7 (cwd) reporting. Command capture is heuristic (onData buffer).
        const term133 = instance.terminal;
        const osc7Dispose = term133.parser.registerOscHandler(7, (payload) => {
          // payload like file://host/abs/path
          const m = /^file:\/\/[^/]*(\/.*)$/.exec(payload);
          if (m) {
            // The payload comes from the remote side: a malformed %-escape
            // makes decodeURIComponent throw inside xterm's parser, so ignore
            // the sequence instead of breaking output processing.
            let cwd: string;
            try {
              cwd = decodeURIComponent(m[1]);
            } catch {
              return false;
            }
            tabCwd.set(tab.id, cwd);
            setTerminalCwd(tab.id, cwd);
          }
          return false; // let other handlers run
        });

        const dataDispose = instance.terminal.onData((data) => {
          if (reconnectableTabs.has(tab.id)) {
            // Connection is dead — swallow this keystroke and reconnect instead.
            // The keystroke could not have reached the server anyway.
            reconnectableTabs.delete(tab.id);
            void reconnect();
            return;
          }

          // Command history & hints: track input line independently for history
          // capture (sshHistoryCmd) and command-dictionary suggestions (terminalCmdHint).
          const wasAwaitingPassword = !!awaitingPassword.get(tab.id);
          {
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
                // Record on Enter — only when history capture is enabled and NOT
                // when the preceding output was a password prompt.
                if (st.sshHistoryCmd && result.submitted && !wasAwaitingPassword) {
                  commandHistory.record(result.submitted.trim(), { scope, cwd, sessionType });
                }
                const apT = awaitingPasswordTimer.get(tab.id);
                if (apT) {
                  clearTimeout(apT);
                  awaitingPasswordTimer.delete(tab.id);
                }
                awaitingPassword.delete(tab.id);
              }

              // Suggestions need the hint setting on, and never while the
              // terminal is awaiting a password (the line holds a secret).
              if (!st.terminalCmdHint || awaitingPassword.get(tab.id)) {
                if ((tabCompletions.get(tab.id)?.length ?? 0) > 0) hideCompletions(tab.id);
              } else if (result.effect === 'show') {
                const locale = i18n.language?.startsWith('zh') ? 'zh' : 'en';
                const items = buildCompletions(
                  tracker.buf,
                  { scope, cwd, sessionType, table },
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
              const apT = awaitingPasswordTimer.get(tab.id);
              if (apT) {
                clearTimeout(apT);
                awaitingPasswordTimer.delete(tab.id);
              }
              awaitingPassword.delete(tab.id);
            }
          }

          // Input broadcast: fan this keystroke to all OTHER connected interactive
          // terminals, except when this tab is at a password/passphrase prompt.
          {
            const app = useAppStore.getState();
            if (app.broadcastInput && !wasAwaitingPassword) {
              for (const tb of app.tabs) {
                if (
                  tb.id !== tab.id &&
                  tb.connected &&
                  (tb.type === 'ssh' ||
                    tb.type === 'localshell' ||
                    tb.type === 'serial' ||
                    tb.type === 'docker')
                ) {
                  sendInputToTab(tb.id, data);
                }
              }
            }
          }

          writeQueue += data;
          if (writeQueue.length >= WRITE_CHUNK_SIZE) {
            if (writeTimer) {
              clearTimeout(writeTimer);
              writeTimer = null;
            }
            flushWrites();
          } else {
            scheduleWriteFlush();
          }
        });

        // Register the completion accept callback so the key handler can send completion text.
        if (isInteractiveTerminal(tab.type)) {
          completionAccept.set(tab.id, (suffix: string) => {
            if (writeDisposed) return;
            // Completions are only offered on a tracked line, so the accepted
            // text is exactly what the shell will now hold.
            const tracker = lineTrackers.get(tab.id);
            if (tracker) tracker.buf += suffix;
            hideCompletions(tab.id);
            const app = useAppStore.getState();
            if (app.broadcastInput && !awaitingPassword.get(tab.id)) {
              for (const tb of app.tabs) {
                if (
                  tb.id !== tab.id &&
                  tb.connected &&
                  (tb.type === 'ssh' ||
                    tb.type === 'localshell' ||
                    tb.type === 'serial' ||
                    tb.type === 'docker')
                ) {
                  sendInputToTab(tb.id, suffix);
                }
              }
            }
            writeQueue += suffix;
            if (writeQueue.length >= WRITE_CHUNK_SIZE) {
              if (writeTimer) {
                clearTimeout(writeTimer);
                writeTimer = null;
              }
              flushWrites();
            } else {
              scheduleWriteFlush();
            }
          });
        }

        // Generic external input injection (used by the snippet panel). Reuses the
        // same writeQueue/flush path as keystrokes, so backpressure & retry apply.
        tabInputSenders.set(tab.id, (payload: string) => {
          if (writeDisposed || !payload) return;
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
            // First resize per tab fires immediately — the terminal needs its
            // real size before the first paint and the user isn't dragging yet.
            if (!sentFirstResize.has(tabId)) {
              sentFirstResize.add(tabId);
              fire();
              return;
            }
            // Subsequent resizes (window drag fires onResize at frame rate) are
            // debounced 40ms trailing so we don't flood the backend with
            // resize_*/SIGWINCH on every frame.
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

        // Card frames bake in a fixed row-span at creation, so a width change that
        // rewraps lines leaves them stale. Rebuild on resize for ALL interactive
        // terminals — serial has no resizeCmd, so this can't live in that block.

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

        // Store listener cleanup in the global map so it can be called from
        // anywhere (next effect run, unmount, or destroyTerminal).
        tabListenerCleanups.set(tab.id, () => {
          unlistenData();
          unlistenExit();
          if (renderRaf) {
            cancelAnimationFrame(renderRaf);
            renderRaf = 0;
          }
          // Flush any bytes that arrived but were never rendered (the RAF was
          // cancelled above). Dropping them would lose terminal output across a
          // remount/split transition.
          if (renderQueue) {
            const chunk = renderQueue;
            renderQueue = '';
            try {
              instance?.terminal.write(chunk);
            } catch {}
          }
          // Flush any buffered log output before tearing the listeners down.
          if (logTimer) {
            clearTimeout(logTimer);
          }
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
          // Reset the first-resize guard so a remount (split toggle, StrictMode)
          // re-sends an immediate SIGWINCH instead of falling into the debounce
          // branch — otherwise TUIs render at a stale size after reparenting.
          sentFirstResize.delete(tab.id);
          for (const d of pendingDisposes) {
            try {
              d.dispose();
            } catch {}
          }
          try {
            dataDispose.dispose();
          } catch {}
          try {
            resizeDispose?.dispose();
          } catch {}
          try {
            osc7Dispose.dispose();
          } catch {}
          try {
            bellDispose.dispose();
          } catch {}
          // Close the shared bell AudioContext so it isn't left running.
          try {
            if (bellCtx) void bellCtx.close();
          } catch {}
          if (termElForWheel) {
            try {
              termElForWheel.removeEventListener('wheel', handleWheelZoom);
            } catch {}
          }
          completionAccept.delete(tab.id);
          // completionSetters is NOT deleted here — it is cleaned up by the
          // component useEffect return and destroyTerminal, matching the
          // pre-migration ghostTextSetters lifecycle exactly.
          tabInputSenders.delete(tab.id);
          tabCompletions.delete(tab.id);
          tabCompletionIdx.delete(tab.id);
          completionNav.delete(tab.id);
          const lineTracker = lineTrackers.get(tab.id);
          if (lineTracker) {
            lineTracker.inPaste = false;
            lineTracker.pasteBuf = '';
          }
          const apT = awaitingPasswordTimer.get(tab.id);
          if (apT) {
            clearTimeout(apT);
            awaitingPasswordTimer.delete(tab.id);
          }
          awaitingPassword.delete(tab.id);
        });

        const rawSession = sessionsRef.current.find((s) => s.id === tab.sessionId);
        const session = rawSession
          ? applyGroupDefaults(rawSession, loadGroupDefaults())
          : rawSession;

        const buildSshParams = (sess: typeof session) =>
          buildSshConnectParams(
            tab.sessionId,
            sess,
            instance.terminal.rows,
            instance.terminal.cols,
          );

        const shouldUseSavedSshConfig = (sess: typeof session): boolean =>
          !!sess && !sess._temporary;

        const invokeSshConnect = (sess: typeof session): Promise<void> => {
          if (shouldUseSavedSshConfig(sess)) {
            const groupDefaultsMap = loadGroupDefaults();
            const groupDefaults = sess?.group ? (groupDefaultsMap[sess.group] ?? null) : null;
            return invoke('ssh_connect_saved', {
              sessionId: tab.sessionId,
              rows: instance.terminal.rows,
              cols: instance.terminal.cols,
              groupDefaults,
            });
          }
          return invoke('ssh_connect', buildSshParams(sess));
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
              // Backend expects non-null host/port; dynamic (SOCKS) ignores them.
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

        const doSshConnect = async (sess: typeof session): Promise<void> => {
          try {
            await invokeSshConnect(sess);
          } catch (rawErr) {
            const errStr = String(rawErr);
            const hostKeyError = parseHostKeyError(errStr);
            if (hostKeyError) {
              const isMismatch = hostKeyError.kind === 'mismatch';
              // Pin under the host:port the key belongs to. With a jump host the
              // rejected key may be the jump hop's, not the target's.
              const { fingerprint, keyType, knownKeyType } = hostKeyError;
              const host = hostKeyError.host ?? sess?.host ?? '';
              const port = hostKeyError.port ?? sess?.port ?? 22;

              const accepted = await new Promise<boolean>((resolve) => {
                fingerprintResolveRef.current = resolve;
                setFingerprintInfo({ fingerprint, keyType, host, port, knownKeyType });
              });
              // Reset to a no-op so a later teardown can't re-resolve this promise.
              fingerprintResolveRef.current = () => {};
              // If the tab was closed/relocated while the prompt was open, the
              // cleanup resolved us with `false`; bail before touching the
              // (possibly disposed) terminal.
              if (cancelled) return;
              setFingerprintInfo(null);

              if (accepted && !isMismatch) {
                try {
                  await invoke('ssh_trust_host', { host, port, fingerprint, keyType });
                } catch (trustErr) {
                  // Backend overwrite guard refused to re-pin (MITM hardening).
                  instance?.terminal.write(`\r\n\x1b[31m[SECURITY] ${String(trustErr)}\x1b[0m\r\n`);
                  throw new Error('HOST_KEY_ABORTED');
                }
                // Retry through the same handler: with a jump host, trusting
                // the jump hop's key can surface the TARGET's unknown key next.
                await doSshConnect(sess);
                return;
              } else if (isMismatch) {
                instance?.terminal.write(
                  `\r\n\x1b[31m[SECURITY] ${t('fp_mismatch_warning')}\x1b[0m\r\n` +
                    `\r\n\x1b[31m${t('fp_current_fingerprint', { fingerprint })}\x1b[0m\r\n` +
                    `\r\n\x1b[33m${t('fp_mismatch_hint')}\x1b[0m\r\n`,
                );
                throw new Error('HOST_KEY_ABORTED');
              } else {
                instance?.terminal.write(`\r\n\x1b[33m[${t('fp_cancelled')}]\x1b[0m\r\n`);
                throw new Error('HOST_KEY_ABORTED');
              }
            }
            throw rawErr;
          }
        };

        // Press-any-key reconnect (SSH/serial). Closes any backend residue from
        // the dead session, then re-runs the connect path with the freshest
        // session config from the store (user may have edited host/port/creds
        // between disconnect and now). Failure re-arms so another keypress retries.
        const reconnect = async (): Promise<void> => {
          instance?.terminal.write(`\r\n\x1b[90m${t('term_reconnecting')}\x1b[0m\r\n`);
          // Reset ALL per-tab completion/prompt state — the new shell is a fresh
          // login (possibly a different user/host), so stale cwd, a lingering
          // password flag, or an unclosed bracketed-paste mode from the old
          // session would corrupt completions or silently swallow input.
          tabCommandTable.delete(tab.id);
          tabCwd.delete(tab.id);
          tabCompletions.delete(tab.id);
          tabCompletionIdx.delete(tab.id);
          completionNav.delete(tab.id);
          lineTrackers.delete(tab.id);
          const apTimer = awaitingPasswordTimer.get(tab.id);
          if (apTimer) {
            clearTimeout(apTimer);
            awaitingPasswordTimer.delete(tab.id);
          }
          awaitingPassword.delete(tab.id);
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
            if (
              tab.type === 'ssh' &&
              freshSession &&
              tableForRemoteShell(freshSession.remote_shell ?? null) === null
            ) {
              // Prefer a cached probe result for this host (5-min TTL) so opening
              // several tabs to the same host doesn't re-run exec probes each time.
              const host = freshSession.host ?? '';
              const cached = host ? remoteOsCache.get(host) : undefined;
              if (cached && Date.now() - cached.at < REMOTE_OS_TTL_MS) {
                tabCommandTable.set(tab.id, cached.table);
              } else {
                invoke<string>('detect_remote_os', { sessionId: tab.sessionId })
                  .then((tbl) => {
                    const norm = normalizeTable(tbl);
                    tabCommandTable.set(tab.id, norm);
                    if (host) remoteOsCache.set(host, { table: norm, at: Date.now() });
                  })
                  .catch(() => {});
              }
            }
          } catch (err) {
            if (cancelled) return;
            const isHostKeyAbort = err instanceof Error && err.message === 'HOST_KEY_ABORTED';
            if (!isHostKeyAbort) {
              instance?.terminal.write(`\r\n\x1b[31m${String(err)}\x1b[0m\r\n`);
            }
            instance?.terminal.write(`\x1b[33m${t('term_press_any_key_to_reconnect')}\x1b[0m\r\n`);
            // Re-arm so a second keypress tries again.
            reconnectableTabs.add(tab.id);
          }
        };

        // Only establish backend connection if not already connected (avoids race on split-mode transitions)
        const alreadyConnected = connectedTabs.has(tab.id);
        if (!alreadyConnected) {
          connectedTabs.add(tab.id);
        }

        try {
          let connectionReady = alreadyConnected;
          if (!alreadyConnected) {
            if (tab.type === 'localshell') {
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
              await invoke('create_local_shell', {
                sessionId: tab.sessionId,
                rows: instance.terminal.rows,
                cols: instance.terminal.cols,
                shellName: session?.shell_name ?? null,
                workingDir: session?.working_dir ?? null,
                charset: session?.charset ?? null,
                envVars: session?.env_vars ?? null,
              });
              connectionReady = true;
              if (session?.init_command) {
                scheduleInitCommand('write_to_pty', session.init_command);
              }
            } else if (tab.type === 'ssh') {
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
                connectionReady = true;
                if (session.init_command) {
                  scheduleInitCommand('write_to_ssh', session.init_command);
                }

                // Resolve the completion table: a concrete override is handled
                // synchronously by syncTable; 'auto'/unset triggers a one-shot remote
                // probe (best-effort, result cached per tab).
                if (tableForRemoteShell(session.remote_shell ?? null) === null) {
                  const host = session.host ?? '';
                  const cached = host ? remoteOsCache.get(host) : undefined;
                  if (cached && Date.now() - cached.at < REMOTE_OS_TTL_MS) {
                    tabCommandTable.set(tab.id, cached.table);
                  } else {
                    invoke<string>('detect_remote_os', { sessionId: tab.sessionId })
                      .then((tbl) => {
                        const norm = normalizeTable(tbl);
                        tabCommandTable.set(tab.id, norm);
                        if (host) remoteOsCache.set(host, { table: norm, at: Date.now() });
                      })
                      .catch(() => {});
                  }
                }

                await startSessionTunnel(session);
              }
            } else if (tab.type === 'serial') {
              if (!session?.serial_port) {
                instance?.terminal.write(
                  `\r\n\x1b[31m${t('term_serial_not_configured')}\x1b[0m\r\n`,
                );
              } else {
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
              // Ask the user to pick (App-root picker, bridged via window events).
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
                // Cancelled — close the docker tab (no live session).
                destroyTerminal(tab.id);
                useAppStore.getState().removeTab(tab.id);
                return;
              }
              instance?.terminal.write(
                `\r\n\x1b[90m${t('docker_connecting_container')}\x1b[0m\r\n`,
              );
              await invoke('docker_exec', {
                sessionId: tab.sessionId,
                containerId,
                rows: instance.terminal.rows,
                cols: instance.terminal.cols,
                connectMethod: method,
                tunnelSessionId: tunnelId,
                dockerHost,
              });
              connectionReady = true;
            }
          } // end if (!alreadyConnected)
          if (!connectionReady && !alreadyConnected) {
            connectedTabs.delete(tab.id);
          }
          useAppStore.getState().updateTabConnected(tab.id, connectionReady);
        } catch (err) {
          connectedTabs.delete(tab.id);
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
    }; // end initTerminal

    void initTerminal();

    return () => {
      cancelled = true;
      // Cancel any pending init-script injection so a deferred runLoginScript
      // can't write to a closed or reconnecting session.
      initScriptTimers.forEach(clearTimeout);
      initScriptCancels.forEach((fn) => fn());
      // Unblock a docker-container picker that is open for this tab: remove the
      // two window listeners first (via cancelDockerPick / cleanup), then resolve
      // the awaited Promise to null so the async frame exits cleanly, and dismiss
      // the picker UI. Without this the Promise never resolves on tab close,
      // leaking both window listeners and the on-screen picker modal.
      // Capture resolve ref BEFORE cancelDockerPick nulls it (cleanup sets both
      // cancelDockerPick and resolveDockerPick to null).
      const pendingResolve = resolveDockerPick;
      cancelDockerPick?.(); // removes listeners + nulls cancelDockerPick & resolveDockerPick
      pendingResolve?.(null); // unblocks the awaiting async frame
      useAppStore.getState().setDockerPicker(null);
      // Unstick a pending fingerprint-confirm prompt so its awaiting async frame
      // (which captures `instance`/`session`) completes instead of leaking.
      fingerprintResolveRef.current(false);
      cleanupTabListeners(tab.id);
      cleanupTerminalInteractions(tab.id);
      // Only close backend connection if tab is being removed (not just relocated to split pane)
      const store = useAppStore.getState();
      const tabStillExists = store.tabs.some((t2) => t2.id === tab.id);
      if (!tabStillExists) {
        connectedTabs.delete(tab.id);
        useAppStore.getState().updateTabConnected(tab.id, false);
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
      }
    };
    // Per-tab init: intentionally omits maybePasteText, t, and tab.title —
    // this effect should run once per tab lifecycle, not on every prop change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, tab.sessionId, tab.type]);

  // Update terminal theme when app theme changes
  useEffect(() => {
    const inst = terminalInstances.get(tab.id);
    if (inst) {
      inst.terminal.options.theme = resolveTerminalTheme(
        useSettingsStore.getState().settings.terminalColorScheme,
        theme,
      );
      // Match VSCode: when the app theme flips dark↔light, the 'auto' terminal
      // color scheme resolves to a different palette. The WebGL renderer's
      // glyph atlas still holds pixels rasterized with the old palette, so a
      // bare options.theme assignment leaves the on-screen colors stale until
      // something else forces an atlas rebuild. Clear the atlas + force a full
      // repaint so the new palette takes effect immediately.
      const dbg = webglDebugEnabled();
      requestAnimationFrame(() => {
        try {
          inst.terminal.clearTextureAtlas();
          if (dbg) console.debug('[gwshell:webgl] clearTextureAtlas (app theme change)');
        } catch {}
        try {
          inst.terminal.refresh(0, inst.terminal.rows - 1);
        } catch {}
      });
    }
  }, [theme, tab.id]);

  useEffect(() => {
    const inst = terminalInstances.get(tab.id);
    if (!inst) return;

    // Focus/blur only. xterm's default cursorInactiveStyle ('outline')
    // renders a hollow cursor on unfocused panes natively — no need to
    // force cursorBlink/visibility, which would clobber the running app.
    if (isActive) {
      // Double-RAF: wait for layout to settle (especially after
      // display:none → block). Going from hidden → visible may leave the
      // glyph atlas stale and the cached TUI state out of sync, so do a
      // full renderer reset instead of a plain fit.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          forceTerminalRedraw(tab.id, tab.sessionId, tab.type, isSshBacked());
          try {
            inst.terminal.focus();
          } catch {}
        });
      });
    } else {
      try {
        inst.terminal.blur();
      } catch {}
    }
  }, [isActive, isSshBacked, tab.id, tab.sessionId, tab.type]);

  // Use ResizeObserver on the container element so that ANY size change –
  // sidebar collapse/expand, split-pane open/close, window resize, SFTP panel
  // toggle – automatically re-fits the terminal.  A 150ms debounce avoids
  // thrashing during CSS transitions (sidebar 0.2s ease) and ensures we fit
  // to the *final* size.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let resizeTimerId: ReturnType<typeof setTimeout> | null = null;
    let lastW = el.offsetWidth;
    let lastH = el.offsetHeight;
    const observer = new ResizeObserver(() => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      // Only react to actual dimension changes (ignore sub-pixel jitter)
      if (w === lastW && h === lastH) return;
      lastW = w;
      lastH = h;
      scheduleTerminalFit(tab.id);
      scheduleTerminalResizeSettle(tab.id, tab.sessionId, tab.type, 180, isSshBacked());

      // Update cell-size CSS variables used by the ghost text overlay.
      const inst = terminalInstances.get(tab.id);
      if (inst && w > 0 && inst.terminal.cols > 0) {
        const { w: cw, h: ch } = cellSize(inst.terminal, el);
        el.style.setProperty('--cell-w', `${cw}px`);
        el.style.setProperty('--cell-h', `${ch}px`);
        const parent = el.parentElement;
        if (parent) {
          parent.style.setProperty('--cell-w', `${cw}px`);
          parent.style.setProperty('--cell-h', `${ch}px`);
        }
      }
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
        if (resizeTimerId) clearTimeout(resizeTimerId);
        resizeTimerId = setTimeout(() => {
          const inst = terminalInstances.get(tab.id);
          if (inst) {
            try {
              inst.terminal.clearTextureAtlas();
            } catch {}
          }
          forceTerminalRedraw(tab.id, tab.sessionId, tab.type, isSshBacked());
        }, 100);
      }
    };
    const setupDprListener = () => {
      if (activeDprMedia) activeDprMedia.removeEventListener('change', handleDprChange);
      activeDprMedia = window.matchMedia(`screen and (resolution: ${currentDpr}dppx)`);
      activeDprMedia.addEventListener('change', handleDprChange);
    };
    setupDprListener();

    return () => {
      const frameId = fitFrameIds.get(tab.id);
      if (frameId !== undefined) cancelAnimationFrame(frameId);
      fitFrameIds.delete(tab.id);
      const settleTimerId = settleTimerIds.get(tab.id);
      if (settleTimerId) clearTimeout(settleTimerId);
      settleTimerIds.delete(tab.id);
      if (resizeTimerId) clearTimeout(resizeTimerId);
      observer.disconnect();
      if (activeDprMedia) activeDprMedia.removeEventListener('change', handleDprChange);
    };
  }, [isSshBacked, tab.id, tab.sessionId, tab.type]);

  return (
    <>
      <div
        ref={containerRef}
        className={`terminal-pane${broadcastInput ? ' broadcasting' : ''}`}
        style={{ display: (visible ?? isActive) ? 'block' : 'none' }}
        onMouseDown={() => useAppStore.getState().setActiveTab(tab.id)}
      >
        <StickyScrollOverlay
          tabId={tab.id}
          fontFamily={terminalFont}
          fontSize={parseInt(terminalFontSize) || 13}
          enabled={terminalStickyScroll}
          terminalReady={terminalReady}
        />
      </div>

      {/* NOTE: in 2-pane split mode the completion dropdown anchors to the terminal-container, so when the active pane is the right column the hint can be offset. Known limitation (command hints are off by default); proper fix needs a per-pane positioned wrapper. */}
      {completionView.items.length > 0 &&
        isActive &&
        terminalCmdHint &&
        isInteractiveTerminal(tab.type) && (
          <CompletionDropdown
            view={completionView}
            fontFamily={terminalFont}
            fontSize={parseInt(terminalFontSize) || 13}
            onSelect={(idx) => {
              const item = completionView.items[idx];
              if (!item) return;
              const buf = lineTrackers.get(tab.id)?.buf ?? '';
              completionAccept.get(tab.id)?.(item.text.slice(buf.length));
              terminalInstances.get(tab.id)?.terminal.focus();
            }}
          />
        )}

      {contextMenu && isActive && (
        <TerminalContextMenu
          state={contextMenu}
          onCopy={copySelection}
          onPaste={pasteClipboard}
          onSelectAll={selectAllTerminal}
          onClear={clearTerminal}
        />
      )}

      {fingerprintInfo && isActive && (
        <FingerprintDialog
          info={fingerprintInfo}
          onAccept={() => {
            fingerprintResolveRef.current?.(true);
            setFingerprintInfo(null);
          }}
          onReject={() => {
            fingerprintResolveRef.current?.(false);
            setFingerprintInfo(null);
          }}
        />
      )}

      {pasteConfirm !== null && isActive && (
        <PasteConfirmDialog
          text={pasteConfirm}
          onCancel={() => setPasteConfirm(null)}
          onPaste={() => {
            const terminal = terminalInstances.get(tab.id)?.terminal;
            if (terminal) terminal.paste(pasteConfirm);
            setPasteConfirm(null);
          }}
        />
      )}
    </>
  );
};
