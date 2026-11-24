import { useEffect, useRef, type RefObject } from 'react';
import type { TabInfo, ThemeMode } from '../types';
import { useAppStore } from '../stores/appStore';
import { useConfirmStore } from '../stores/confirmStore';
import { useSettingsStore } from '../stores/settingsStore';
import { terminalInstances } from '../components/Terminal/terminalRegistry';
import { resolveTerminalTheme } from '../lib/terminalThemes';
import { cellSize, webglDebugEnabled } from '../lib/terminalPlatform';
import {
  fitFrameIds,
  focusTerminalTab,
  forceTerminalRedraw,
  scheduleTerminalFit,
  scheduleTerminalResizeSettle,
  settleTimerIds,
} from '../lib/terminalLifecycle';

const LOCAL_OVERLAY_SELECTOR =
  '.fingerprint-overlay, .paste-confirm-overlay, .update-modal-overlay, .sftp-editor-overlay, .sftp-chmod-overlay';
const TERMINAL_COMPANION_INPUT_SCOPE =
  '.sftp-panel, .agent-panel, .terminal-ai-dock, .terminal-search-bar';

function hasBlockingAppModal(): boolean {
  const st = useAppStore.getState();
  return (
    st.vaultLocked ||
    st.showNewSession ||
    st.showQuickConnect ||
    st.showDockerModal ||
    st.showLocalTerminalModal ||
    st.showSerialModal ||
    st.showSettings ||
    st.showAppMenu ||
    st.showCommandPalette ||
    st.showTerminalSearch ||
    st.groupDefaultsTarget !== null ||
    st.dockerPicker !== null ||
    useConfirmStore.getState().open ||
    Boolean(document.querySelector(LOCAL_OVERLAY_SELECTOR))
  );
}

function canAutoFocusTerminal(tabId: string, preserveAnyInput = false): boolean {
  const st = useAppStore.getState();
  if (st.activeTabId !== tabId || st.mainView === 'asset-list') return false;
  if (hasBlockingAppModal()) return false;
  const active = document.activeElement;
  if (
    active instanceof Element &&
    !active.classList.contains('xterm-helper-textarea') &&
    active.closest('input, textarea, [contenteditable="true"]')
  ) {
    if (preserveAnyInput) return false;
    // On explicit tab activation/connect/modal-close, only yield to companion
    // inputs inside the terminal workspace (SFTP rename/path, AI panel, search).
    // Never let a stale sidebar search box block a newly opened terminal.
    if (active.closest(TERMINAL_COMPANION_INPUT_SCOPE)) return false;
  }
  return true;
}

interface UseTerminalViewportOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  tab: TabInfo;
  theme: ThemeMode;
  isActive: boolean;
  terminalReady: boolean;
  isSshBacked: () => boolean;
}

/**
 * Manages terminal theme updates (including WebGL texture atlas rebuilds),
 * active focus/redraw transitions, ResizeObserver fitting, and DPR zoom sync.
 */
export function useTerminalViewport({
  containerRef,
  tab,
  theme,
  isActive,
  terminalReady,
  isSshBacked,
}: UseTerminalViewportOptions): void {
  // Update terminal theme when app theme changes
  useEffect(() => {
    const inst = terminalInstances.get(tab.id);
    if (!inst) return;

    inst.terminal.options.theme = resolveTerminalTheme(
      useSettingsStore.getState().settings.terminalColorScheme,
      theme,
    );
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
  }, [theme, tab.id]);

  const hasAppModal = useAppStore(
    (s) =>
      s.vaultLocked ||
      s.showNewSession ||
      s.showQuickConnect ||
      s.showDockerModal ||
      s.showLocalTerminalModal ||
      s.showSerialModal ||
      s.showSettings ||
      s.showAppMenu ||
      s.showCommandPalette ||
      s.showTerminalSearch ||
      s.groupDefaultsTarget !== null ||
      s.dockerPicker !== null,
  );
  const confirmOpen = useConfirmStore((s) => s.open);
  const modalBlocking = hasAppModal || confirmOpen;
  const prevModalBlockingRef = useRef(modalBlocking);

  // Restore focus to the active terminal when any blocking modal/dialog closes
  // (e.g. Esc on CommandPalette / Settings / ConfirmDialog / UnlockScreen).
  useEffect(() => {
    const wasBlocking = prevModalBlockingRef.current;
    prevModalBlockingRef.current = modalBlocking;
    if (wasBlocking && !modalBlocking && isActive && terminalReady) {
      const raf = requestAnimationFrame(() => {
        if (canAutoFocusTerminal(tab.id)) {
          focusTerminalTab(tab.id);
        }
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [modalBlocking, isActive, terminalReady, tab.id]);

  // Focus/blur and force redraw when a tab becomes active, finishes mounting,
  // or completes connecting. Also re-focus when the OS window regains focus
  // (helps WebView2/WKWebView/WebKitGTK recover keyboard focus after Alt+Tab / restore).
  useEffect(() => {
    const inst = terminalInstances.get(tab.id);
    if (!inst) return;

    if (isActive) {
      let raf1 = 0;
      let raf2 = 0;
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          forceTerminalRedraw(tab.id, tab.sessionId, tab.type, isSshBacked());
          if (canAutoFocusTerminal(tab.id)) {
            focusTerminalTab(tab.id);
          }
        });
      });
      const handleWindowFocus = () => {
        if (canAutoFocusTerminal(tab.id, true)) {
          focusTerminalTab(tab.id);
        }
      };
      window.addEventListener('focus', handleWindowFocus);
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
        window.removeEventListener('focus', handleWindowFocus);
      };
    } else {
      try {
        inst.terminal.blur();
      } catch {}
    }
  }, [isActive, terminalReady, tab.connected, isSshBacked, tab.id, tab.sessionId, tab.type]);

  // ResizeObserver + cell-size CSS vars + devicePixelRatio zoom listener
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let resizeTimerId: ReturnType<typeof setTimeout> | null = null;
    let lastW = el.offsetWidth;
    let lastH = el.offsetHeight;
    const observer = new ResizeObserver(() => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w === lastW && h === lastH) return;
      lastW = w;
      lastH = h;
      scheduleTerminalFit(tab.id);
      scheduleTerminalResizeSettle(tab.id, tab.sessionId, tab.type, 180, isSshBacked());

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
  }, [containerRef, isSshBacked, tab.id, tab.sessionId, tab.type]);
}
