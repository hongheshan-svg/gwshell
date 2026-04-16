import { useEffect } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { useAppStore } from '../stores/appStore';
import { terminalInstances } from '../components/Terminal/terminalRegistry';

const LANG_MAP: Record<string, 'zh' | 'en'> = {
  zh: 'zh',
  en: 'en',
  '简体中文': 'zh',
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

  useEffect(() => {
    const zoom = ZOOM_MAP[settings.zoomLevel] ?? 1.0;
    (document.documentElement.style as unknown as Record<string, string>).zoom = String(zoom);
  }, [settings.zoomLevel]);

  useEffect(() => {
    document.documentElement.classList.toggle('enable-animation', settings.enableAnimation);
  }, [settings.enableAnimation]);

  useEffect(() => {
    document.documentElement.classList.toggle('terminal-stripe-bg', settings.terminalStripeBackground);
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
        try { fitAddon.fit(); } catch {}
        try { terminal.clearTextureAtlas(); } catch {}
        try { terminal.refresh(0, terminal.rows - 1); } catch {}
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
    terminalInstances.forEach(({ terminal }) => {
      // GWShell handles terminal copy through the Tauri clipboard plugin so
      // right-click copy and paste match Windows CMD behavior consistently.
      (terminal.options as unknown as { copyOnSelect?: boolean }).copyOnSelect = false;
    });
  }, [settings.autoCopyOnSelect]);
}
