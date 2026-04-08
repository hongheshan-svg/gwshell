import 'i18next';
import type { TranslationKeys } from './zh';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: {
      translation: Record<TranslationKeys, string>;
    };
  }
}
