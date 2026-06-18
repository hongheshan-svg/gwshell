import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import * as commandHistory from '../lib/commandHistory';
import { parseBinding } from '../keymap/match';
import { KEY_ACTIONS } from '../keymap/actions';
const ACTION_IDS = new Set(KEY_ACTIONS.map((a) => a.id));

const LEGACY_TERMINAL_FONT = 'JetBrainsMono, NotoSansSC';
const CMD_TERMINAL_FONT = 'Consolas, "Cascadia Mono", "Courier New", monospace';

export interface AppSettings {
  theme: 'dark' | 'light';
  middleClickCloseTab: boolean;
  uiFont: string;
  enableAnimation: boolean;
  mouseWheelZoom: boolean;
  tabCloseConfirm: boolean;
  tabFlashAlert: boolean;
  language: string;
  zoomLevel: string;
  sessionTabMemory: boolean;
  terminalFont: string;
  terminalFontSize: string;
  autoCopyOnSelect: boolean;
  terminalCmdHint: boolean;
  sshHistoryCmd: boolean;
  sshHistoryCmdLoadCount: string;
  pasteWarnMultiline: boolean;
  terminalColorScheme: string;
  cmdHintAllSessions: boolean;
  cmdHintScopeByHost: boolean;
  terminalStripeBackground: boolean;
  middleClickAction: string;
  rightClickAction: string;
  terminalSound: boolean;
  ctrlVPaste: boolean;
  terminalLineHeight: string;
  terminalLetterSpacing: string;
  terminalMaxScrollback: string;
  keymapOverrides: Record<string, string | null>;
  quakeEnabled: boolean;
  quakeHotkey: string;
  homeView: 'card' | 'table';
  // Append terminal output (ANSI-stripped) to per-session log files
  sessionLogEnabled: boolean;
}

export const defaultSettings: AppSettings = {
  theme: 'dark',
  middleClickCloseTab: true,
  uiFont: 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans SC", sans-serif',
  enableAnimation: false,
  mouseWheelZoom: true,
  tabCloseConfirm: true,
  tabFlashAlert: true,
  language: 'zh',
  zoomLevel: '100%',
  sessionTabMemory: false,
  terminalFont: CMD_TERMINAL_FONT,
  terminalFontSize: '13px',
  autoCopyOnSelect: true,
  terminalCmdHint: false,
  sshHistoryCmd: true,
  sshHistoryCmdLoadCount: '100',
  pasteWarnMultiline: true,
  terminalColorScheme: 'auto',
  cmdHintAllSessions: true,
  cmdHintScopeByHost: true,
  terminalStripeBackground: true,
  middleClickAction: 'none',
  rightClickAction: 'menu',
  terminalSound: false,
  ctrlVPaste: true,
  terminalLineHeight: '1.2',
  terminalLetterSpacing: '0',
  terminalMaxScrollback: '10000',
  keymapOverrides: {},
  quakeEnabled: false,
  quakeHotkey: 'CommandOrControl+Shift+Backquote',
  homeView: 'card',
  sessionLogEnabled: false,
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
  if (settings.keymapOverrides && typeof settings.keymapOverrides === 'object') {
    const valid: Record<string, string | null> = {};
    for (const [id, binding] of Object.entries(settings.keymapOverrides)) {
      if (!ACTION_IDS.has(id)) continue;
      if (binding === null) { valid[id] = null; continue; }
      if (typeof binding === 'string' && parseBinding(binding)) valid[id] = binding;
    }
    settings.keymapOverrides = valid;
  } else {
    settings.keymapOverrides = {};
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
          invoke('save_app_settings', { value: JSON.stringify(settings) }).catch((err) => {
            console.error('Failed to persist settings:', err);
          });
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
    if (normalized.sshHistoryCmd) {
      commandHistory.init(parseInt(normalized.sshHistoryCmdLoadCount) || 100);
    }
  },
}));
