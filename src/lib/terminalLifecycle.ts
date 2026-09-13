// src/lib/terminalLifecycle.ts
// Connection lifecycle, fit/resize scheduling, and terminal teardown.
// Module-level state is singleton (same pattern as terminalRegistry.ts).
// Extracted from TerminalView.tsx.

import { invoke } from '@tauri-apps/api/core';
import type { TabInfo } from '../types';
import { terminalInstances } from '../components/Terminal/terminalRegistry';
import { tabInputSenders, resetCompletionState } from './terminalCompletionState';
import { clearTerminalAiContext } from './terminalContext';
import { disposeShellIntegration } from './shellIntegration';

// --- Per-tab lifecycle state (module-level singletons) ---

// Track which tab IDs have active backend connections (SSH/PTY/serial)
// so we can avoid closing them during split-mode transitions.
export const connectedTabs = new Set<string>();

/** Tabs whose connection just dropped. When a tab is in this set, the next
 *  keystroke triggers a reconnect instead of being sent to the (now dead)
 *  backend channel. Cleared on reconnect attempt, on tab destroy, and on
 *  listener cleanup. Only SSH and serial sessions are ever armed. */
export const reconnectableTabs = new Set<string>();

// Global map of event-listener cleanup functions keyed by tab ID.

// Ensures only ONE set of listeners exists per tab at any time, even
// when React StrictMode double-invokes effects or when components
// remount during single↔split transitions.
export const tabListenerCleanups = new Map<string, () => void>();
export const terminalInteractionCleanups = new Map<string, () => void>();
export const fitFrameIds = new Map<string, number>();
export const settleTimerIds = new Map<string, ReturnType<typeof setTimeout>>();

/** Trailing-edge 40ms debounce for backend resize invokes, keyed by tab.id.
 *  Window drag fires xterm onResize at frame rate; the backend
 *  resize_ssh/resize_pty (-> SIGWINCH) doesn't need that granularity. The
 *  first resize per tab still fires immediately so initial mount is unaffected. */
export const pendingBackendResize = new Map<string, ReturnType<typeof setTimeout>>();
export const sentFirstResize = new Set<string>();

// Sticky renderer fallback: once WebGL fails to load for one terminal,
// skip the WebGL attempt for subsequent terminals in the same session.
// Matches VSCode's _suggestedRendererType mechanism - avoids repeated
// WebGL init failures across multiple tabs.
//
// `let` exports are not mutable from outside the module, so the value
// is exposed via a getter/setter pair instead of a direct export.
let suggestedRendererTypeDom = false;

/** Read the sticky WebGL-fallback flag. */
export function getSuggestedRendererTypeDom(): boolean {
  return suggestedRendererTypeDom;
}

/** Set the sticky WebGL-fallback flag (called from the WebGL catch block). */
export function setSuggestedRendererTypeDom(value: boolean): void {
  suggestedRendererTypeDom = value;
}

// --- Cleanup helpers ---

/** Remove event listeners for a tab (idempotent). */
export function cleanupTabListeners(tabId: string): void {
  const fn = tabListenerCleanups.get(tabId);
  if (fn) {
    fn();
    tabListenerCleanups.delete(tabId);
  }
  reconnectableTabs.delete(tabId);
}

export function cleanupTerminalInteractions(tabId: string): void {
  const fn = terminalInteractionCleanups.get(tabId);
  if (fn) {
    fn();
    terminalInteractionCleanups.delete(tabId);
  }
}

// --- Input injection (used by SnippetPanel + TerminalAiDock) ---

// Returns true if input could be queued for the given tab.
export function sendInputToTab(tabId: string, data: string): boolean {
  const sender = tabInputSenders.get(tabId);
  if (!sender) return false;
  sender(data);
  return true;
}

// --- Full teardown ---

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
  resetCompletionState(tabId);
  clearTerminalAiContext(tabId);
  disposeShellIntegration(tabId);
  const inst = terminalInstances.get(tabId);
  if (inst) {
    try {
      inst.rendererAddon?.dispose();
    } catch {}
    inst.terminal.dispose();
    terminalInstances.delete(tabId);
  }
}

// --- Fit / resize scheduling ---

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
  delayMs = 180,
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
 * notify the backend of the current terminal size - even if xterm thinks
 * the size hasn't changed.
 *
 * Use this after the xterm element has been reparented to a new container
 * or its parent toggled from display:none to visible (split-mode open/close,
 * tab switch). These transitions leave three things out of sync:
 *  1. the glyph texture atlas may hold stale cells from the previous
 *     container/DPR - fixed by clearTextureAtlas + refresh
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
  tabType: TabInfo['type'],
): void {
  const inst = terminalInstances.get(tabId);
  if (!inst) return;
  const el = inst.terminal.element?.parentElement;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;
  try {
    inst.fitAddon.fit();
  } catch {}
  try {
    inst.terminal.clearTextureAtlas();
  } catch {}
  try {
    inst.terminal.refresh(0, inst.terminal.rows - 1);
  } catch {}

  // ConPTY redraws asynchronously after receiving SIGWINCH. The first refresh
  // clears the stale glyph atlas; this deferred second pass catches ConPTY's
  // asynchronous repaint, eliminating ghost cells in TUI apps.
  const term = inst.terminal;
  requestAnimationFrame(() => {
    try {
      term.clearTextureAtlas();
    } catch {}
    try {
      term.refresh(0, term.rows - 1);
    } catch {}
  });

  if (tabType === 'serial' || tabType === 'asset-list') return;
  const cols = inst.terminal.cols;
  const rows = inst.terminal.rows;
  if (tabType === 'ssh') {
    invoke('resize_ssh', { sessionId, cols, rows }).catch(() => {});
  } else {
    invoke('resize_pty', { sessionId, rows, cols }).catch(() => {});
  }
}
