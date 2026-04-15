import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import gwshellZh from './locales/gwshell.zh.json';
import gwshellEn from './locales/gwshell.en.json';

import { detectLocale, persistLocale, type Locale } from './detect';

const initialLng = detectLocale();

void i18n.use(initReactI18next).init({
  resources: {
    zh: { gwshell: gwshellZh },
    en: { gwshell: gwshellEn },
  },
  lng: initialLng,
  fallbackLng: 'en',
  defaultNS: 'gwshell',
  ns: ['gwshell'],
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

i18n.on('languageChanged', (lng) => {
  if (lng === 'zh' || lng === 'en') persistLocale(lng);
});

export default i18n;
export { detectLocale, persistLocale };
export type { Locale };
export type TranslationKeys = keyof typeof gwshellZh;

export function getT(locale: 'zh' | 'en') {
  const fn = i18n.getFixedT(locale, 'gwshell');
  return function t(key: TranslationKeys, params?: Record<string, string | number>): string {
    return fn(key as string, params as any);
  };
}
