import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zh from './zh';
import en from './en';

export type Locale = 'zh' | 'en';

export function detectLocale(): Locale {
  const lang = navigator.language || (navigator as any).userLanguage || 'en';
  return lang.startsWith('zh') ? 'zh' : 'en';
}

i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
  lng: detectLocale(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
export type { TranslationKeys } from './zh';
