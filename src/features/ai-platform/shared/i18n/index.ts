import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import gwshellZh from '../../../../components/ai/i18n/locales/gwshell.zh.json';
import gwshellEn from '../../../../components/ai/i18n/locales/gwshell.en.json';
import aiZh from '../../../../components/ai/i18n/locales/ai.zh.json';
import aiEn from '../../../../components/ai/i18n/locales/ai.en.json';

import { detectLocale, persistLocale, type Locale } from './detect';

const initialLng = detectLocale();

void i18n.use(initReactI18next).init({
  resources: {
    zh: { gwshell: gwshellZh, ai: aiZh },
    en: { gwshell: gwshellEn, ai: aiEn },
  },
  lng: initialLng,
  fallbackLng: 'en',
  defaultNS: 'gwshell',
  ns: ['gwshell', 'ai'],
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