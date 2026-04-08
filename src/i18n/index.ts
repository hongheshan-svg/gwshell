// gwshell i18n is implemented as an i18next instance under src/components/ai/i18n.
// This module re-exports it for legacy import paths.
import i18n from '../components/ai/i18n';
import type { TranslationKeys } from '../components/ai/i18n';

export { detectLocale } from '../components/ai/i18n';
export type { Locale, TranslationKeys } from '../components/ai/i18n';

/**
 * Backwards-compatible getT(locale) that returns a translation function with
 * the same signature as the old hand-rolled implementation.
 *
 * Old shape: (key: TranslationKeys, params?: Record<string, string|number>) => string
 * Routed to i18next's getFixedT(lng, 'gwshell').
 */
export function getT(locale: 'zh' | 'en') {
  const fn = i18n.getFixedT(locale, 'gwshell');
  return function t(key: TranslationKeys, params?: Record<string, string | number>): string {
    return fn(key as string, params as any);
  };
}

export default i18n;
