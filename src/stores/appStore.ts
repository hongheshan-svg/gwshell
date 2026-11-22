import { create } from 'zustand';
import i18n, { detectLocale } from '../i18n';
import { createSessionSlice, type SessionSlice } from './sessionSlice';
import { createWorkspaceSlice, type WorkspaceSlice } from './workspaceSlice';
import { createUiSlice, type UiSlice, type DockerContainer } from './uiSlice';

export type { DockerContainer, SessionSlice, WorkspaceSlice, UiSlice };

export type AppStore = SessionSlice & WorkspaceSlice & UiSlice;

const initialLocale = detectLocale();

export const useAppStore = create<AppStore>()((...args) => ({
  ...createSessionSlice(...args),
  ...createWorkspaceSlice(initialLocale)(...args),
  ...createUiSlice(initialLocale)(...args),
}));

// Keep store in sync if i18next.changeLanguage is called from outside the store.
i18n.on('languageChanged', (lng) => {
  if (lng === 'zh' || lng === 'en') {
    const cur = useAppStore.getState();
    if (cur.locale !== lng) {
      useAppStore.setState({
        locale: lng,
        t: i18n.getFixedT(lng, 'gwshell'),
      });
    }
  }
});
