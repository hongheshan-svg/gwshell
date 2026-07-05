import 'i18next';
import type gwshellZh from './locales/gwshell.zh.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'gwshell';
    resources: {
      gwshell: typeof gwshellZh;
    };
  }
}
