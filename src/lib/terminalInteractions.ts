import type { MutableRefObject } from 'react';
import type { Terminal } from '@xterm/xterm';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import type { TabInfo } from '../types';
import { useSettingsStore } from '../stores/settingsStore';
import { useToastStore } from '../stores/toastStore';
import { terminalInstances } from '../components/Terminal/terminalRegistry';
import type { TerminalContextMenuState } from '../components/Terminal/types';
import type { Completion } from './completion';
import { dropdownColumn } from './inputLineTracker';
import { setTerminalSelection } from './terminalContext';
import { isInteractiveTerminal } from './terminalPlatform';
import {
  completionAccept,
  completionNav,
  completionSetters,
  estimateDropdownRows,
  HIDDEN_COMPLETIONS,
  lineTrackers,
  tabCompletionIdx,
  tabCompletions,
  tabCwd,
} from './terminalCompletionState';
import {
  isCopyShortcut,
  isPasteAction,
  isPasteShortcut,
  readClipboardText,
  readTerminalSelection,
  writeClipboardText,
} from './terminalClipboard';
import {
  cleanupTerminalInteractions,
  sendInputToTab,
  terminalInteractionCleanups,
} from './terminalLifecycle';

/**
 * Show `items` in a tab's completion dropdown (or hide it when empty). The
 * dropdown is anchored to where the typed line starts rather than to the
 * cursor, so it stays still while typing and its items line up under the line.
 */
export function paintCompletions(
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

export function hideCompletions(tabId: string): void {
  tabCompletions.set(tabId, []);
  tabCompletionIdx.set(tabId, 0);
  completionNav.set(tabId, false);
  paintCompletions(tabId, [], 0, false);
}

/**
 * Quote local file paths cleanly for insertion into a shell command line.
 */
export function formatDroppedFilePaths(paths: string[]): string {
  return paths
    .filter((p) => p.trim().length > 0)
    .map((p) => {
      if (/^[A-Za-z0-9_./:@+-]+$/.test(p)) return p;
      return `'${p.replace(/'/g, "'\\''")}'`;
    })
    .join(' ');
}

interface AttachInteractionsOptions {
  tab: TabInfo;
  terminal: Terminal;
  selectionSnapshotRef: MutableRefObject<string>;
  maybePasteText: (text: string) => void;
  setContextMenu: (state: TerminalContextMenuState | null) => void;
}

export function attachTerminalInteractions({
  tab,
  terminal,
  selectionSnapshotRef,
  maybePasteText,
  setContextMenu,
}: AttachInteractionsOptions): void {
  if (!terminal.element) return;

  cleanupTerminalInteractions(tab.id);
  const termEl = terminal.element;
  const termRef = terminal;

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
      // Guarantee xterm's helper textarea acquires focus on left-click even if
      // WebView2/TSF focus state drifted (e.g. after window reactivation).
      queueMicrotask(() => {
        if (document.activeElement !== termRef.textarea) {
          try {
            termRef.focus();
          } catch {}
        }
      });
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

    if (isInteractiveTerminal(tab.type) && useSettingsStore.getState().settings.terminalCmdHint) {
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
        if (e.key === 'Escape') {
          e.preventDefault();
          hideCompletions(tab.id);
          return false;
        }

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

export function attachBellAudio(terminal: Terminal): () => void {
  let bellCtx: AudioContext | null = null;
  const bellDispose = terminal.onBell(() => {
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
    } catch {
      /* AudioContext unavailable — silently skip */
    }
  });
  return () => {
    try {
      bellDispose.dispose();
    } catch {}
    try {
      if (bellCtx) void bellCtx.close();
    } catch {}
  };
}

export function attachWheelZoom(tabId: string, termEl: HTMLElement | undefined): () => void {
  if (!termEl) return () => {};
  const handleWheelZoom = (e: WheelEvent) => {
    if (!e.ctrlKey) return;
    if (!useSettingsStore.getState().settings.mouseWheelZoom) return;
    e.preventDefault();
    const inst = terminalInstances.get(tabId);
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
  termEl.addEventListener('wheel', handleWheelZoom, { passive: false });
  return () => {
    try {
      termEl.removeEventListener('wheel', handleWheelZoom);
    } catch {}
  };
}

export function attachTerminalDragDrop(
  tab: TabInfo,
  container: HTMLDivElement,
  isVisibleRef: MutableRefObject<boolean>,
  onDragOverChange: (over: boolean) => void,
): () => void {
  let unlisten: (() => void) | undefined;
  let disposed = false;

  const isPointInside = (x: number, y: number): boolean => {
    if (!isVisibleRef.current) return false;
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const dpr = window.devicePixelRatio || 1;
    const insidePhysical =
      x / dpr >= rect.left &&
      x / dpr <= rect.right &&
      y / dpr >= rect.top &&
      y / dpr <= rect.bottom;
    const insideLogical = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    return insideLogical || insidePhysical;
  };

  const handleDroppedPaths = async (paths: string[]) => {
    if (paths.length === 0) return;
    if (tab.type === 'ssh') {
      try {
        const targetDir =
          tabCwd.get(tab.id) ??
          (await invoke<string>('sftp_realpath', {
            sessionId: tab.sessionId,
            path: '.',
          }).catch(() => '/tmp'));
        const normalizedDir = targetDir.replace(/\/+$/, '') || '/';
        for (const localPath of paths) {
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          const fileName = localPath.replace(/\\/g, '/').split('/').pop() || 'file';
          const remotePath =
            normalizedDir === '/' ? `/${fileName}` : `${normalizedDir}/${fileName}`;
          try {
            await invoke('sftp_upload', { sessionId: tab.sessionId, remotePath, localPath });
          } catch {
            await invoke('sftp_upload_dir', {
              sessionId: tab.sessionId,
              remotePath: normalizedDir,
              localDir: localPath,
            });
          }
        }
        useToastStore.getState().pushToast({
          kind: 'info',
          title: 'SFTP',
          message: `${paths.length} item(s) → ${normalizedDir}`,
        });
      } catch (err) {
        useToastStore.getState().pushToast({
          kind: 'error',
          title: 'SFTP',
          message: String(err),
        });
      }
      return;
    }
    const quoted = formatDroppedFilePaths(paths);
    if (quoted) {
      sendInputToTab(tab.id, quoted);
      terminalInstances.get(tab.id)?.terminal.focus();
    }
  };

  try {
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === 'enter' || event.payload.type === 'over') {
          onDragOverChange(isPointInside(event.payload.position.x, event.payload.position.y));
        } else if (event.payload.type === 'drop') {
          const inside = isPointInside(event.payload.position.x, event.payload.position.y);
          onDragOverChange(false);
          if (inside) {
            void handleDroppedPaths(event.payload.paths);
          }
        } else {
          onDragOverChange(false);
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});
  } catch {
    // Non-Tauri environment
  }

  return () => {
    disposed = true;
    onDragOverChange(false);
    unlisten?.();
  };
}
