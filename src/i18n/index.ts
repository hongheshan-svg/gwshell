import i18n, { type TFunction } from 'i18next';
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

// Collect every leaf key (dotted path) of the resource object — used to type
// `t()` callers so unknown keys fail to compile. Nested objects produce
// "section.key" entries; flat string values produce the string itself.
type LeafKeys<T, Prefix extends string = ''> = T extends object
  ? {
      [K in keyof T & string]: LeafKeys<T[K], Prefix extends '' ? K : `${Prefix}.${K}`>;
    }[keyof T & string]
  : Prefix;

export type TranslationKeys = LeafKeys<typeof gwshellZh>;

export function getT(locale: 'zh' | 'en'): TFunction {
  return i18n.getFixedT(locale, 'gwshell');
}
