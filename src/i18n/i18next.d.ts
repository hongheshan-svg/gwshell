import 'i18next';
import gwshellZh from '../components/ai/i18n/locales/gwshell.zh.json';
import aiZh from '../components/ai/i18n/locales/ai.zh.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'gwshell';
    resources: {
      gwshell: typeof gwshellZh;
      ai: typeof aiZh;
    };
  }
}
