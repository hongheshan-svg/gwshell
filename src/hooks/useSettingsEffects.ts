import { useEffect } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { useAppStore } from '../stores/appStore';
import { terminalInstances } from '../components/Terminal/terminalRegistry';
import { resolveTerminalTheme } from '../lib/terminalThemes';

const LANG_MAP: Record<string, 'zh' | 'en'> = {
  zh: 'zh',
  en: 'en',
  简体中文: 'zh',
  English: 'en',
};

const ZOOM_MAP: Record<string, number> = {
  '80%': 0.8,
  '90%': 0.9,
  '100%': 1.0,
  '110%': 1.1,
  '120%': 1.2,
  '150%': 1.5,
};

function parsePx(value: string, fallback: number): number {
  const n = parseInt(value);
  return Number.isNaN(n) ? fallback : n;
}

function parseNum(value: string, fallback: number): number {
  const n = parseFloat(value);
  return Number.isNaN(n) ? fallback : n;
}

/** Apply settings side effects once the persisted settings store changes. */
export function useSettingsEffects() {
  const settings = useSettingsStore((s) => s.settings);
  const setTheme = useAppStore((s) => s.setTheme);
  const setLocale = useAppStore((s) => s.setLocale);

  useEffect(() => {
    setTheme(settings.theme);
  }, [settings.theme, setTheme]);

  useEffect(() => {
    setLocale(LANG_MAP[settings.language] ?? 'zh');
  }, [settings.language, setLocale]);

  // UI (chrome) font — drives the CSS --font-sans token. Empty falls back to
  // the stylesheet default. Terminal font is separate (settings.terminalFont).
  useEffect(() => {
    const sans = settings.uiFont?.trim();
    if (sans) {
      document.documentElement.style.setProperty('--font-sans', sans);
    } else {
      document.documentElement.style.removeProperty('--font-sans');
    }
  }, [settings.uiFont]);

  useEffect(() => {
    const zoom = ZOOM_MAP[settings.zoomLevel] ?? 1.0;
    (document.documentElement.style as unknown as Record<string, string>).zoom = String(zoom); // eslint-disable-line no-restricted-syntax
  }, [settings.zoomLevel]);

  useEffect(() => {
    document.documentElement.classList.toggle('enable-animation', settings.enableAnimation);
  }, [settings.enableAnimation]);

  useEffect(() => {
    document.documentElement.classList.toggle(
      'terminal-stripe-bg',
      settings.terminalStripeBackground,
    );
  }, [settings.terminalStripeBackground]);

  useEffect(() => {
    const fontSize = parsePx(settings.terminalFontSize, 13);
    const lineHeight = parseNum(settings.terminalLineHeight, 1.2);
    const letterSpacing = parseNum(settings.terminalLetterSpacing, 0);
    const scrollback = parsePx(settings.terminalMaxScrollback, 10000);

    terminalInstances.forEach(({ terminal, fitAddon }) => {
      terminal.options.fontFamily = settings.terminalFont;
      terminal.options.fontSize = fontSize;
      terminal.options.lineHeight = lineHeight;
      terminal.options.letterSpacing = letterSpacing;
      terminal.options.scrollback = scrollback;

      requestAnimationFrame(() => {
        try {
          fitAddon.fit();
        } catch {}
        try {
          terminal.clearTextureAtlas();
        } catch {}
        try {
          terminal.refresh(0, terminal.rows - 1);
        } catch {}
      });
    });
  }, [
    settings.terminalFont,
    settings.terminalFontSize,
    settings.terminalLineHeight,
    settings.terminalLetterSpacing,
    settings.terminalMaxScrollback,
  ]);

  useEffect(() => {
    const theme = resolveTerminalTheme(settings.terminalColorScheme, settings.theme);
    // Dev-only observability (see TerminalView.tsx webglDebugEnabled). Trace
    // the atlas clear so a developer can runtime-verify the theme-switch fix
    // is actually invoked (clearTextureAtlas does NOT fire onChangeTextureAtlas
    // — it clears pixels + requests a redraw — so this trace is the signal).
    let dbg = false;
    try {
      dbg = localStorage.getItem('gwshell:webgl-debug') === '1';
    } catch {}
    terminalInstances.forEach(({ terminal }) => {
      terminal.options.theme = theme;
      // Match VSCode: the WebGL renderer's texture atlas bakes glyph pixels
      // with the *current* theme's RGB values (the atlas stores rendered
      // bitmaps, not color indices). When the color scheme changes, those
      // cached bitmaps hold stale colors — a plain refresh() re-draws cells
      // but the renderer pulls the old-colored glyph textures, so dim/bright
      // ANSI colors and the default fg/bg lag by one theme switch. Clearing
      // the atlas forces a re-rasterize with the new palette on the next
      // paint. Harmless no-op for the DOM renderer.
      requestAnimationFrame(() => {
        try {
          terminal.clearTextureAtlas();
          if (dbg) console.debug('[gwshell:webgl] clearTextureAtlas (color-scheme change)');
        } catch {}
        try {
          terminal.refresh(0, terminal.rows - 1);
        } catch {}
      });
    });
  }, [settings.terminalColorScheme, settings.theme]);

  useEffect(() => {
    terminalInstances.forEach(({ terminal }) => {
      // xterm's native copyOnSelect is intentionally kept OFF at all times.
      // GWShell implements auto-copy-on-select manually in TerminalView.tsx via
      // an onSelectionChange handler and a mouseup handler, both gated on
      // settings.autoCopyOnSelect. Using the native flag in addition would cause
      // a double-copy (clipboard written twice per selection). The dependency on
      // settings.autoCopyOnSelect re-runs this effect whenever the setting
      // changes to ensure any newly-created terminal instance also has the flag
      // cleared, but the written value is always false — this is correct.
      (terminal.options as unknown as { copyOnSelect?: boolean }).copyOnSelect = false; // eslint-disable-line no-restricted-syntax
    });
  }, [settings.autoCopyOnSelect]);
}
