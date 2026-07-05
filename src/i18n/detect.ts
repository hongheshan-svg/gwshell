export type Locale = 'zh' | 'en';

const STORAGE_KEY = 'gwshell.locale';

// Some browsers expose `navigator.userLanguage` (legacy, IE/old Edge). It is
// not in the standard lib.dom.d.ts typings, so declare it minimally here.
interface NavigatorWithUserLanguage extends Navigator {
  userLanguage?: string;
}

export function detectLocale(): Locale {
  if (typeof window !== 'undefined') {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'zh' || stored === 'en') return stored;
    } catch {
      // ignore
    }
  }

  let lang = 'en';
  if (typeof navigator !== 'undefined') {
    // `navigator.userLanguage` is a legacy non-standard property (IE/old
    // Edge) not in lib.dom.d.ts — cast at this boundary to read it.
    // eslint-disable-next-line no-restricted-syntax
    const nav = navigator as NavigatorWithUserLanguage;
    lang = nav.userLanguage ?? nav.language ?? 'en';
  }
  return lang.startsWith('zh') ? 'zh' : 'en';
}

export function persistLocale(locale: Locale): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // ignore
    }
  }
}
