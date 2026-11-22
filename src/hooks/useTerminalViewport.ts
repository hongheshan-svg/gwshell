import { useEffect, type RefObject } from 'react';
import type { TabInfo, ThemeMode } from '../types';
import { useAppStore } from '../stores/appStore';
import { useSettingsStore } from '../stores/settingsStore';
import { terminalInstances } from '../components/Terminal/terminalRegistry';
import { resolveTerminalTheme } from '../lib/terminalThemes';
import { cellSize, webglDebugEnabled } from '../lib/terminalPlatform';
import {
  fitFrameIds,
  forceTerminalRedraw,
  scheduleTerminalFit,
  scheduleTerminalResizeSettle,
  settleTimerIds,
} from '../lib/terminalLifecycle';

function canAutoFocusTerminal(tabId: string): boolean {
  const st = useAppStore.getState();
  if (st.activeTabId !== tabId || st.mainView === 'asset-list') return false;
  if (
    st.vaultLocked ||
    st.showNewSession ||
    st.showQuickConnect ||
    st.showDockerModal ||
    st.showLocalTerminalModal ||
    st.showSerialModal ||
    st.showSettings ||
    st.showCommandPalette ||
    st.showTerminalSearch
  ) {
    return false;
  }
  const active = document.activeElement;
  if (
    active instanceof Element &&
    !active.classList.contains('xterm-helper-textarea') &&
    active.closest('input, textarea, [contenteditable="true"]') &&
    active.closest('.sftp-panel, .agent-panel, .terminal-ai-dock, .terminal-search-bar')
  ) {
    return false;
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

  // Focus/blur and force redraw when a tab becomes active or finishes mounting
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
            try {
              inst.terminal.focus();
            } catch {}
          }
        });
      });
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    } else {
      try {
        inst.terminal.blur();
      } catch {}
    }
  }, [isActive, terminalReady, isSshBacked, tab.id, tab.sessionId, tab.type]);

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
