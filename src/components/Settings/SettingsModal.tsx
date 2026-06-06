import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X, FolderOpen } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useSettingsStore, defaultSettings as persistedDefaultSettings } from '../../stores/settingsStore';
import i18n from '../../i18n';
import type { TranslationKeys } from '../../i18n';
import { TERMINAL_SCHEME_OPTIONS } from '../../lib/terminalThemes';

/* ---- Nav categories ---- */
const navCategories: { title?: TranslationKeys; items: { id: string; labelKey: TranslationKeys }[] }[] = [
  {
    title: 'settings_cat_general',
    items: [
      { id: 'basic', labelKey: 'settings_basic' },
      { id: 'ssh-sftp', labelKey: 'settings_ssh_sftp' },
      { id: 'database', labelKey: 'settings_database' },
    ],
  },
  {
    title: 'settings_cat_shortcuts',
    items: [
      { id: 'shortcut-basic', labelKey: 'settings_shortcut_basic' },
      { id: 'shortcut-ssh', labelKey: 'settings_shortcut_ssh' },
      { id: 'shortcut-database', labelKey: 'settings_shortcut_db' },
    ],
  },
  { items: [{ id: 'docker', labelKey: 'settings_docker' }] },
  { items: [{ id: 'storage', labelKey: 'settings_storage' }] },
  { items: [{ id: 'referral', labelKey: 'settings_referral' }] },
];

/* ---- Settings state ---- */
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
  pasteWarnMultiline: boolean;
  terminalColorScheme: string;
  cmdHintAllSessions: boolean;
  cmdHintShellIntegration: boolean;
  cmdHintDeferToRemote: boolean;
  cmdHintScopeByHost: boolean;
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
  keymapOverrides: Record<string, string | null>;
}

const _t = (key: TranslationKeys) => i18n.t(key);
const CMD_TERMINAL_FONT = 'Consolas, "Cascadia Mono", "Courier New", monospace';

const defaultSettings: AppSettings = {
  theme: 'dark',
  middleClickCloseTab: true,
  uiFont: 'JetBrainsMono, NotoSansSC',
  editorLineEnding: '(compat) \\r\\n',
  enableAnimation: false,
  showRealtimeInfo: false,
  tabCloseButtonPos: _t('settings_tab_close_left'),
  ligatures: true,
  mouseWheelZoom: true,
  tabCloseConfirm: true,
  tabFlashAlert: true,
  multiLineTab: false,
  language: '简体中文',
  updateChannel: _t('settings_update_stable'),
  editorFont: 'JetBrainsMono, NotoSansSC',
  zoomLevel: '100%',
  editorFontSize: '14px',
  editorAutoWrap: false,
  editorTabMode: _t('settings_tab_mode_tab'),
  autoLockScreen: false,
  autoLockScreenTime: _t('settings_lock_time_off'),
  lockScreenPassword: '',
  sessionTabMemory: false,
  showVipBadge: true,
  terminalFont: CMD_TERMINAL_FONT,
  terminalFontSize: '12px',
  terminalHighlight: true,
  sshSftpPathLink: false,
  autoCopyOnSelect: true,
  terminalCmdHint: false,
  sshHistoryCmd: true,
  sshHistoryCmdStorage: _t('settings_ssh_history_local'),
  sshHistoryCmdLoadCount: '100',
  pasteWarnMultiline: true,
  terminalColorScheme: 'auto',
  cmdHintAllSessions: true,
  cmdHintShellIntegration: false,
  cmdHintDeferToRemote: false,
  cmdHintScopeByHost: true,
  terminalStripeBackground: true,
  renderMode: true,
  middleClickAction: 'none',
  rightClickAction: 'menu',
  terminalSound: false,
  ctrlVPaste: true,
  terminalLineHeight: '1',
  terminalLetterSpacing: '0',
  terminalMaxScrollback: '1000',
  logDirectory: '',
  sftpDefaultEditor: _t('settings_sftp_editor_builtin'),
  sftpParentDirClick: false,
  sftpDefaultSavePath: '',
  sftpDoubleClickAction: _t('settings_sftp_auto'),
  dbTableFont: 'JetBrainsMono, NotoSansSC',
  dbAutoExpand: true,
  dbShowPrimaryKey: true,
  dbCalcTotalRows: false,
  dbCompositeHeader: false,
  dbLoadAllFields: false,
  dbTextAlign: _t('settings_db_align_auto'),
  dbRowsPerPage: '500',
  dbDangerSqlConfirm: true,
  dbStopOnError: false,
  dbScrollMode: _t('settings_db_scroll_natural'),
  dbTabSwitchSpeed: '1',
  redisMaxLoad: '10000',
  redisShowValue: false,
  redisGroupSeparator: ':',
  storageAutoSync: true,
  storageSource: _t('settings_storage_source_off'),
  keymapOverrides: {},
};
void defaultSettings;

/* ---- Shortcut data ---- */
interface ShortcutItem { labelKey: TranslationKeys; keys: string }
const shortcutsBasicLeft: ShortcutItem[] = [
  { labelKey: 'settings_sc_save', keys: 'Ctrl S' },
  { labelKey: 'settings_sc_find', keys: 'Ctrl F' },
  { labelKey: 'settings_sc_copy', keys: 'Ctrl C' },
  { labelKey: 'settings_sc_paste', keys: 'Ctrl V' },
  { labelKey: 'settings_sc_cut', keys: 'Ctrl X' },
  { labelKey: 'settings_sc_delete', keys: 'Backspace' },
  { labelKey: 'settings_sc_rename', keys: 'F2' },
];
const shortcutsBasicRight: ShortcutItem[] = [
  { labelKey: 'settings_sc_refresh', keys: 'F5' },
  { labelKey: 'settings_sc_enter', keys: 'Enter' },
  { labelKey: 'settings_sc_undo', keys: 'Ctrl Z' },
  { labelKey: 'settings_sc_redo', keys: 'Ctrl Y' },
  { labelKey: 'settings_sc_selectall', keys: 'Ctrl A' },
  { labelKey: 'settings_sc_focus', keys: 'Tab' },
];
const shortcutsOtherLeft: ShortcutItem[] = [
  { labelKey: 'settings_sc_agent', keys: 'Ctrl L' },
  { labelKey: 'settings_sc_global_search', keys: 'Ctrl Shift F' },
  { labelKey: 'settings_sc_history', keys: 'Ctrl E' },
  { labelKey: 'settings_sc_format', keys: 'Shift Alt F' },
  { labelKey: 'settings_sc_compress', keys: 'Shift Alt C' },
];
const shortcutsOtherRight: ShortcutItem[] = [
  { labelKey: 'settings_sc_left', keys: '←' },
  { labelKey: 'settings_sc_right', keys: '→' },
  { labelKey: 'settings_sc_up', keys: '↑' },
  { labelKey: 'settings_sc_down', keys: '↓' },
  { labelKey: 'settings_sc_rotate', keys: 'Ctrl Shift →' },
];
const shortcutsSshLeft: ShortcutItem[] = [
  { labelKey: 'settings_sc_term_copy', keys: 'Ctrl Shift C' },
  { labelKey: 'settings_sc_clear', keys: 'Ctrl Shift L' },
  { labelKey: 'settings_sc_upload', keys: 'Ctrl Shift U' },
  { labelKey: 'settings_sc_download', keys: 'Ctrl Shift D' },
  { labelKey: 'settings_sc_copy_path', keys: 'Ctrl Alt C' },
  { labelKey: 'settings_sc_new_file', keys: 'Ctrl Alt N' },
];
const shortcutsSshRight: ShortcutItem[] = [
  { labelKey: 'settings_sc_term_paste', keys: 'Ctrl Shift V' },
  { labelKey: 'settings_sc_reconnect', keys: 'Ctrl Shift R' },
  { labelKey: 'settings_sc_edit_file', keys: 'Ctrl Alt E' },
  { labelKey: 'settings_sc_chmod', keys: 'Ctrl Alt M' },
  { labelKey: 'settings_sc_broadcast', keys: 'Ctrl Shift B' },
];
const shortcutsDbLeft: ShortcutItem[] = [
  { labelKey: 'settings_sc_new_query', keys: 'Ctrl Shift Q' },
  { labelKey: 'settings_sc_new_table', keys: 'Ctrl Shift T' },
  { labelKey: 'settings_sc_table_list', keys: 'Ctrl Shift 1' },
  { labelKey: 'settings_sc_query_list', keys: 'Ctrl Shift 3' },
  { labelKey: 'settings_sc_structure', keys: 'Ctrl Shift S' },
  { labelKey: 'settings_sc_run_sql', keys: 'Ctrl Enter' },
  { labelKey: 'settings_sc_stop_sql', keys: 'Ctrl F2' },
  { labelKey: 'settings_sc_show_ddl', keys: 'None' },
];
const shortcutsDbRight: ShortcutItem[] = [
  { labelKey: 'settings_sc_new_view', keys: 'Ctrl Shift V' },
  { labelKey: 'settings_sc_start_tx', keys: 'None' },
  { labelKey: 'settings_sc_rollback', keys: 'None' },
  { labelKey: 'settings_sc_commit', keys: 'None' },
  { labelKey: 'settings_sc_table_data', keys: 'Ctrl Shift 0' },
  { labelKey: 'settings_sc_filter', keys: 'None' },
  { labelKey: 'settings_sc_insert', keys: 'Ctrl Insert' },
  { labelKey: 'settings_sc_clone', keys: 'Ctrl Shift C' },
  { labelKey: 'settings_sc_set_null', keys: 'Alt Delete' },
];
const shortcutsDockerLeft: ShortcutItem[] = [
  { labelKey: 'settings_sc_container_list', keys: 'Ctrl Shift 1' },
  { labelKey: 'settings_sc_image_list', keys: 'Ctrl Shift 2' },
  { labelKey: 'settings_sc_container_detail', keys: 'Ctrl Shift C' },
  { labelKey: 'settings_sc_container_terminal', keys: 'Ctrl Shift T' },
  { labelKey: 'settings_sc_container_log', keys: 'Ctrl Shift L' },
  { labelKey: 'settings_sc_container_image', keys: 'Ctrl Shift I' },
  { labelKey: 'settings_sc_image_pull', keys: 'Ctrl Shift P' },
];
const shortcutsDockerRight: ShortcutItem[] = [
  { labelKey: 'settings_sc_network_list', keys: 'Ctrl Shift 3' },
  { labelKey: 'settings_sc_volume_list', keys: 'Ctrl Shift 4' },
  { labelKey: 'settings_sc_start_container', keys: 'Ctrl Shift 0' },
  { labelKey: 'settings_sc_stop_container', keys: 'Ctrl Shift W' },
  { labelKey: 'settings_sc_restart_container', keys: 'Ctrl Shift R' },
  { labelKey: 'settings_sc_pause_container', keys: 'Ctrl Shift E' },
];


/* ---- Sub-components ---- */
const Toggle: React.FC<{ value: boolean; onChange: (v: boolean) => void }> = ({ value, onChange }) => (
  <button className={`settings-toggle ${value ? 'on' : ''}`} onClick={() => onChange(!value)} type="button">
    <span className="settings-toggle-knob" />
  </button>
);

type SelectOption = string | { value: string; label: string };
const optionValue = (option: SelectOption) => typeof option === 'string' ? option : option.value;
const optionLabel = (option: SelectOption) => typeof option === 'string' ? option : option.label;

const Sel: React.FC<{ value: string; options: SelectOption[]; onChange: (v: string) => void }> = ({ value, options, onChange }) => {
  const resolvedOptions = (value === 'zh' || value === 'en') && !options.some((o) => optionValue(o) === value)
    ? [{ value: 'zh', label: '简体中文' }, { value: 'en', label: 'English' }]
    : options;

  return (
    <select className="settings-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {resolvedOptions.map((o) => <option key={optionValue(o)} value={optionValue(o)}>{optionLabel(o)}</option>)}
    </select>
  );
};

const NumInput: React.FC<{ value: string; onChange: (v: string) => void; prefix?: string; width?: number }> = ({ value, onChange, prefix, width }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
    {prefix && <span className="settings-desc">{prefix}</span>}
    <input className="settings-input" style={{ width: width || 70 }} value={value} onChange={(e) => onChange(e.target.value)} />
  </div>
);

const Row: React.FC<{ label: string; desc?: string; children: React.ReactNode }> = ({ label, desc, children }) => (
  <div className="settings-row">
    <div className="settings-row-left">
      <span className="settings-label">{label}</span>
      {desc && <span className="settings-desc">{desc}</span>}
    </div>
    <div className="settings-row-right">{children}</div>
  </div>
);

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="settings-section-title">{children}</div>
);

const ShortcutTable: React.FC<{ left: ShortcutItem[]; right: ShortcutItem[]; t: (k: TranslationKeys) => string }> = ({ left, right, t }) => (
  <div className="settings-columns">
    <div className="settings-col">
      {left.map((s) => (
        <div key={s.labelKey} className="shortcut-row">
          <span className="shortcut-label">{t(s.labelKey)}</span>
          <span className="shortcut-keys">{s.keys.split(' ').map((k, i) => <kbd key={i}>{k}</kbd>)}</span>
        </div>
      ))}
    </div>
    <div className="settings-col">
      {right.map((s) => (
        <div key={s.labelKey} className="shortcut-row">
          <span className="shortcut-label">{t(s.labelKey)}</span>
          <span className="shortcut-keys">{s.keys.split(' ').map((k, i) => <kbd key={i}>{k}</kbd>)}</span>
        </div>
      ))}
    </div>
  </div>
);

/* ---- Main Component ---- */
export const SettingsModal: React.FC = () => {
  const { showSettings, setShowSettings, theme, setTheme } = useAppStore();
  const persistedSettings = useSettingsStore((s) => s.settings);
  const saveSettings = useSettingsStore((s) => s.save);
  const { t } = useTranslation();
  const [activeNav, setActiveNav] = useState('basic');
  const [settings, setSettings] = useState<AppSettings>({ ...persistedDefaultSettings, theme });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (showSettings) {
      setSettings({ ...persistedSettings, theme });
      setDirty(false);
    }
  }, [showSettings, persistedSettings, theme]);

  const u = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }, []);

  const handleApply = async () => {
    await saveSettings(settings);
    setTheme(settings.theme);
    setDirty(false);
  };

  const handleReset = () => { setSettings({ ...persistedDefaultSettings, theme }); setDirty(true); };

  if (!showSettings) return null;
  const handleClose = () => setShowSettings(false);
  const fonts = [CMD_TERMINAL_FONT, 'Consolas', 'Cascadia Mono', 'Cascadia Code', 'JetBrains Mono, "Noto Sans SC", monospace', 'Fira Code', 'monospace'];

  return (
    <div className="settings-overlay">
      <div className="settings-panel">
        {/* Header */}
        <div className="settings-header">
          <div className="settings-header-left"><span className="settings-brand">GWShell</span></div>
          <h2>{t('settings_title')}</h2>
          <button className="modal-close" onClick={handleClose}><X size={16} /></button>
        </div>

        <div className="settings-body">
          {/* Nav */}
          <div className="settings-nav">
            {navCategories.map((cat, i) => (
              <div key={i} className="settings-nav-group">
                {cat.title && <div className="settings-nav-title">{t(cat.title)}</div>}
                {cat.items.map((item) => (
                  <button key={item.id} className={`settings-nav-item ${activeNav === item.id ? 'active' : ''}`}
                    onClick={() => setActiveNav(item.id)}>{t(item.labelKey)}</button>
                ))}
              </div>
            ))}
          </div>

          {/* Content */}
          <div className="settings-content">

            {/* ===== 基础 ===== */}
            {activeNav === 'basic' && (
              <div className="settings-columns">
                <div className="settings-col">
                  <SectionTitle>{t('settings_section_basic')}</SectionTitle>
                  <Row label={t('settings_theme')}><Sel value={settings.theme === 'dark' ? 'Dark' : 'Light'} options={['Dark', 'Light']} onChange={(v) => u('theme', v === 'Dark' ? 'dark' : 'light')} /></Row>
                  <Row label={t('settings_middle_close')}><Toggle value={settings.middleClickCloseTab} onChange={(v) => u('middleClickCloseTab', v)} /></Row>
                  <Row label={t('settings_ui_font')}><Sel value={settings.uiFont} options={fonts} onChange={(v) => u('uiFont', v)} /></Row>
                  <Row label={t('settings_line_ending')}><Sel value={settings.editorLineEnding} options={['(compat) \\r\\n', '\\n', '\\r']} onChange={(v) => u('editorLineEnding', v)} /></Row>
                  <Row label={t('settings_animation')}><Toggle value={settings.enableAnimation} onChange={(v) => u('enableAnimation', v)} /></Row>
                  <Row label={t('settings_realtime_info')} desc={t('settings_realtime_info_desc')}><Toggle value={settings.showRealtimeInfo} onChange={(v) => u('showRealtimeInfo', v)} /></Row>
                  <Row label={t('settings_tab_close_pos')}><Sel value={settings.tabCloseButtonPos} options={[{ value: 'left', label: t('settings_tab_close_left') }, { value: 'right', label: t('settings_tab_close_right') }]} onChange={(v) => u('tabCloseButtonPos', v)} /></Row>
                  <Row label={t('settings_ligatures')}><Toggle value={settings.ligatures} onChange={(v) => u('ligatures', v)} /></Row>
                  <Row label={t('settings_mouse_zoom')}><Toggle value={settings.mouseWheelZoom} onChange={(v) => u('mouseWheelZoom', v)} /></Row>
                  <Row label={t('settings_tab_close_confirm')} desc={t('settings_tab_close_confirm_desc')}><Toggle value={settings.tabCloseConfirm} onChange={(v) => u('tabCloseConfirm', v)} /></Row>
                  <Row label={t('settings_tab_flash')} desc={t('settings_tab_flash_desc')}><Toggle value={settings.tabFlashAlert} onChange={(v) => u('tabFlashAlert', v)} /></Row>
                  <Row label={t('settings_multiline_tab')} desc={t('settings_multiline_tab_desc')}><Toggle value={settings.multiLineTab} onChange={(v) => u('multiLineTab', v)} /></Row>
                </div>
                <div className="settings-col">
                  <SectionTitle>&nbsp;</SectionTitle>
                  <Row label={t('settings_language')}><Sel value={settings.language} options={['简体中文', 'English', '繁體中文', '日本語']} onChange={(v) => u('language', v)} /></Row>
                  <Row label={t('settings_update_channel')} desc={t('settings_update_channel_desc')}><Sel value={settings.updateChannel} options={[{ value: 'stable', label: t('settings_update_stable') }, { value: 'beta', label: t('settings_update_beta') }, { value: 'dev', label: t('settings_update_dev') }]} onChange={(v) => u('updateChannel', v)} /></Row>
                  <Row label={t('settings_editor_font')}><Sel value={settings.editorFont} options={fonts} onChange={(v) => u('editorFont', v)} /></Row>
                  <Row label={t('settings_zoom')}><Sel value={settings.zoomLevel} options={['80%', '90%', '100%', '110%', '120%', '150%']} onChange={(v) => u('zoomLevel', v)} /></Row>
                  <Row label={t('settings_editor_fontsize')}><Sel value={settings.editorFontSize} options={['12px', '13px', '14px', '15px', '16px', '18px', '20px']} onChange={(v) => u('editorFontSize', v)} /></Row>
                  <Row label={t('settings_editor_wrap')}><Toggle value={settings.editorAutoWrap} onChange={(v) => u('editorAutoWrap', v)} /></Row>
                  <Row label={t('settings_editor_tab_mode')}><Sel value={settings.editorTabMode} options={[{ value: 'tab', label: t('settings_tab_mode_tab') }, { value: 'space2', label: t('settings_tab_mode_space2') }, { value: 'space4', label: t('settings_tab_mode_space4') }]} onChange={(v) => u('editorTabMode', v)} /></Row>
                  <Row label={t('settings_auto_lock')} desc={t('settings_auto_lock_desc')}><Toggle value={settings.autoLockScreen} onChange={(v) => u('autoLockScreen', v)} /></Row>
                  <Row label={t('settings_auto_lock_time')}><Sel value={settings.autoLockScreenTime} options={[{ value: 'off', label: t('settings_lock_time_off') }, { value: '1m', label: t('settings_lock_time_1m') }, { value: '5m', label: t('settings_lock_time_5m') }, { value: '10m', label: t('settings_lock_time_10m') }, { value: '30m', label: t('settings_lock_time_30m') }]} onChange={(v) => u('autoLockScreenTime', v)} /></Row>
                  <Row label={t('settings_lock_password')}><input type="password" className="settings-input" value={settings.lockScreenPassword} onChange={(e) => u('lockScreenPassword', e.target.value)} disabled={!settings.autoLockScreen} /></Row>
                  <Row label={t('settings_session_tab_memory')} desc={t('settings_session_tab_memory_desc')}><Toggle value={settings.sessionTabMemory} onChange={(v) => u('sessionTabMemory', v)} /></Row>
                  <Row label={t('settings_show_vip')} desc={t('settings_show_vip_desc')}><Toggle value={settings.showVipBadge} onChange={(v) => u('showVipBadge', v)} /></Row>
                </div>
              </div>
            )}

            {/* ===== SSH/SFTP ===== */}
            {activeNav === 'ssh-sftp' && (
              <>
                <SectionTitle>SSH</SectionTitle>
                <div className="settings-columns">
                  <div className="settings-col">
                    <Row label={t('settings_terminal_font')} desc={t('settings_terminal_font_desc')}><Sel value={settings.terminalFont} options={fonts} onChange={(v) => u('terminalFont', v)} /></Row>
                    <Row label={t('settings_terminal_highlight')}><Toggle value={settings.terminalHighlight} onChange={(v) => u('terminalHighlight', v)} /></Row>
                    <Row label={t('settings_sftp_path_link')}><Toggle value={settings.sshSftpPathLink} onChange={(v) => u('sshSftpPathLink', v)} /></Row>
                    <Row label={t('settings_auto_copy')}><Toggle value={settings.autoCopyOnSelect} onChange={(v) => u('autoCopyOnSelect', v)} /></Row>
                    <Row label={t('settings_cmd_hint')}><Toggle value={settings.terminalCmdHint} onChange={(v) => u('terminalCmdHint', v)} /></Row>
                    <Row label={t('settings_ssh_history')}><Toggle value={settings.sshHistoryCmd} onChange={(v) => u('sshHistoryCmd', v)} /></Row>
                    <Row label={t('settings_ssh_history_storage')}><Sel value={settings.sshHistoryCmdStorage} options={[t('settings_ssh_history_local'), t('settings_ssh_history_cloud')]} onChange={(v) => u('sshHistoryCmdStorage', v)} /></Row>
                    <Row label={t('settings_ssh_history_count')}><NumInput value={settings.sshHistoryCmdLoadCount} onChange={(v) => u('sshHistoryCmdLoadCount', v)} /></Row>
                    <Row label={t('settings_cmd_hint_all_sessions')}><Toggle value={settings.cmdHintAllSessions} onChange={(v) => u('cmdHintAllSessions', v)} /></Row>
                    <Row label={t('settings_cmd_hint_scope_host')}><Toggle value={settings.cmdHintScopeByHost} onChange={(v) => u('cmdHintScopeByHost', v)} /></Row>
                    <Row label={t('settings_cmd_hint_shell_integration')}><Toggle value={settings.cmdHintShellIntegration} onChange={(v) => u('cmdHintShellIntegration', v)} /></Row>
                    <Row label={t('settings_cmd_hint_defer_remote')}><Toggle value={settings.cmdHintDeferToRemote} onChange={(v) => u('cmdHintDeferToRemote', v)} /></Row>
                    <Row label={t('settings_paste_warn_multiline')}><Toggle value={settings.pasteWarnMultiline} onChange={(v) => u('pasteWarnMultiline', v)} /></Row>
                    <Row label={t('settings_terminal_color_scheme')}><Sel value={settings.terminalColorScheme} options={TERMINAL_SCHEME_OPTIONS} onChange={(v) => u('terminalColorScheme', v)} /></Row>
                    <Row label={t('settings_stripe_bg')}><Toggle value={settings.terminalStripeBackground} onChange={(v) => u('terminalStripeBackground', v)} /></Row>
                    <Row label={t('settings_render_mode')} desc={t('settings_render_mode_desc')}><Toggle value={settings.renderMode} onChange={(v) => u('renderMode', v)} /></Row>
                  </div>
                  <div className="settings-col">
                    <Row label={t('settings_terminal_fontsize')}><Sel value={settings.terminalFontSize} options={['10px', '11px', '12px', '13px', '14px', '16px', '18px']} onChange={(v) => u('terminalFontSize', v)} /></Row>
                    <Row label={t('settings_middle_click')}><Sel value={settings.middleClickAction} options={[{ value: 'none', label: t('settings_middle_none') }, { value: 'paste', label: t('settings_middle_paste') }]} onChange={(v) => u('middleClickAction', v)} /></Row>
                    <Row label={t('settings_right_click')}><Sel value={settings.rightClickAction} options={[{ value: 'menu', label: t('settings_right_menu') }, { value: 'paste', label: t('settings_right_paste') }]} onChange={(v) => u('rightClickAction', v)} /></Row>
                    <Row label={t('settings_terminal_sound')}><Toggle value={settings.terminalSound} onChange={(v) => u('terminalSound', v)} /></Row>
                    <Row label={t('settings_ctrl_v_paste')} desc={t('settings_ctrl_v_paste_desc')}><Toggle value={settings.ctrlVPaste} onChange={(v) => u('ctrlVPaste', v)} /></Row>
                    <Row label={t('settings_line_height')}><NumInput value={settings.terminalLineHeight} onChange={(v) => u('terminalLineHeight', v)} prefix={t('settings_line_height_prefix')} /></Row>
                    <Row label={t('settings_letter_spacing')}><NumInput value={settings.terminalLetterSpacing} onChange={(v) => u('terminalLetterSpacing', v)} prefix={t('settings_letter_spacing_prefix')} /></Row>
                    <Row label={t('settings_max_scrollback')}><NumInput value={settings.terminalMaxScrollback} onChange={(v) => u('terminalMaxScrollback', v)} /></Row>
                    <Row label={t('settings_log_dir')}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button className="settings-icon-btn"><FolderOpen size={14} /></button>
                        <input className="settings-input" style={{ width: 140 }} placeholder={t('settings_log_dir_placeholder')} value={settings.logDirectory} onChange={(e) => u('logDirectory', e.target.value)} />
                      </div>
                    </Row>
                  </div>
                </div>
                <SectionTitle>SFTP</SectionTitle>
                <div className="settings-columns">
                  <div className="settings-col">
                    <Row label={t('settings_sftp_editor')}><Sel value={settings.sftpDefaultEditor} options={[t('settings_sftp_editor_builtin'), 'VS Code', 'Sublime Text']} onChange={(v) => u('sftpDefaultEditor', v)} /></Row>
                    <Row label={t('settings_sftp_parent_click')}><Toggle value={settings.sftpParentDirClick} onChange={(v) => u('sftpParentDirClick', v)} /></Row>
                  </div>
                  <div className="settings-col">
                    <Row label={t('settings_sftp_save_path')}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button className="settings-icon-btn"><FolderOpen size={14} /></button>
                        <input className="settings-input" style={{ width: 140 }} placeholder={t('settings_sftp_save_path_placeholder')} value={settings.sftpDefaultSavePath} onChange={(e) => u('sftpDefaultSavePath', e.target.value)} />
                      </div>
                    </Row>
                    <Row label={t('settings_sftp_double_click')}><Sel value={settings.sftpDoubleClickAction} options={[t('settings_sftp_auto'), t('settings_sftp_edit'), t('settings_sftp_download')]} onChange={(v) => u('sftpDoubleClickAction', v)} /></Row>
                  </div>
                </div>
              </>
            )}

            {/* ===== 数据库 ===== */}
            {activeNav === 'database' && (
              <>
                <SectionTitle>{t('settings_db_title')}</SectionTitle>
                <div className="settings-columns">
                  <div className="settings-col">
                    <Row label={t('settings_db_table_font')}><Sel value={settings.dbTableFont} options={fonts} onChange={(v) => u('dbTableFont', v)} /></Row>
                    <Row label={t('settings_db_auto_expand')}><Toggle value={settings.dbAutoExpand} onChange={(v) => u('dbAutoExpand', v)} /></Row>
                    <Row label={t('settings_db_primary_key')}><Toggle value={settings.dbShowPrimaryKey} onChange={(v) => u('dbShowPrimaryKey', v)} /></Row>
                    <Row label={t('settings_db_total_rows')} desc={t('settings_db_total_rows_desc')}><Toggle value={settings.dbCalcTotalRows} onChange={(v) => u('dbCalcTotalRows', v)} /></Row>
                    <Row label={t('settings_db_composite_header')} desc={t('settings_db_composite_header_desc')}><Toggle value={settings.dbCompositeHeader} onChange={(v) => u('dbCompositeHeader', v)} /></Row>
                    <Row label={t('settings_db_load_all')} desc={t('settings_db_load_all_desc')}><Toggle value={settings.dbLoadAllFields} onChange={(v) => u('dbLoadAllFields', v)} /></Row>
                  </div>
                  <div className="settings-col">
                    <Row label={t('settings_db_text_align')}><Sel value={settings.dbTextAlign} options={[t('settings_db_align_auto'), t('settings_db_align_left'), t('settings_db_align_center'), t('settings_db_align_right')]} onChange={(v) => u('dbTextAlign', v)} /></Row>
                    <Row label={t('settings_db_rows_per_page')}><NumInput value={settings.dbRowsPerPage} onChange={(v) => u('dbRowsPerPage', v)} /></Row>
                    <Row label={t('settings_db_danger_confirm')}><Toggle value={settings.dbDangerSqlConfirm} onChange={(v) => u('dbDangerSqlConfirm', v)} /></Row>
                    <Row label={t('settings_db_stop_on_error')}><Toggle value={settings.dbStopOnError} onChange={(v) => u('dbStopOnError', v)} /></Row>
                    <Row label={t('settings_db_scroll_mode')}><Sel value={settings.dbScrollMode} options={[t('settings_db_scroll_natural'), t('settings_db_scroll_classic')]} onChange={(v) => u('dbScrollMode', v)} /></Row>
                    <Row label={t('settings_db_tab_switch_speed')}><NumInput value={settings.dbTabSwitchSpeed} onChange={(v) => u('dbTabSwitchSpeed', v)} /></Row>
                  </div>
                </div>
                <SectionTitle>Redis</SectionTitle>
                <div className="settings-columns">
                  <div className="settings-col">
                    <Row label={t('settings_db_redis_max_load')}><NumInput value={settings.redisMaxLoad} onChange={(v) => u('redisMaxLoad', v)} /></Row>
                    <Row label={t('settings_db_redis_show_value')} desc={t('settings_db_redis_show_value_desc')}><Toggle value={settings.redisShowValue} onChange={(v) => u('redisShowValue', v)} /></Row>
                  </div>
                  <div className="settings-col">
                    <Row label={t('settings_db_redis_separator')}><NumInput value={settings.redisGroupSeparator} onChange={(v) => u('redisGroupSeparator', v)} width={50} /></Row>
                  </div>
                </div>
              </>
            )}

            {/* ===== 快捷键-基础 ===== */}
            {activeNav === 'shortcut-basic' && (
              <>
                <SectionTitle>{t('settings_section_basic')}</SectionTitle>
                <ShortcutTable left={shortcutsBasicLeft} right={shortcutsBasicRight} t={t} />
                <SectionTitle>{t('settings_sc_other')}</SectionTitle>
                <ShortcutTable left={shortcutsOtherLeft} right={shortcutsOtherRight} t={t} />
              </>
            )}

            {/* ===== 快捷键-SSH/SFTP ===== */}
            {activeNav === 'shortcut-ssh' && (
              <>
                <SectionTitle>SSH/SFTP</SectionTitle>
                <ShortcutTable left={shortcutsSshLeft} right={shortcutsSshRight} t={t} />
              </>
            )}

            {/* ===== 快捷键-数据库 ===== */}
            {activeNav === 'shortcut-database' && (
              <>
                <SectionTitle>{t('settings_db_title')}</SectionTitle>
                <ShortcutTable left={shortcutsDbLeft} right={shortcutsDbRight} t={t} />
              </>
            )}

            {/* ===== Docker (快捷键) ===== */}
            {activeNav === 'docker' && (
              <>
                <SectionTitle>Docker</SectionTitle>
                <ShortcutTable left={shortcutsDockerLeft} right={shortcutsDockerRight} t={t} />
              </>
            )}

            {/* ===== 储存仓库 ===== */}
            {activeNav === 'storage' && (
              <>
                <SectionTitle>{t('settings_storage_sync')}</SectionTitle>
                <div className="settings-col" style={{ maxWidth: 700 }}>
                  <div className="storage-row">
                    <span className="settings-label">{t('settings_storage_local_data')}</span>
                    <span className="settings-desc" style={{ flex: 1 }}>{t('settings_storage_local_data_desc')}</span>
                    <button className="settings-btn-danger">{t('settings_storage_clear')}</button>
                  </div>
                  <div className="storage-row">
                    <span className="settings-label">{t('settings_storage_backup')}</span>
                    <span className="settings-desc" style={{ flex: 1 }}>{t('settings_storage_backup_desc')}</span>
                    <button className="settings-btn-outline">{t('settings_storage_restore')}</button>
                  </div>
                  <div className="storage-row">
                    <span className="settings-label">{t('settings_storage_import_export')}</span>
                    <span className="settings-desc" style={{ flex: 1 }}>{t('settings_storage_import_export_desc')}</span>
                    <button className="settings-btn-outline" style={{ marginRight: 6 }}>{t('settings_storage_import')}</button>
                    <button className="settings-btn-outline">{t('settings_storage_export')}</button>
                  </div>
                  <Row label={t('settings_storage_auto_sync')} desc={t('settings_storage_auto_sync_desc')}><Toggle value={settings.storageAutoSync} onChange={(v) => u('storageAutoSync', v)} /></Row>
                  <Row label={t('settings_storage_source')}><Sel value={settings.storageSource} options={[t('settings_storage_source_off'), 'GitHub Gist', 'Gitee Gist', 'WebDAV']} onChange={(v) => u('storageSource', v)} /></Row>
                </div>
              </>
            )}

            {/* ===== 推介有奖 ===== */}
            {activeNav === 'referral' && (
              <div className="settings-placeholder">
                <div style={{ textAlign: 'center' }}>
                  <h3 style={{ marginBottom: 8 }}>{t('settings_referral_title')}</h3>
                  <p>{t('settings_referral_desc')}</p>
                  <p className="settings-desc" style={{ marginTop: 12 }}>{t('settings_referral_dev')}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="settings-footer">
          {activeNav === 'storage' ? (
            <span className="settings-footer-hint">{t('settings_footer_storage')}</span>
          ) : (
            <span className="settings-footer-hint">{t('settings_footer_default')}</span>
          )}
          <div className="settings-footer-actions">
            <button className="settings-btn-outline" onClick={handleReset}>{t('settings_reset')}</button>
            <button className={`settings-btn-primary ${!dirty ? 'disabled' : ''}`} onClick={handleApply} disabled={!dirty}>
              {t('settings_apply')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
