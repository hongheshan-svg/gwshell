import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { X } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useSettingsStore, defaultSettings as persistedDefaultSettings } from '../../stores/settingsStore';
import type { TranslationKeys } from '../../i18n';
import { TERMINAL_SCHEME_OPTIONS } from '../../lib/terminalThemes';
import { useEscapeClose } from '../../lib/useEscapeClose';
import { ShortcutEditor } from './ShortcutEditor';

/* ---- Nav categories ---- */
const navCategories: { title?: TranslationKeys; items: { id: string; labelKey: TranslationKeys }[] }[] = [
  {
    title: 'settings_cat_general',
    items: [
      { id: 'basic', labelKey: 'settings_basic' },
      { id: 'ssh-sftp', labelKey: 'settings_ssh_sftp' },
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
  { items: [{ id: 'vault', labelKey: 'vault_section' }] },
  { items: [{ id: 'storage', labelKey: 'settings_storage' }] },
  { items: [{ id: 'referral', labelKey: 'settings_referral' }] },
];

/* ---- Settings state ---- */
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
  // SSH/SFTP
  terminalFont: string;
  terminalFontSize: string;
  autoCopyOnSelect: boolean;
  terminalCmdHint: boolean;
  sshHistoryCmd: boolean;
  sshHistoryCmdLoadCount: string;
  pasteWarnMultiline: boolean;
  terminalColorScheme: string;
  cmdHintAllSessions: boolean;
  cmdHintShellIntegration: boolean;
  cmdHintDeferToRemote: boolean;
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
  // Quake dropdown console
  quakeEnabled: boolean;
  quakeHotkey: string;
  homeView: 'card' | 'table';
}

const CMD_TERMINAL_FONT = 'Consolas, "Cascadia Mono", "Courier New", monospace';

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

/* ---- Vault section (master-passphrase app lock) ---- */
// Self-contained: talks to the vault_* IPC directly and is not part of the
// AppSettings blob (enabled state lives only in the backend verifier).
const VaultSection: React.FC<{ open: boolean }> = ({ open }) => {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  // Enable
  const [newPass, setNewPass] = useState('');
  const [newPass2, setNewPass2] = useState('');
  // Change
  const [curPass, setCurPass] = useState('');
  const [chgNew, setChgNew] = useState('');
  const [chgNew2, setChgNew2] = useState('');
  // Disable
  const [disPass, setDisPass] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const refresh = useCallback(() => {
    invoke<boolean>('vault_is_enabled').then(setEnabled).catch(() => {});
  }, []);

  useEffect(() => {
    if (open) {
      refresh();
      setMsg(null);
      setNewPass(''); setNewPass2(''); setCurPass(''); setChgNew(''); setChgNew2(''); setDisPass('');
    }
  }, [open, refresh]);

  const inputStyle: React.CSSProperties = { width: 200 };

  const handleEnable = async () => {
    setMsg(null);
    if (!newPass) { setMsg({ kind: 'err', text: t('vault_err_empty') }); return; }
    if (newPass !== newPass2) { setMsg({ kind: 'err', text: t('vault_err_mismatch') }); return; }
    try {
      await invoke('vault_set_passphrase', { passphrase: newPass });
      setNewPass(''); setNewPass2('');
      setMsg({ kind: 'ok', text: t('vault_enabled_ok') });
      refresh();
    } catch {
      setMsg({ kind: 'err', text: t('vault_err_generic') });
    }
  };

  const handleChange = async () => {
    setMsg(null);
    if (!chgNew) { setMsg({ kind: 'err', text: t('vault_err_empty') }); return; }
    if (chgNew !== chgNew2) { setMsg({ kind: 'err', text: t('vault_err_mismatch') }); return; }
    try {
      // Single atomic call: verify current + set new in one round-trip (eliminates TOCTOU).
      const ok = await invoke<boolean>('vault_change_passphrase', { currentPassphrase: curPass, newPassphrase: chgNew });
      if (!ok) { setMsg({ kind: 'err', text: t('vault_err_wrong_current') }); return; }
      setCurPass(''); setChgNew(''); setChgNew2('');
      setMsg({ kind: 'ok', text: t('vault_changed_ok') });
      refresh();
    } catch {
      setMsg({ kind: 'err', text: t('vault_err_generic') });
    }
  };

  const handleDisable = async () => {
    setMsg(null);
    try {
      const cleared = await invoke<boolean>('vault_clear', { currentPassphrase: disPass });
      if (!cleared) { setMsg({ kind: 'err', text: t('vault_err_wrong_current') }); return; }
      setDisPass('');
      setMsg({ kind: 'ok', text: t('vault_disabled_ok') });
      refresh();
    } catch {
      setMsg({ kind: 'err', text: t('vault_err_generic') });
    }
  };

  return (
    <>
      <SectionTitle>{t('vault_section')}</SectionTitle>
      <div className="settings-col" style={{ maxWidth: 560 }}>
        <p className="settings-desc" style={{ marginBottom: 8 }}>{t('vault_intro')}</p>
        <Row label={t('vault_status')}>
          <span className="settings-label">{enabled ? t('vault_status_on') : t('vault_status_off')}</span>
        </Row>

        {!enabled ? (
          <>
            <Row label={t('vault_new_passphrase')}>
              <input type="password" className="settings-input" style={inputStyle} value={newPass} onChange={(e) => setNewPass(e.target.value)} autoComplete="new-password" />
            </Row>
            <Row label={t('vault_confirm_passphrase')}>
              <input type="password" className="settings-input" style={inputStyle} value={newPass2} onChange={(e) => setNewPass2(e.target.value)} autoComplete="new-password" />
            </Row>
            <Row label="">
              <button className="settings-btn-primary" onClick={handleEnable}>{t('vault_enable_btn')}</button>
            </Row>
          </>
        ) : (
          <>
            <SectionTitle>{t('vault_change_title')}</SectionTitle>
            <Row label={t('vault_current_passphrase')}>
              <input type="password" className="settings-input" style={inputStyle} value={curPass} onChange={(e) => setCurPass(e.target.value)} autoComplete="current-password" />
            </Row>
            <Row label={t('vault_new_passphrase')}>
              <input type="password" className="settings-input" style={inputStyle} value={chgNew} onChange={(e) => setChgNew(e.target.value)} autoComplete="new-password" />
            </Row>
            <Row label={t('vault_confirm_passphrase')}>
              <input type="password" className="settings-input" style={inputStyle} value={chgNew2} onChange={(e) => setChgNew2(e.target.value)} autoComplete="new-password" />
            </Row>
            <Row label="">
              <button className="settings-btn-primary" onClick={handleChange}>{t('vault_change_btn')}</button>
            </Row>

            <SectionTitle>{t('vault_disable_title')}</SectionTitle>
            <p className="settings-desc" style={{ marginBottom: 8 }}>{t('vault_disable_desc')}</p>
            <Row label={t('vault_current_passphrase')}>
              <input type="password" className="settings-input" style={inputStyle} value={disPass} onChange={(e) => setDisPass(e.target.value)} autoComplete="current-password" />
            </Row>
            <Row label="">
              <button className="settings-btn-danger" onClick={handleDisable}>{t('vault_disable_btn')}</button>
            </Row>
          </>
        )}

        {msg && (
          <p className="settings-desc" style={{ marginTop: 8, color: msg.kind === 'err' ? 'var(--danger)' : 'var(--success)' }}>
            {msg.text}
          </p>
        )}
      </div>
    </>
  );
};

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
  useEscapeClose(handleClose);
  const fonts = ['system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans SC", sans-serif', 'Inter, system-ui, sans-serif', CMD_TERMINAL_FONT, 'Consolas', 'Cascadia Mono', 'Cascadia Code', 'JetBrains Mono, "Noto Sans SC", monospace', 'Fira Code', 'monospace'];

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
                  <Row label={t('settings_animation')}><Toggle value={settings.enableAnimation} onChange={(v) => u('enableAnimation', v)} /></Row>
                  <Row label={t('settings_mouse_zoom')}><Toggle value={settings.mouseWheelZoom} onChange={(v) => u('mouseWheelZoom', v)} /></Row>
                  <Row label={t('settings_tab_close_confirm')} desc={t('settings_tab_close_confirm_desc')}><Toggle value={settings.tabCloseConfirm} onChange={(v) => u('tabCloseConfirm', v)} /></Row>
                  <Row label={t('settings_tab_flash')} desc={t('settings_tab_flash_desc')}><Toggle value={settings.tabFlashAlert} onChange={(v) => u('tabFlashAlert', v)} /></Row>
                </div>
                <div className="settings-col">
                  <SectionTitle>&nbsp;</SectionTitle>
                  <Row label={t('settings_language')}><Sel value={settings.language} options={['简体中文', 'English', '繁體中文', '日本語']} onChange={(v) => u('language', v)} /></Row>
                  <Row label={t('settings_zoom')}><Sel value={settings.zoomLevel} options={['80%', '90%', '100%', '110%', '120%', '150%']} onChange={(v) => u('zoomLevel', v)} /></Row>
                  <Row label={t('settings_session_tab_memory')} desc={t('settings_session_tab_memory_desc')}><Toggle value={settings.sessionTabMemory} onChange={(v) => u('sessionTabMemory', v)} /></Row>
                  <Row label={t('settings_quake_enabled')} desc={t('settings_quake_hint')}><Toggle value={settings.quakeEnabled} onChange={(v) => u('quakeEnabled', v)} /></Row>
                  <Row label={t('settings_quake_hotkey')}><input type="text" className="settings-input" value={settings.quakeHotkey} onChange={(e) => u('quakeHotkey', e.target.value)} disabled={!settings.quakeEnabled} /></Row>
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
                    <Row label={t('settings_auto_copy')}><Toggle value={settings.autoCopyOnSelect} onChange={(v) => u('autoCopyOnSelect', v)} /></Row>
                    <Row label={t('settings_cmd_hint')}><Toggle value={settings.terminalCmdHint} onChange={(v) => u('terminalCmdHint', v)} /></Row>
                    <Row label={t('settings_ssh_history')}><Toggle value={settings.sshHistoryCmd} onChange={(v) => u('sshHistoryCmd', v)} /></Row>
                    <Row label={t('settings_ssh_history_count')}><NumInput value={settings.sshHistoryCmdLoadCount} onChange={(v) => u('sshHistoryCmdLoadCount', v)} /></Row>
                    <Row label={t('settings_cmd_hint_all_sessions')}><Toggle value={settings.cmdHintAllSessions} onChange={(v) => u('cmdHintAllSessions', v)} /></Row>
                    <Row label={t('settings_cmd_hint_scope_host')}><Toggle value={settings.cmdHintScopeByHost} onChange={(v) => u('cmdHintScopeByHost', v)} /></Row>
                    <Row label={t('settings_cmd_hint_shell_integration')}><Toggle value={settings.cmdHintShellIntegration} onChange={(v) => u('cmdHintShellIntegration', v)} /></Row>
                    <Row label={t('settings_cmd_hint_defer_remote')}><Toggle value={settings.cmdHintDeferToRemote} onChange={(v) => u('cmdHintDeferToRemote', v)} /></Row>
                    <Row label={t('settings_paste_warn_multiline')}><Toggle value={settings.pasteWarnMultiline} onChange={(v) => u('pasteWarnMultiline', v)} /></Row>
                    <Row label={t('settings_terminal_color_scheme')}><Sel value={settings.terminalColorScheme} options={TERMINAL_SCHEME_OPTIONS} onChange={(v) => u('terminalColorScheme', v)} /></Row>
                    <Row label={t('settings_stripe_bg')}><Toggle value={settings.terminalStripeBackground} onChange={(v) => u('terminalStripeBackground', v)} /></Row>
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
                  </div>
                </div>
              </>
            )}

            {/* ===== 快捷键-基础 ===== */}
            {activeNav === 'shortcut-basic' && (
              <>
                <SectionTitle>{t('settings_shortcut_editable')}</SectionTitle>
                <ShortcutEditor value={settings.keymapOverrides} onChange={(ko) => u('keymapOverrides', ko)} />
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

            {/* ===== 保险库 / Vault ===== */}
            {activeNav === 'vault' && <VaultSection open={showSettings && activeNav === 'vault'} />}

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
