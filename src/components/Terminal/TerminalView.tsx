import React, { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { CanvasAddon } from "@xterm/addon-canvas/lib/xterm-addon-canvas.mjs";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readText as clipboardRead, writeText as clipboardWrite } from "@tauri-apps/plugin-clipboard-manager";
import { useTranslation } from 'react-i18next';
import type { TabInfo, ThemeMode } from "../../types";
import { useAppStore } from "../../stores/appStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { terminalInstances } from "./terminalRegistry";
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

interface TerminalContextMenu {
  x: number;
  y: number;
  canCopy: boolean;
}

const getTerminalThemeColors = (theme: ThemeMode) => {
  const isDark = theme === "dark";
  return isDark
    ? {
        background: "#0c0c14",
        foreground: "#d4d4d8",
        cursor: "#a0a0b0",
        cursorAccent: "#0c0c14",
        selectionBackground: "rgba(160, 160, 176, 0.3)",
        black: "#1a1a28",
        red: "#ff5555",
        green: "#50fa7b",
        yellow: "#f1fa8c",
        blue: "#5ac8fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#d4d4d8",
        brightBlack: "#555570",
        brightRed: "#ff6e6e",
        brightGreen: "#69ff94",
        brightYellow: "#ffffa5",
        brightBlue: "#7dd6fc",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#ffffff",
        scrollbarSliderBackground: "rgba(255, 255, 255, 0.18)",
        scrollbarSliderHoverBackground: "rgba(255, 255, 255, 0.32)",
        scrollbarSliderActiveBackground: "rgba(255, 255, 255, 0.46)",
      }
    : {
        background: "#f0f0f4",
        foreground: "#1a1a2e",
        cursor: "#6e6e7a",
        cursorAccent: "#f0f0f4",
        selectionBackground: "rgba(110, 110, 122, 0.25)",
        black: "#1a1a2e",
        red: "#dc2626",
        green: "#16a34a",
        yellow: "#ca8a04",
        blue: "#0078d4",
        magenta: "#9333ea",
        cyan: "#0891b2",
        white: "#d4d4d8",
        brightBlack: "#8888a0",
        brightRed: "#ef4444",
        brightGreen: "#22c55e",
        brightYellow: "#eab308",
        brightBlue: "#2a8de6",
        brightMagenta: "#a855f7",
        brightCyan: "#06b6d4",
        brightWhite: "#ffffff",
        scrollbarSliderBackground: "rgba(0, 0, 0, 0.18)",
        scrollbarSliderHoverBackground: "rgba(0, 0, 0, 0.30)",
        scrollbarSliderActiveBackground: "rgba(0, 0, 0, 0.42)",
      };
};

const isPasteAction = (value: string) => value === "paste" || value === "Paste" || value === "\u7c98\u8d34";

const writeClipboardText = async (text: string) => {
  const browserWrite = navigator.clipboard?.writeText(text).catch(() => {});
  await clipboardWrite(text).catch(() => browserWrite);
  const current = await clipboardRead().catch(() => "");
  if (current !== text) {
    await browserWrite;
    await clipboardWrite(text).catch(() => {});
  }
};

const readClipboardText = async () => {
  const tauriText = await clipboardRead().catch(() => undefined);
  if (typeof tauriText === "string") return tauriText;
  return navigator.clipboard?.readText().catch(() => "") ?? "";
};

const readTerminalSelection = (terminal: Terminal) => {
  const selection = terminal.getSelection();
  return selection && selection.trim().length > 0 ? selection : "";
};

const isMacPlatform = () => {
  if (cachedOsInfo?.os === "macos") return true;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
};

const isCopyShortcut = (e: KeyboardEvent) => {
  const key = e.key.toLowerCase();
  const isKeyC = e.code === "KeyC" || key === "c";
  const isInsert = e.code === "Insert" || key === "insert";
  const isMac = isMacPlatform();

  if (isMac && e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && isKeyC) return true;
  if (!e.metaKey && e.ctrlKey && e.shiftKey && !e.altKey && isKeyC) return true;
  if (!isMac && !e.metaKey && e.ctrlKey && !e.shiftKey && !e.altKey && isKeyC) return true;
  return !e.metaKey && e.ctrlKey && !e.shiftKey && !e.altKey && isInsert;
};

const isPasteShortcut = (e: KeyboardEvent, ctrlVPaste: boolean) => {
  const key = e.key.toLowerCase();
  const isKeyV = e.code === "KeyV" || key === "v";
  const isInsert = e.code === "Insert" || key === "insert";
  const isMac = isMacPlatform();

  if (isMac && e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && isKeyV) return true;
  if (!e.metaKey && e.ctrlKey && e.shiftKey && !e.altKey && isKeyV) return true;
  if (!isMac && ctrlVPaste && !e.metaKey && e.ctrlKey && !e.shiftKey && !e.altKey && isKeyV) return true;
  return !e.metaKey && !e.ctrlKey && e.shiftKey && !e.altKey && isInsert;
};

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

// Track which tab IDs have active backend connections (SSH/PTY/serial)
// so we can avoid closing them during split-mode transitions.
const connectedTabs = new Set<string>();

// Global map of event-listener cleanup functions keyed by tab ID.
// Ensures only ONE set of listeners exists per tab at any time, even
// when React StrictMode double-invokes effects or when components
// remount during single↔split transitions.
const tabListenerCleanups = new Map<string, () => void>();
const terminalInteractionCleanups = new Map<string, () => void>();
const fitFrameIds = new Map<string, number>();
const settleTimerIds = new Map<string, ReturnType<typeof setTimeout>>();

/** Trailing-edge 40ms debounce for backend resize invokes, keyed by tab.id.
 *  Window drag fires xterm onResize at frame rate; the backend
 *  resize_ssh/resize_pty (→ SIGWINCH) doesn't need that granularity. The
 *  first resize per tab still fires immediately so initial mount is unaffected. */
const pendingBackendResize = new Map<string, ReturnType<typeof setTimeout>>();
const sentFirstResize = new Set<string>();

/** Tabs whose connection just dropped. When a tab is in this set, the next
 *  keystroke triggers a reconnect instead of being sent to the (now dead)
 *  backend channel. Cleared on reconnect attempt, on tab destroy, and on
 *  listener cleanup. Only SSH and serial sessions are ever armed. */
const reconnectableTabs = new Set<string>();

/** Remove event listeners for a tab (idempotent). */
function cleanupTabListeners(tabId: string): void {
  const fn = tabListenerCleanups.get(tabId);
  if (fn) { fn(); tabListenerCleanups.delete(tabId); }
  reconnectableTabs.delete(tabId);
}

function cleanupTerminalInteractions(tabId: string): void {
  const fn = terminalInteractionCleanups.get(tabId);
  if (fn) { fn(); terminalInteractionCleanups.delete(tabId); }
}

/** Destroy a terminal instance associated with a tab (called when the tab closes). */
export function destroyTerminal(tabId: string): void {
  cleanupTabListeners(tabId);
  cleanupTerminalInteractions(tabId);
  const frameId = fitFrameIds.get(tabId);
  if (frameId !== undefined) cancelAnimationFrame(frameId);
  fitFrameIds.delete(tabId);
  const settleTimerId = settleTimerIds.get(tabId);
  if (settleTimerId) clearTimeout(settleTimerId);
  settleTimerIds.delete(tabId);
  const pendingResize = pendingBackendResize.get(tabId);
  if (pendingResize) clearTimeout(pendingResize);
  pendingBackendResize.delete(tabId);
  sentFirstResize.delete(tabId);
  connectedTabs.delete(tabId);
  reconnectableTabs.delete(tabId);
  const inst = terminalInstances.get(tabId);
  if (inst) {
    try { inst.rendererAddon?.dispose(); } catch {}
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
  if (!el) return;
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;
  try {
    inst.fitAddon.fit();
    inst.terminal.refresh(0, inst.terminal.rows - 1);
  } catch {}
}

export function scheduleTerminalFit(tabId: string): void {
  if (fitFrameIds.has(tabId)) return;
  const frameId = requestAnimationFrame(() => {
    fitFrameIds.delete(tabId);
    safeFit(tabId);
  });
  fitFrameIds.set(tabId, frameId);
}

export function scheduleTerminalResizeSettle(
  tabId: string,
  sessionId: string,
  tabType: TabInfo['type'],
  delayMs = 180
): void {
  const existing = settleTimerIds.get(tabId);
  if (existing) clearTimeout(existing);
  const timerId = setTimeout(() => {
    settleTimerIds.delete(tabId);
    forceTerminalRedraw(tabId, sessionId, tabType);
  }, delayMs);
  settleTimerIds.set(tabId, timerId);
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
  if (!el) return;
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;
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
  const { t } = useTranslation();
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const selectionSnapshotRef = useRef("");

  const [fingerprintInfo, setFingerprintInfo] = useState<FingerprintInfo | null>(null);
  const [contextMenu, setContextMenu] = useState<TerminalContextMenu | null>(null);
  const fingerprintResolveRef = useRef<(accepted: boolean) => void>(() => {});

  const copySelection = useCallback(() => {
    const inst = terminalInstances.get(tab.id);
    const terminal = inst?.terminal;
    if (!terminal) return;

    const selection = readTerminalSelection(terminal) || selectionSnapshotRef.current;
    if (selection) {
      void writeClipboardText(selection);
      terminal.clearSelection();
      selectionSnapshotRef.current = "";
    }
    terminal.focus();
    setContextMenu(null);
  }, [tab.id]);

  const pasteClipboard = useCallback(() => {
    const inst = terminalInstances.get(tab.id);
    const terminal = inst?.terminal;
    if (!terminal) return;

    readClipboardText()
      .then((text) => {
        if (text) terminal.paste(text);
      })
      .catch(() => {});
    terminal.focus();
    setContextMenu(null);
  }, [tab.id]);

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

        const s = useSettingsStore.getState().settings;
        const termOpts: Record<string, unknown> = {
          fontFamily: s.terminalFont,
          fontSize: parseInt(s.terminalFontSize) || 13,
          lineHeight: parseFloat(s.terminalLineHeight) || 1.2,
          letterSpacing: parseFloat(s.terminalLetterSpacing) || 0,
          // Cursor is left to the running program: TUI apps (Claude Code,
          // Codex, vim) drive shape/blink/visibility via DECSCUSR (`\e[ q`)
          // and DECTCEM (`\e[?25h/l`). We only set native-feeling defaults
          // for the bare shell prompt and never re-impose them afterwards,
          // otherwise focus/theme changes would fight the app's cursor.
          cursorBlink: true,
          cursorStyle: "block",
          theme: getTerminalThemeColors(useAppStore.getState().theme),
          allowProposedApi: true,
          scrollback: parseInt(s.terminalMaxScrollback) || 10000,
          copyOnSelect: false,
        };

        if (osInfo.os === "windows") {
          termOpts.windowsPty = {
            backend: "conpty",
            buildNumber: osInfo.windowsBuild ?? 0,
          };
        }

        // Wait for the configured terminal font to load before constructing the
        // terminal. xterm measures character cell width once, on construction;
        // if the font hasn't loaded yet the fallback font's metrics are baked in
        // and every render misaligns (column drift / overlap) until something
        // forces a re-measure. Race against a 600ms cap because document.fonts
        // .load hangs indefinitely for a missing/404'd font.
        try {
          if (typeof document !== "undefined" && document.fonts?.load) {
            const fs = parseInt(s.terminalFontSize) || 13;
            const family = (s.terminalFont || "monospace").trim();
            await Promise.race([
              document.fonts.load(`${fs}px "${family}"`),
              new Promise<void>((resolve) => setTimeout(resolve, 600)),
            ]);
          }
        } catch {
          // Non-fatal — construct with whatever metrics the browser has.
        }
        if (cancelled) return;

        const terminal = new Terminal(termOpts as ConstructorParameters<typeof Terminal>[0]);

        const fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.loadAddon(new WebLinksAddon());

        instance = { terminal, fitAddon };
        terminalInstances.set(tab.id, instance);
      }

      if (cancelled) return;

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
          readClipboardText().then((text) => {
            if (text) termRef.paste(text);
          }).catch(() => {});
        };

        const doCopy = () => {
          copyCurrentSelection();
          const sel = readTerminalSelection(termRef) || selectionSnapshotRef.current;
          if (!sel) return false;
          void writeClipboardText(sel);
          termRef.clearSelection();
          selectionSnapshotRef.current = "";
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
            if (selection && useSettingsStore.getState().settings.autoCopyOnSelect) {
              if (selectionCopyTimer) clearTimeout(selectionCopyTimer);
              selectionCopyTimer = setTimeout(() => {
                if (selectionSnapshotRef.current) {
                  void writeClipboardText(selectionSnapshotRef.current);
                }
              }, 120);
            }
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
            selectionSnapshotRef.current = "";
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
          if (e.type !== "keydown") return true;

          if (isCopyShortcut(e)) {
            const selection = readTerminalSelection(termRef) || selectionSnapshotRef.current;
            if (selection) {
              e.preventDefault();
              void writeClipboardText(selection);
              termRef.clearSelection();
              selectionSnapshotRef.current = "";
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
          e.clipboardData?.setData("text/plain", selection);
          void writeClipboardText(selection);
          termRef.clearSelection();
          selectionSnapshotRef.current = "";
        };

        const handlePaste = (e: ClipboardEvent) => {
          e.preventDefault();
          const text = e.clipboardData?.getData("text/plain");
          if (text) {
            termRef.paste(text);
          } else {
            doPaste();
          }
        };

        const closeContextMenu = () => setContextMenu(null);

        termEl.addEventListener("contextmenu", handleContextMenu, true);
        termEl.addEventListener("pointerdown", handlePointerDown, true);
        termEl.addEventListener("mousedown", handleMouseDown, true);
        termEl.addEventListener("mouseup", handleMouseUp, true);
        termEl.addEventListener("keydown", handleKeyDown, true);
        termEl.addEventListener("copy", handleCopy, true);
        termEl.addEventListener("paste", handlePaste, true);
        window.addEventListener("click", closeContextMenu);
        window.addEventListener("blur", closeContextMenu);

        terminalInteractionCleanups.set(tab.id, () => {
          termEl.removeEventListener("contextmenu", handleContextMenu, true);
          termEl.removeEventListener("pointerdown", handlePointerDown, true);
          termEl.removeEventListener("mousedown", handleMouseDown, true);
          termEl.removeEventListener("mouseup", handleMouseUp, true);
          termEl.removeEventListener("keydown", handleKeyDown, true);
          termEl.removeEventListener("copy", handleCopy, true);
          termEl.removeEventListener("paste", handlePaste, true);
          window.removeEventListener("click", closeContextMenu);
          window.removeEventListener("blur", closeContextMenu);
          if (selectionCopyTimer) clearTimeout(selectionCopyTimer);
          termRef.attachCustomKeyEventHandler(() => true);
          try { selectionDispose.dispose(); } catch {}
        });
      }

      // Attach a canvas renderer once the terminal is in the DOM.
      // WebGL is fast, but it is more prone to stale cells in full-screen TUIs
      // during reparent/focus/resize cycles. Canvas is still accelerated enough
      // for normal shell output and clears Codex/Claude status rows reliably.
      if (wasFreshlyOpened) {
        // WebGL is xterm.js's preferred GPU renderer (fastest, scales best,
        // and in v6 supports DEC 2026 synchronized output that reduces TUI
        // tearing). Prefer it; fall back to Canvas, then to xterm's built-in
        // DOM renderer if neither initializes. On WebGL context loss, dispose
        // the addon so the terminal drops back to the DOM renderer.
        try {
          const webgl = new WebglAddon();
          webgl.onContextLoss(() => { try { webgl.dispose(); } catch {} });
          instance.terminal.loadAddon(webgl);
          instance.rendererAddon = webgl;
        } catch {
          try {
            const canvas = new CanvasAddon();
            instance.terminal.loadAddon(canvas);
            instance.rendererAddon = canvas;
          } catch {}
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
            scheduleTerminalFit(tab.id);
            scheduleTerminalResizeSettle(tab.id, tab.sessionId, tab.type, 80);
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

      // Render flow control: coalesce incoming data events and flush to xterm
      // once per animation frame. Under heavy output (cat, build logs, top) this
      // caps xterm parsing to one write per frame so the WebView main thread
      // never saturates and input stays responsive. A byte cap forces an
      // immediate flush if a single frame accumulates a very large burst.
      let renderQueue = "";
      let renderRaf = 0;
      const RENDER_CAP = 1 << 18; // 256 KB
      const flushRender = () => {
        renderRaf = 0;
        if (!renderQueue) return;
        const chunk = renderQueue;
        renderQueue = "";
        instance?.terminal.write(chunk);
      };
      const enqueueRender = (payload: string) => {
        renderQueue += payload;
        if (renderQueue.length >= RENDER_CAP) {
          if (renderRaf) { cancelAnimationFrame(renderRaf); renderRaf = 0; }
          flushRender();
          return;
        }
        if (!renderRaf) renderRaf = requestAnimationFrame(flushRender);
      };

      const unlistenData = await listen<string>(
        `${eventPrefix}-data-${tab.sessionId}`,
        (event) => { enqueueRender(event.payload); }
      );
      if (cancelled) { unlistenData(); return; }

      const unlistenExit = await listen(
        `${eventPrefix}-exit-${tab.sessionId}`,
        () => {
          flushRender();
          instance?.terminal.write(`\r\n\x1b[33m${t('term_session_ended')}\x1b[0m\r\n`);
          useAppStore.getState().updateTabConnected(tab.id, false);

          // Only SSH and serial offer press-any-key reconnect. Local shell
          // exit is user-driven; SFTP has no onData handler.
          if (tab.type === 'ssh' || tab.type === 'serial') {
            instance?.terminal.write(
              `\x1b[33m${t('term_press_any_key_to_reconnect')}\x1b[0m\r\n`
            );
            reconnectableTabs.add(tab.id);
          }
        }
      );
      if (cancelled) { unlistenData(); unlistenExit(); return; }

      // Coalesce input: many onData events fired within one task (a paste, or
      // very fast typing) are concatenated and sent as a single invoke on the
      // next microtask. This adds no perceptible latency for single keystrokes
      // but collapses bursts from hundreds of IPC calls to one.
      let writeQueue = "";
      let writeScheduled = false;
      const flushWrites = () => {
        writeScheduled = false;
        if (!writeQueue) return;
        const payload = writeQueue;
        writeQueue = "";
        invoke(writeCmd, { sessionId: tab.sessionId, data: payload }).catch(() => {});
      };
      const dataDispose = instance!.terminal.onData((data) => {
        if (reconnectableTabs.has(tab.id)) {
          // Connection is dead — swallow this keystroke and reconnect instead.
          // The keystroke could not have reached the server anyway.
          reconnectableTabs.delete(tab.id);
          void reconnect();
          return;
        }
        writeQueue += data;
        if (!writeScheduled) {
          writeScheduled = true;
          queueMicrotask(flushWrites);
        }
      });

      let resizeDispose: { dispose(): void } | null = null;
      if (resizeCmd) {
        const cmd = resizeCmd;
        const tabId = tab.id;
        const sessionId = tab.sessionId;
        const isSsh = tab.type === "ssh";
        resizeDispose = instance!.terminal.onResize(({ rows, cols }) => {
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
          pendingBackendResize.set(tabId, setTimeout(() => {
            pendingBackendResize.delete(tabId);
            fire();
          }, 40));
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
        if (renderRaf) { cancelAnimationFrame(renderRaf); renderRaf = 0; }
        const pendingResize = pendingBackendResize.get(tab.id);
        if (pendingResize) { clearTimeout(pendingResize); pendingBackendResize.delete(tab.id); }
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
        idleDisconnectMinutes: sess?.idle_disconnect_minutes ?? null,
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

      // Press-any-key reconnect (SSH/serial). Closes any backend residue from
      // the dead session, then re-runs the connect path with the freshest
      // session config from the store (user may have edited host/port/creds
      // between disconnect and now). Failure re-arms so another keypress retries.
      const reconnect = async (): Promise<void> => {
        instance?.terminal.write(`\r\n\x1b[90m${t('term_reconnecting')}\x1b[0m\r\n`);
        const freshSession = sessionsRef.current.find((s) => s.id === tab.sessionId);
        if (tab.type === 'ssh') {
          await invoke('close_ssh', { sessionId: tab.sessionId }).catch(() => {});
        } else if (tab.type === 'serial') {
          await invoke('close_serial', { sessionId: tab.sessionId }).catch(() => {});
        }

        try {
          if (!freshSession) throw new Error('session not found in store');
          if (tab.type === 'ssh') {
            await doSshConnect(freshSession);
          } else if (tab.type === 'serial') {
            if (!freshSession.serial_port) throw new Error('serial port not configured');
            await invoke('serial_open', {
              sessionId: freshSession.id,
              portName: freshSession.serial_port,
              baudRate: parseInt(freshSession.serial_baud_rate || '115200', 10),
              dataBits: freshSession.serial_data_bits || '8',
              stopBits: freshSession.serial_stop_bits || '1',
              parity: freshSession.serial_parity || 'None',
            });
          }
          connectedTabs.add(tab.id);
          useAppStore.getState().updateTabConnected(tab.id, true);
          reconnectableTabs.delete(tab.id);
        } catch (err) {
          instance?.terminal.write(
            `\r\n\x1b[31m${String(err)}\x1b[0m\r\n` +
            `\x1b[33m${t('term_press_any_key_to_reconnect')}\x1b[0m\r\n`
          );
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
          connectionReady = true;
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
            connectionReady = true;

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
            connectionReady = true;
          }
        }
        } // end if (!alreadyConnected)
        if (!connectionReady && !alreadyConnected) {
          connectedTabs.delete(tab.id);
        }
        useAppStore.getState().updateTabConnected(tab.id, connectionReady);
      } catch (err) {
        connectedTabs.delete(tab.id);
        useAppStore.getState().updateTabConnected(tab.id, false);
        instance?.terminal.write(`\r\n\x1b[31m${t('term_conn_error', { error: String(err) })}\x1b[0m\r\n`);
      }
    };

      setupConnection();
    }; // end initTerminal

    initTerminal();

    return () => {
      cancelled = true;
      cleanupTabListeners(tab.id);
      cleanupTerminalInteractions(tab.id);
      // Only close backend connection if tab is being removed (not just relocated to split pane)
      const store = useAppStore.getState();
      const tabStillExists = store.tabs.some(t2 => t2.id === tab.id);
      if (!tabStillExists) {
        connectedTabs.delete(tab.id);
        useAppStore.getState().updateTabConnected(tab.id, false);
        const closeCmd = tab.type === "ssh" ? "close_ssh" : tab.type === "serial" ? "close_serial" : "close_pty";
        invoke(closeCmd, { sessionId: tab.sessionId }).catch(() => {});
      }
    };
  }, [tab.id, tab.sessionId, tab.type]);

  // Update terminal theme when app theme changes
  useEffect(() => {
    const inst = terminalInstances.get(tab.id);
    if (inst) {
      inst.terminal.options.theme = getTerminalThemeColors(theme);
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
            forceTerminalRedraw(tab.id, tab.sessionId, tab.type);
            try { inst.terminal.focus(); } catch {}
          });
        });
    } else {
      try { inst.terminal.blur(); } catch {}
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
      scheduleTerminalResizeSettle(tab.id, tab.sessionId, tab.type);
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
            try { inst.terminal.clearTextureAtlas(); } catch {}
          }
          forceTerminalRedraw(tab.id, tab.sessionId, tab.type);
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
      const frameId = fitFrameIds.get(tab.id);
      if (frameId !== undefined) cancelAnimationFrame(frameId);
      fitFrameIds.delete(tab.id);
      const settleTimerId = settleTimerIds.get(tab.id);
      if (settleTimerId) clearTimeout(settleTimerId);
      settleTimerIds.delete(tab.id);
      if (resizeTimerId) clearTimeout(resizeTimerId);
      observer.disconnect();
      if (activeDprMedia) activeDprMedia.removeEventListener("change", handleDprChange);
    };
  }, [tab.id, tab.sessionId, tab.type]);

  return (
    <>
      <div
        ref={containerRef}
        className="terminal-pane"
        style={{ display: (forceVisible || isActive) ? "block" : "none" }}
      />

      {contextMenu && (forceVisible || isActive) && (
        <div className="context-menu terminal-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button
            type="button"
            className="context-menu-item"
            disabled={!contextMenu.canCopy}
            onClick={copySelection}
          >
            {t('settings_sc_copy')}
          </button>
          <button
            type="button"
            className="context-menu-item"
            onClick={pasteClipboard}
          >
            {t('settings_sc_paste')}
          </button>
          <div className="context-menu-divider" />
          <button
            type="button"
            className="context-menu-item"
            onClick={selectAllTerminal}
          >
            {t('settings_sc_selectall')}
          </button>
          <button
            type="button"
            className="context-menu-item"
            onClick={clearTerminal}
          >
            {t('settings_sc_clear')}
          </button>
        </div>
      )}

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
