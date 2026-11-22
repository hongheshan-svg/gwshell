// src/components/Terminal/StickyScrollOverlay.tsx
// Sticky scroll overlay pinned at the top of a terminal pane, showing the
// prompt/command rows of the command currently scrolled past. Mirrors VSCode's
// TerminalStickyScrollOverlay (microsoft/vscode,
// src/vs/workbench/contrib/terminalContrib/stickyScroll/browser/terminalStickyScrollOverlay.ts).
//
// The overlay refreshes on every viewport/line-feed/cursor event like VSCode
// does (its lookup is O(command count), so scanning on every frame is fine).

import React, { useEffect, useState } from 'react';
import { terminalInstances } from './terminalRegistry';
import { getCommandForLine } from '../../lib/shellIntegration';
import { computeStickyScroll } from '../../lib/terminalStickyScroll';
import { resolveTerminalTheme } from '../../lib/terminalThemes';
import { cellSize } from '../../lib/terminalPlatform';
import { useAppStore } from '../../stores/appStore';
import { useSettingsStore } from '../../stores/settingsStore';

interface StickyScrollOverlayProps {
  tabId: string;
  fontFamily: string;
  fontSize: number;
  enabled: boolean;
  terminalReady: boolean;
}

export const StickyScrollOverlay: React.FC<StickyScrollOverlayProps> = ({
  tabId,
  fontFamily,
  fontSize,
  enabled,
  terminalReady,
}) => {
  const appTheme = useAppStore((s) => s.theme);
  const colorScheme = useSettingsStore((s) => s.settings.terminalColorScheme);
  const [sticky, setSticky] = useState<{ lines: string[]; title: string }>({
    lines: [],
    title: '',
  });
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (!enabled || !terminalReady) return;
    const inst = terminalInstances.get(tabId);
    if (!inst) return;
    const terminal = inst.terminal;

    let queued = false;
    const computeAndStore = (): void => {
      const viewportY = terminal.buffer.active.viewportY;
      const command = getCommandForLine(tabId, terminal, viewportY);
      const state = computeStickyScroll(terminal, command);
      setSticky((prev) => {
        const nextLines = state?.lines ?? [];
        const nextTitle = state?.commandLine ?? '';
        if (
          prev.title === nextTitle &&
          prev.lines.length === nextLines.length &&
          prev.lines.every((l, i) => l === nextLines[i])
        ) {
          return prev;
        }
        return { lines: nextLines, title: nextTitle };
      });
    };
    const refresh = (): void => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        computeAndStore();
      });
    };

    // VSCode installs refresh listeners on: onScroll + onLineFeed +
    // onCursorMove + the viewport's DOM scroll event.
    const disposers: { dispose(): void }[] = [];
    try {
      disposers.push(terminal.onLineFeed(refresh));
    } catch {}
    try {
      disposers.push(terminal.onScroll(refresh));
    } catch {}
    try {
      disposers.push(terminal.onCursorMove(refresh));
    } catch {}
    const viewport = terminal.element?.querySelector('.xterm-viewport');
    viewport?.addEventListener('scroll', refresh);
    refresh();
    return () => {
      viewport?.removeEventListener('scroll', refresh);
      for (const d of disposers) {
        try {
          d.dispose();
        } catch {}
      }
    };
  }, [enabled, tabId, terminalReady]);

  const { lines, title } = sticky;
  if (!enabled || lines.length === 0) return null;

  const inst = terminalInstances.get(tabId);
  const terminal = inst?.terminal;
  const paneEl = inst?.terminal.element?.parentElement;
  const theme = resolveTerminalTheme(colorScheme, appTheme);
  // VSCode adjusts for the scrollbar width on the right; ours is 12px per the
  // global CSS override (same right offset as the slider sits over).
  const cell = terminal && paneEl ? cellSize(terminal, paneEl) : { w: 0, h: 0 };

  return (
    <div
      className={`terminal-sticky-scroll${hovered ? ' is-hovered' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={title || undefined}
    >
      <div
        className="terminal-sticky-scroll-rows"
        style={{
          background: theme.background,
          color: theme.foreground,
          fontFamily,
          fontSize,
          lineHeight: cell.h > 0 ? `${cell.h}px` : undefined,
        }}
      >
        {lines.map((line, i) => (
          <div key={i} className="terminal-sticky-scroll-line">
            {line || ' '}
          </div>
        ))}
      </div>
    </div>
  );
};
