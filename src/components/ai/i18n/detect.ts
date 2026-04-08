export type Locale = 'zh' | 'en';

const STORAGE_KEY = 'gwshell.locale';

/** Detect locale: stored preference > browser > 'en'. */
export function detectLocale(): Locale {
  if (typeof window !== 'undefined') {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'zh' || stored === 'en') return stored;
    } catch {
      /* ignore */
    }
  }
  const lang =
    (typeof navigator !== 'undefined' && (navigator.language || (navigator as any).userLanguage)) || 'en';
  return lang.startsWith('zh') ? 'zh' : 'en';
}

export function persistLocale(loc: Locale): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, loc);
    } catch {
      /* ignore */
    }
  }
}