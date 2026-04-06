import zh from './zh';
import en from './en';
import type { TranslationKeys } from './zh';

export type Locale = 'zh' | 'en';

const translations: Record<Locale, Record<TranslationKeys, string>> = { zh, en };

/**
 * Detect the system/browser language and return 'zh' or 'en'.
 */
export function detectLocale(): Locale {
  const lang = navigator.language || (navigator as any).userLanguage || 'en';
  return lang.startsWith('zh') ? 'zh' : 'en';
}

/**
 * Get the translation function for a given locale.
 * Supports simple placeholders: t('key', { count: 5 }) replaces {count} in the string.
 */
export function getT(locale: Locale) {
  const dict = translations[locale] ?? translations.en;
  return function t(key: TranslationKeys, params?: Record<string, string | number>): string {
    let text = dict[key] ?? (translations.en[key] as string) ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }
    return text;
  };
}

export type { TranslationKeys };
