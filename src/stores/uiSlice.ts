import type { TFunction } from 'i18next';
import type { StateCreator } from 'zustand';
import type { SessionConfig, ThemeMode } from '../types';
import i18n, { type Locale } from '../i18n';

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: string;
}

export interface UiSlice {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TFunction<'gwshell', undefined>;

  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;

  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  activeNavItem: string;
  setActiveNavItem: (item: string) => void;

  showNewSession: boolean;
  setShowNewSession: (show: boolean) => void;
  showQuickConnect: boolean;
  setShowQuickConnect: (show: boolean) => void;
  showCommandPalette: boolean;
  setShowCommandPalette: (show: boolean) => void;
  showTerminalSearch: boolean;
  setShowTerminalSearch: (show: boolean) => void;
  editingSession: SessionConfig | null;
  setEditingSession: (session: SessionConfig | null) => void;
  openEditSession: (session: SessionConfig) => void;
  showDockerModal: boolean;
  setShowDockerModal: (show: boolean) => void;
  showLocalTerminalModal: boolean;
  setShowLocalTerminalModal: (show: boolean) => void;
  showSerialModal: boolean;
  setShowSerialModal: (show: boolean) => void;
  dockerPicker: { tabId: string; containers: DockerContainer[] } | null;
  setDockerPicker: (p: { tabId: string; containers: DockerContainer[] } | null) => void;

  showAppMenu: boolean;
  setShowAppMenu: (show: boolean) => void;

  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
  settingsInitialNav: string | null;
  openSettingsNav: (nav: string) => void;

  sftpPanelOpen: boolean;
  toggleSftpPanel: () => void;

  serverPanelOpen: boolean;
  toggleServerPanel: () => void;

  agentPanelOpen: boolean;
  toggleAgentPanel: () => void;

  groupDefaultsTarget: string | null;
  setGroupDefaultsTarget: (group: string | null) => void;

  vaultLocked: boolean;
  setVaultLocked: (locked: boolean) => void;
}

export function createUiSlice(initialLocale: Locale): StateCreator<UiSlice, [], [], UiSlice> {
  return (set) => ({
    locale: initialLocale,
    setLocale: (locale) => {
      void i18n.changeLanguage(locale);
      set({
        locale,
        t: i18n.getFixedT(locale, 'gwshell'),
      });
    },
    t: i18n.getFixedT(initialLocale, 'gwshell'),

    theme: 'dark',
    setTheme: (theme) => set({ theme }),
    toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),

    sidebarCollapsed: false,
    toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
    activeNavItem: 'sessions',
    setActiveNavItem: (item) => set({ activeNavItem: item }),

    showNewSession: false,
    setShowNewSession: (show) => set({ showNewSession: show }),
    showQuickConnect: false,
    setShowQuickConnect: (show) => set({ showQuickConnect: show }),
    showCommandPalette: false,
    setShowCommandPalette: (show) => set({ showCommandPalette: show }),
    showTerminalSearch: false,
    setShowTerminalSearch: (show) => set({ showTerminalSearch: show }),
    editingSession: null,
    setEditingSession: (session) => set({ editingSession: session }),
    openEditSession: (session) => {
      switch (session.session_type) {
        case 'serial':
          set({ editingSession: session, showSerialModal: true });
          break;
        case 'localshell':
          set({ editingSession: session, showLocalTerminalModal: true });
          break;
        case 'docker':
          set({ editingSession: session, showDockerModal: true });
          break;
        default:
          set({ editingSession: session, showNewSession: true });
          break;
      }
    },
    showDockerModal: false,
    setShowDockerModal: (show) => set({ showDockerModal: show }),
    showLocalTerminalModal: false,
    setShowLocalTerminalModal: (show) => set({ showLocalTerminalModal: show }),
    showSerialModal: false,
    setShowSerialModal: (show) => set({ showSerialModal: show }),
    dockerPicker: null,
    setDockerPicker: (p) => set({ dockerPicker: p }),

    showAppMenu: false,
    setShowAppMenu: (show) => set({ showAppMenu: show }),

    showSettings: false,
    setShowSettings: (show) => set({ showSettings: show, settingsInitialNav: null }),
    settingsInitialNav: null,
    openSettingsNav: (nav) => set({ settingsInitialNav: nav, showSettings: true }),

    sftpPanelOpen: true,
    toggleSftpPanel: () => set((state) => ({ sftpPanelOpen: !state.sftpPanelOpen })),

    serverPanelOpen: false,
    toggleServerPanel: () => set((state) => ({ serverPanelOpen: !state.serverPanelOpen })),

    agentPanelOpen: false,
    toggleAgentPanel: () => set((state) => ({ agentPanelOpen: !state.agentPanelOpen })),

    groupDefaultsTarget: null,
    setGroupDefaultsTarget: (group) => set({ groupDefaultsTarget: group }),

    vaultLocked: false,
    setVaultLocked: (locked) => set({ vaultLocked: locked }),
  });
}
