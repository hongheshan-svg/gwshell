import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

const LEGACY_TERMINAL_FONT = 'JetBrainsMono, NotoSansSC';
const CMD_TERMINAL_FONT = 'Consolas, "Cascadia Mono", "Courier New", monospace';

export interface AppSettings {
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
  language: 'zh',
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
  terminalFont: CMD_TERMINAL_FONT,
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
  middleClickAction: 'none',
  rightClickAction: 'menu',
  terminalSound: false,
  ctrlVPaste: true,
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

interface SettingsStore {
  settings: AppSettings;
  loaded: boolean;
  hasSaved: boolean;
  load: () => Promise<void>;
  save: (s: AppSettings) => Promise<void>;
}

function normalizeSettings(saved: Partial<AppSettings>): AppSettings {
  const settings = { ...defaultSettings, ...saved };
  if (settings.terminalFont === LEGACY_TERMINAL_FONT) {
    settings.terminalFont = CMD_TERMINAL_FONT;
  }
  if (settings.language !== 'zh' && settings.language !== 'en') {
    settings.language = settings.language === 'English' ? 'en' : 'zh';
  }
  if (settings.middleClickAction === 'Paste' || settings.middleClickAction === '\u7c98\u8d34') {
    settings.middleClickAction = 'paste';
  } else if (settings.middleClickAction === 'None' || settings.middleClickAction === '\u4e0d\u6267\u884c') {
    settings.middleClickAction = 'none';
  }
  if (settings.rightClickAction === 'Paste' || settings.rightClickAction === '\u7c98\u8d34') {
    settings.rightClickAction = 'paste';
  } else if (settings.rightClickAction === 'Show Menu' || settings.rightClickAction === '\u663e\u793a\u83dc\u5355') {
    settings.rightClickAction = 'menu';
  }
  return settings;
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
        const merged = { ...defaultSettings, ...saved };
        const settings = normalizeSettings(saved);
        set({ settings, loaded: true, hasSaved: true });
        if (JSON.stringify(settings) !== JSON.stringify(merged)) {
          invoke('save_app_settings', { value: JSON.stringify(settings) }).catch(() => {});
        }
      } else {
        set({ loaded: true, hasSaved: false });
      }
    } catch {
      set({ loaded: true, hasSaved: false });
    }
  },

  save: async (settings: AppSettings) => {
    const normalized = normalizeSettings(settings);
    set({ settings: normalized, hasSaved: true });
    await invoke('save_app_settings', { value: JSON.stringify(normalized) });
  },
}));
