import { useEffect } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { useAppStore } from '../stores/appStore';
import { terminalInstances } from '../components/Terminal/TerminalView';

const LANG_MAP: Record<string, 'zh' | 'en'> = {
  '简体中文': 'zh',
  'English': 'en',
  '繁體中文': 'en',
  '日本語': 'en',
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
  return isNaN(n) ? fallback : n;
}

function parseNum(value: string, fallback: number): number {
  const n = parseFloat(value);
  return isNaN(n) ? fallback : n;
}

/** Apply all settings side-effects. Call once in App root after settings are loaded. */
export function useSettingsEffects() {
  const settings = useSettingsStore((s) => s.settings);
  const setTheme = useAppStore((s) => s.setTheme);
  const setLocale = useAppStore((s) => s.setLocale);

  // Theme
  useEffect(() => {
    setTheme(settings.theme);
  }, [settings.theme, setTheme]);

  // Language
  useEffect(() => {
    const locale = LANG_MAP[settings.language] ?? 'zh';
    setLocale(locale);
  }, [settings.language, setLocale]);

  // Zoom level
  useEffect(() => {
    const zoom = ZOOM_MAP[settings.zoomLevel] ?? 1.0;
    // Use CSS zoom on the root element (simplest cross-platform approach)
    (document.documentElement.style as unknown as Record<string, string>)['zoom'] = String(zoom);
  }, [settings.zoomLevel]);

  // Animation
  useEffect(() => {
    document.documentElement.classList.toggle('enable-animation', settings.enableAnimation);
  }, [settings.enableAnimation]);

  // Stripe background
  useEffect(() => {
    document.documentElement.classList.toggle('terminal-stripe-bg', settings.terminalStripeBackground);
  }, [settings.terminalStripeBackground]);

  // Terminal options — update all existing xterm instances
  useEffect(() => {
    const fontSize = parsePx(settings.terminalFontSize, 13);
    const lineHeight = parseNum(settings.terminalLineHeight, 1.2);
    const letterSpacing = parseNum(settings.terminalLetterSpacing, 0);
    const scrollback = parsePx(settings.terminalMaxScrollback, 10000);

    terminalInstances.forEach(({ terminal }) => {
      terminal.options.fontFamily = settings.terminalFont;
      terminal.options.fontSize = fontSize;
      terminal.options.lineHeight = lineHeight;
      terminal.options.letterSpacing = letterSpacing;
      terminal.options.scrollback = scrollback;
    });
  }, [
    settings.terminalFont,
    settings.terminalFontSize,
    settings.terminalLineHeight,
    settings.terminalLetterSpacing,
    settings.terminalMaxScrollback,
  ]);

  // Auto-copy on select
  useEffect(() => {
    terminalInstances.forEach(({ terminal }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (terminal.options as any).copyOnSelect = settings.autoCopyOnSelect;
    });
  }, [settings.autoCopyOnSelect]);
}
