import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

// ---- Types ----

export interface AppSettings {
  // Basic
  theme: 'dark' | 'light';
  middleClickCloseTab: boolean;
  uiFont: string;
  editorLineEnding: string;
  enableAnimation: boolean;
  showRealtimeInfo: boolean;
  tabCloseButtonPos: string;
  ligatures: boolean;
  mouseWheelZoom: boolean;
  tabCloseConfirm: boolean;
  tabFlashAlert: boolean;
  multiLineTab: boolean;
  language: string;
  updateChannel: string;
  editorFont: string;
  zoomLevel: string;
  editorFontSize: string;
  editorAutoWrap: boolean;
  editorTabMode: string;
  autoLockScreen: boolean;
  autoLockScreenTime: string;
  lockScreenPassword: string;
  sessionTabMemory: boolean;
  showVipBadge: boolean;
  // SSH/SFTP
  terminalFont: string;
  terminalFontSize: string;
  terminalHighlight: boolean;
  sshSftpPathLink: boolean;
  autoCopyOnSelect: boolean;
  terminalCmdHint: boolean;
  sshHistoryCmd: boolean;
  sshHistoryCmdStorage: string;
  sshHistoryCmdLoadCount: string;
  terminalStripeBackground: boolean;
  renderMode: boolean;
  autoReconnect: boolean;
  middleClickAction: string;
  rightClickAction: string;
  terminalSound: boolean;
  ctrlVPaste: boolean;
  terminalLineHeight: string;
  terminalLetterSpacing: string;
  terminalMaxScrollback: string;
  logDirectory: string;
  sftpDefaultEditor: string;
  sftpParentDirClick: boolean;
  sftpDefaultSavePath: string;
  sftpDoubleClickAction: string;
  // Database
  dbTableFont: string;
  dbAutoExpand: boolean;
  dbShowPrimaryKey: boolean;
  dbCalcTotalRows: boolean;
  dbCompositeHeader: boolean;
  dbLoadAllFields: boolean;
  dbTextAlign: string;
  dbRowsPerPage: string;
  dbDangerSqlConfirm: boolean;
  dbStopOnError: boolean;
  dbScrollMode: string;
  dbTabSwitchSpeed: string;
  redisMaxLoad: string;
  redisShowValue: boolean;
  redisGroupSeparator: string;
  // Storage
  storageAutoSync: boolean;
  storageSource: string;
}

export const defaultSettings: AppSettings = {
  theme: 'dark',
  middleClickCloseTab: true,
  uiFont: 'JetBrainsMono, NotoSansSC',
  editorLineEnding: '(compat) \\r\\n',
  enableAnimation: false,
  showRealtimeInfo: false,
  tabCloseButtonPos: 'left',
  ligatures: true,
  mouseWheelZoom: true,
  tabCloseConfirm: true,
  tabFlashAlert: true,
  multiLineTab: false,
  language: '简体中文',
  updateChannel: 'stable',
  editorFont: 'JetBrainsMono, NotoSansSC',
  zoomLevel: '100%',
  editorFontSize: '14px',
  editorAutoWrap: false,
  editorTabMode: 'tab',
  autoLockScreen: false,
  autoLockScreenTime: 'off',
  lockScreenPassword: '',
  sessionTabMemory: false,
  showVipBadge: true,
  terminalFont: 'JetBrainsMono, NotoSansSC',
  terminalFontSize: '13px',
  terminalHighlight: true,
  sshSftpPathLink: false,
  autoCopyOnSelect: true,
  terminalCmdHint: false,
  sshHistoryCmd: true,
  sshHistoryCmdStorage: 'local',
  sshHistoryCmdLoadCount: '100',
  terminalStripeBackground: true,
  renderMode: true,
  autoReconnect: false,
  middleClickAction: 'none',
  rightClickAction: 'menu',
  terminalSound: false,
  ctrlVPaste: false,
  terminalLineHeight: '1.2',
  terminalLetterSpacing: '0',
  terminalMaxScrollback: '10000',
  logDirectory: '',
  sftpDefaultEditor: 'builtin',
  sftpParentDirClick: false,
  sftpDefaultSavePath: '',
  sftpDoubleClickAction: 'auto',
  dbTableFont: 'JetBrainsMono, NotoSansSC',
  dbAutoExpand: true,
  dbShowPrimaryKey: true,
  dbCalcTotalRows: false,
  dbCompositeHeader: false,
  dbLoadAllFields: false,
  dbTextAlign: 'auto',
  dbRowsPerPage: '500',
  dbDangerSqlConfirm: true,
  dbStopOnError: false,
  dbScrollMode: 'natural',
  dbTabSwitchSpeed: '1',
  redisMaxLoad: '10000',
  redisShowValue: false,
  redisGroupSeparator: ':',
  storageAutoSync: true,
  storageSource: 'off',
};

// ---- Store ----

interface SettingsStore {
  settings: AppSettings;
  loaded: boolean;
  /** true once the user has saved settings at least once (vs first-run defaults) */
  hasSaved: boolean;
  load: () => Promise<void>;
  save: (s: AppSettings) => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: { ...defaultSettings },
  loaded: false,
  hasSaved: false,

  load: async () => {
    try {
      const json = await invoke<string | null>('load_app_settings');
      if (json) {
        const saved = JSON.parse(json) as Partial<AppSettings>;
        set({ settings: { ...defaultSettings, ...saved }, loaded: true, hasSaved: true });
      } else {
        set({ loaded: true, hasSaved: false });
      }
    } catch {
      set({ loaded: true, hasSaved: false });
    }
  },

  save: async (settings: AppSettings) => {
    set({ settings, hasSaved: true });
    await invoke('save_app_settings', { value: JSON.stringify(settings) });
  },
}));
