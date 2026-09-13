// src/lib/terminalVscodeOptions.ts
// Centralized mapping between VSCode's terminal.integrated.* settings and
// xterm.js ITerminalOptions. TerminalView builds every Terminal more-or-less
// identically to VSCode's XtermTerminal (microsoft/vscode,
// src/vs/workbench/contrib/terminal/browser/xterm/xtermTerminal.ts). Keeping
// the mapping in one place makes it easy to audit option-for-option parity.

import type { ITerminalInitOnlyOptions, ITerminalOptions, ITheme } from '@xterm/xterm';
import type { AppSettings } from '../stores/settingsStore';

const toNumber = (raw: string | number | undefined, fallback: number): number => {
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''));
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Default-approaching one-line mapping table (VSCode setting → xterm option).
 * Exported so tests can pin the VSCode-aligned defaults in a single place.
 *
 * Each comment line below cites the VSCode `terminal.integrated.*` setting
 * whose default is replicated. Where gwshell provides its own settings store
 * value (font family / size etc.), the user value wins, matching VSCode's
 * resolution order (config → default).
 */
export function buildVscodeTerminalOptions(
  settings: AppSettings,
  resolvedTheme: ITheme,
): ITerminalOptions & ITerminalInitOnlyOptions {
  return {
    // terminal.integrated.fontFamily / fontSize / lineHeight / letterSpacing
    fontFamily: settings.terminalFont,
    fontSize: toNumber(settings.terminalFontSize, 13),
    lineHeight: toNumber(settings.terminalLineHeight, 1.2),
    letterSpacing: toNumber(settings.terminalLetterSpacing, 0),

    // terminal.integrated.drawBoldTextInBrightColors (default true)
    drawBoldTextInBrightColors: true,

    // terminal.integrated.fontWeight / fontWeightBold — mirror VSCode's
    // explicit 'normal' / 'bold' so bold glyphs get rasterized with a weight
    // the font actually has (VSCode XtermTerminal).
    fontWeight: 'normal',
    fontWeightBold: 'bold',

    // Cursor: owned by the running program (DECSCUSR / DECTCEM). The defaults
    // below only seed the bare shell prompt before any app overrides them.
    // We intentionally use a NON-blinking default: Windows ConPTY leaks
    // DECSCUSR bursts as blink-on (VSCode sets cursorBlink from
    // terminal.integrated.cursorBlink=true but that fights ConPTY); a stable
    // block cursor is what VSCode ends up with for most local shells anyway.
    cursorBlink: false,
    cursorStyle: 'block',
    cursorWidth: 1,
    // terminal.integrated.focusMode inactive cursor shape.
    cursorInactiveStyle: 'outline',
    // Show cursor immediately so it doesn't pop in (xterm option parity).
    showCursorImmediately: true,
    blinkIntervalDuration: 600,

    // terminal.integrated.defaultTheme / theme-aware scheme resolved upstream.
    theme: resolvedTheme,

    // allowProposedApi enables parse/experimental APIs used by addons.
    allowProposedApi: true,

    // terminal.integrated.scrollback
    scrollback: toNumber(settings.terminalMaxScrollback, 10000),

    // terminal.integrated.copyOnSelection (VSCode default false) — not an
    // xterm.js constructor option; implemented via onSelectionChange +
    // autoCopyOnSelect in TerminalView instead.

    // scrollOnEraseInDisplay: scroll DECSED/ED content into scrollback like
    // VSCode (keeps full-screen output resumable in history).
    scrollOnEraseInDisplay: true,

    // terminal.integrated.enableRescaleOverlappingGlyphs — corrects glyph
    // rendering with some CJK/emoji fonts.
    rescaleOverlappingGlyphs: true,

    // windowOptions: report pixel/cell sizes to the PTY — ConPTY heuristics.
    windowOptions: { getWinSizePixels: true, getCellSizePixels: true, getWinSizeChars: true },

    // terminal.integrated.minimumContrastRatio (default 4.5)
    minimumContrastRatio: 4.5,

    // terminal.integrated.wordSeparator (default value from VSCode docs)
    wordSeparator: ' ()[]{}\'"`,;:|',

    // MacOptionIsMeta: Option-as-Meta for readline/emacs.
    macOptionIsMeta: true,

    // Alt-click moves the cursor (VSCode probes shell via sendSequenceMarker).
    altClickMovesCursor: true,

    // Smooth scrolling is off by default in VSCode (terminal.integrated.
    // smoothScrolling=false → smoothScrollDuration=0) — keeps the renderer in
    // lockstep with the PTY byte stream rather than animating behind it.
    smoothScrollDuration: 0,

    // terminal.integrated.enablePersistentScrollbar / fastScrollSensitivity
    fastScrollSensitivity: 5,
    scrollSensitivity: 1,

    // Ignore the host's bracketed-paste-disable request so paste behaviour
    // stays consistent across shells (VSCode parity).
    ignoreBracketedPasteMode: true,
  };
}

/** VSCode terminal.integrated.stickyScroll.* defaults (see terminalStickyScrollConfiguration). */
export const VSCODE_STICKY_SCROLL_DEFAULTS = {
  enabled: true,
  maxLineCount: 5,
  ignoredCommands: [
    'clear',
    'cls',
    'clear-host',
    'agent',
    'agy',
    'copilot',
    'claude',
    'codex',
    'gemini',
  ],
};
