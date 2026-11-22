import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X,
  SlidersHorizontal,
  Terminal,
  Keyboard,
  Sparkles,
  ShieldCheck,
  Database,
  type LucideIcon,
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import {
  useSettingsStore,
  defaultSettings as persistedDefaultSettings,
  type AppSettings,
} from '../../stores/settingsStore';
import type { TranslationKeys } from '../../i18n';
import { TERMINAL_SCHEME_OPTIONS } from '../../lib/terminalThemes';
import { useEscapeClose } from '../../lib/useEscapeClose';
import { AiSettingsSection } from './AiSettingsSection';
import { ShortcutEditor } from './ShortcutEditor';
import { VaultSection } from './VaultSection';
import { HotkeyRecorder } from './HotkeyRecorder';
import { StorageSection } from './StorageSection';
import {
  NumInput,
  Row,
  SectionTitle,
  Sel,
  ShortcutTable,
  Toggle,
  type SelectOption,
  type ShortcutItem,
} from './SettingsControls';

export type { AppSettings };

const CMD_TERMINAL_FONT = 'Consolas, "Cascadia Mono", "Courier New", monospace';

const FONT_OPTIONS: SelectOption[] = [
  {
    value: 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans SC", sans-serif',
    label: 'System UI',
  },
  { value: 'Inter, system-ui, sans-serif', label: 'Inter' },
  { value: CMD_TERMINAL_FONT, label: 'Consolas / Cascadia Mono' },
  { value: 'Consolas', label: 'Consolas' },
  { value: 'Cascadia Mono', label: 'Cascadia Mono' },
  { value: 'Cascadia Code', label: 'Cascadia Code' },
  { value: 'JetBrains Mono, "Noto Sans SC", monospace', label: 'JetBrains Mono' },
  { value: 'Fira Code', label: 'Fira Code' },
  { value: 'monospace', label: 'Monospace' },
];

const navCategories: {
  title?: TranslationKeys;
  items: { id: string; labelKey: TranslationKeys; icon: LucideIcon }[];
}[] = [
  {
    title: 'settings_cat_general',
    items: [
      { id: 'basic', labelKey: 'settings_basic', icon: SlidersHorizontal },
      { id: 'ssh-sftp', labelKey: 'settings_ssh_sftp', icon: Terminal },
    ],
  },
  {
    title: 'settings_cat_shortcuts',
    items: [{ id: 'shortcut-basic', labelKey: 'settings_shortcut_basic', icon: Keyboard }],
  },
  { items: [{ id: 'agent-ai', labelKey: 'agent_ai_title', icon: Sparkles }] },
  { items: [{ id: 'vault', labelKey: 'vault_section', icon: ShieldCheck }] },
  { items: [{ id: 'storage', labelKey: 'settings_storage', icon: Database }] },
];

const shortcutsBuiltinLeft: ShortcutItem[] = [
  { labelKey: 'settings_sc_term_copy', keys: 'Ctrl Shift C' },
  { labelKey: 'settings_sc_term_paste', keys: 'Ctrl Shift V' },
];
const shortcutsBuiltinRight: ShortcutItem[] = [
  { labelKey: 'settings_sc_save', keys: 'Ctrl S' },
  { labelKey: 'settings_sc_selectall', keys: 'Ctrl A' },
];

const FONT_SIZE_PRESETS = [
  '8px',
  '9px',
  '10px',
  '11px',
  '12px',
  '13px',
  '14px',
  '15px',
  '16px',
  '18px',
  '20px',
  '22px',
  '24px',
  '28px',
  '32px',
];

export const SettingsModal: React.FC = () => {
  const showSettings = useAppStore((s) => s.showSettings);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const settingsInitialNav = useAppStore((s) => s.settingsInitialNav);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const persistedSettings = useSettingsStore((s) => s.settings);
  const saveSettings = useSettingsStore((s) => s.save);
  const { t } = useTranslation();
  const [activeNav, setActiveNav] = useState('basic');
  const [settings, setSettings] = useState<AppSettings>({ ...persistedDefaultSettings, theme });
  const [dirty, setDirty] = useState(false);
  const prevOpenRef = useRef(false);

  useEffect(() => {
    const justOpened = showSettings && !prevOpenRef.current;
    prevOpenRef.current = showSettings;
    if (justOpened) {
      setSettings({ ...persistedSettings, theme });
      if (settingsInitialNav) setActiveNav(settingsInitialNav);
      setDirty(false);
    }
  }, [showSettings, persistedSettings, settingsInitialNav, theme]);

  const u = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }, []);

  const handleApply = async () => {
    await saveSettings(settings);
    setTheme(settings.theme);
    setDirty(false);
  };

  const handleReset = () => {
    setSettings({ ...persistedDefaultSettings, theme });
    setDirty(true);
  };

  const handleClose = () => setShowSettings(false);
  useEscapeClose(handleClose);

  if (!showSettings) return null;

  const fontSizeOptions = FONT_SIZE_PRESETS.includes(settings.terminalFontSize)
    ? FONT_SIZE_PRESETS
    : [...FONT_SIZE_PRESETS, settings.terminalFontSize].sort(
        (a, b) => (parseInt(a) || 0) - (parseInt(b) || 0),
      );

  return (
    <div className="settings-overlay">
      <div
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t('settings_title')}
      >
        <div className="settings-header">
          <div className="settings-header-left">
            <span className="settings-brand">GWShell</span>
          </div>
          <h2>{t('settings_title')}</h2>
          <button
            type="button"
            className="modal-close"
            onClick={handleClose}
            aria-label={t('common.dismiss')}
          >
            <X size={16} />
          </button>
        </div>

        <div className="settings-body">
          <div className="settings-nav">
            {navCategories.map((cat, i) => (
              <div key={i} className="settings-nav-group">
                {cat.title && <div className="settings-nav-title">{t(cat.title)}</div>}
                {cat.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`settings-nav-item ${activeNav === item.id ? 'active' : ''}`}
                      onClick={() => setActiveNav(item.id)}
                    >
                      <Icon size={14} className="settings-nav-icon" />
                      <span>{t(item.labelKey)}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="settings-content">
            {activeNav === 'basic' && (
              <div className="settings-stack">
                <SectionTitle>{t('settings_section_basic')}</SectionTitle>
                <div className="settings-card">
                  <Row label={t('settings_theme')}>
                    <Sel
                      value={settings.theme}
                      options={[
                        { value: 'dark', label: t('settings_theme_dark') },
                        { value: 'light', label: t('settings_theme_light') },
                      ]}
                      onChange={(v) => u('theme', v as 'dark' | 'light')} // eslint-disable-line no-restricted-syntax -- select value union; runtime-validated by onChange
                    />
                  </Row>
                  <Row label={t('settings_language')}>
                    <Sel
                      value={settings.language}
                      options={[
                        { value: 'zh', label: '简体中文' },
                        { value: 'en', label: 'English' },
                      ]}
                      onChange={(v) => u('language', v)}
                    />
                  </Row>
                  <Row label={t('settings_ui_font')}>
                    <Sel
                      value={settings.uiFont}
                      options={FONT_OPTIONS}
                      onChange={(v) => u('uiFont', v)}
                    />
                  </Row>
                  <Row label={t('settings_zoom')}>
                    <Sel
                      value={settings.zoomLevel}
                      options={['80%', '90%', '100%', '110%', '120%', '150%']}
                      onChange={(v) => u('zoomLevel', v)}
                    />
                  </Row>
                  <Row label={t('settings_animation')}>
                    <Toggle
                      value={settings.enableAnimation}
                      onChange={(v) => u('enableAnimation', v)}
                    />
                  </Row>
                </div>

                <div className="settings-card">
                  <Row label={t('settings_middle_close')}>
                    <Toggle
                      value={settings.middleClickCloseTab}
                      onChange={(v) => u('middleClickCloseTab', v)}
                    />
                  </Row>
                  <Row label={t('settings_mouse_zoom')}>
                    <Toggle
                      value={settings.mouseWheelZoom}
                      onChange={(v) => u('mouseWheelZoom', v)}
                    />
                  </Row>
                  <Row
                    label={t('settings_tab_close_confirm')}
                    desc={t('settings_tab_close_confirm_desc')}
                  >
                    <Toggle
                      value={settings.tabCloseConfirm}
                      onChange={(v) => u('tabCloseConfirm', v)}
                    />
                  </Row>
                  <Row
                    label={t('settings_session_tab_memory')}
                    desc={t('settings_session_tab_memory_desc')}
                  >
                    <Toggle
                      value={settings.sessionTabMemory}
                      onChange={(v) => u('sessionTabMemory', v)}
                    />
                  </Row>
                  <Row label={t('settings_quake_enabled')} desc={t('settings_quake_hint')}>
                    <Toggle value={settings.quakeEnabled} onChange={(v) => u('quakeEnabled', v)} />
                  </Row>
                  <Row label={t('settings_quake_hotkey')}>
                    <HotkeyRecorder
                      value={settings.quakeHotkey}
                      disabled={!settings.quakeEnabled}
                      onChange={(v) => u('quakeHotkey', v)}
                    />
                  </Row>
                </div>
              </div>
            )}

            {activeNav === 'ssh-sftp' && (
              <div className="settings-stack">
                <SectionTitle>SSH &amp; Terminal</SectionTitle>
                <div className="settings-card">
                  <Row label={t('settings_terminal_font')} desc={t('settings_terminal_font_desc')}>
                    <Sel
                      value={settings.terminalFont}
                      options={FONT_OPTIONS}
                      onChange={(v) => u('terminalFont', v)}
                    />
                  </Row>
                  <Row label={t('settings_terminal_fontsize')}>
                    <Sel
                      value={settings.terminalFontSize}
                      options={fontSizeOptions}
                      onChange={(v) => u('terminalFontSize', v)}
                    />
                  </Row>
                  <Row label={t('settings_terminal_color_scheme')}>
                    <Sel
                      value={settings.terminalColorScheme}
                      options={TERMINAL_SCHEME_OPTIONS}
                      onChange={(v) => u('terminalColorScheme', v)}
                    />
                  </Row>
                  <Row label={t('settings_line_height')}>
                    <NumInput
                      value={settings.terminalLineHeight}
                      onChange={(v) => u('terminalLineHeight', v)}
                      prefix={t('settings_line_height_prefix')}
                    />
                  </Row>
                  <Row label={t('settings_letter_spacing')}>
                    <NumInput
                      value={settings.terminalLetterSpacing}
                      onChange={(v) => u('terminalLetterSpacing', v)}
                      prefix={t('settings_letter_spacing_prefix')}
                    />
                  </Row>
                  <Row label={t('settings_max_scrollback')}>
                    <NumInput
                      value={settings.terminalMaxScrollback}
                      onChange={(v) => u('terminalMaxScrollback', v)}
                    />
                  </Row>
                </div>

                <div className="settings-card">
                  <Row label={t('settings_auto_copy')}>
                    <Toggle
                      value={settings.autoCopyOnSelect}
                      onChange={(v) => u('autoCopyOnSelect', v)}
                    />
                  </Row>
                  <Row label={t('settings_middle_click')}>
                    <Sel
                      value={settings.middleClickAction}
                      options={[
                        { value: 'none', label: t('settings_middle_none') },
                        { value: 'paste', label: t('settings_middle_paste') },
                      ]}
                      onChange={(v) => u('middleClickAction', v)}
                    />
                  </Row>
                  <Row label={t('settings_right_click')}>
                    <Sel
                      value={settings.rightClickAction}
                      options={[
                        { value: 'menu', label: t('settings_right_menu') },
                        { value: 'paste', label: t('settings_right_paste') },
                      ]}
                      onChange={(v) => u('rightClickAction', v)}
                    />
                  </Row>
                  <Row label={t('settings_ctrl_v_paste')} desc={t('settings_ctrl_v_paste_desc')}>
                    <Toggle value={settings.ctrlVPaste} onChange={(v) => u('ctrlVPaste', v)} />
                  </Row>
                  <Row label={t('settings_paste_warn_multiline')}>
                    <Toggle
                      value={settings.pasteWarnMultiline}
                      onChange={(v) => u('pasteWarnMultiline', v)}
                    />
                  </Row>
                  <Row label={t('settings_terminal_sound')}>
                    <Toggle
                      value={settings.terminalSound}
                      onChange={(v) => u('terminalSound', v)}
                    />
                  </Row>
                  <Row label={t('settings_sticky_scroll')} desc={t('settings_sticky_scroll_hint')}>
                    <Toggle
                      value={settings.terminalStickyScroll}
                      onChange={(v) => u('terminalStickyScroll', v)}
                    />
                  </Row>
                  <Row label={t('settings_session_log')} desc={t('settings_session_log_hint')}>
                    <Toggle
                      value={settings.sessionLogEnabled}
                      onChange={(v) => u('sessionLogEnabled', v)}
                    />
                  </Row>
                </div>

                <div className="settings-card">
                  <Row label={t('settings_cmd_hint')}>
                    <Toggle
                      value={settings.terminalCmdHint}
                      onChange={(v) => u('terminalCmdHint', v)}
                    />
                  </Row>
                  <Row label={t('settings_ssh_history')}>
                    <Toggle
                      value={settings.sshHistoryCmd}
                      onChange={(v) => u('sshHistoryCmd', v)}
                    />
                  </Row>
                  <Row label={t('settings_ssh_history_count')}>
                    <NumInput
                      value={settings.sshHistoryCmdLoadCount}
                      onChange={(v) => u('sshHistoryCmdLoadCount', v)}
                    />
                  </Row>
                  <Row label={t('settings_cmd_hint_all_sessions')}>
                    <Toggle
                      value={settings.cmdHintAllSessions}
                      onChange={(v) => u('cmdHintAllSessions', v)}
                    />
                  </Row>
                  <Row label={t('settings_cmd_hint_scope_host')}>
                    <Toggle
                      value={settings.cmdHintScopeByHost}
                      onChange={(v) => u('cmdHintScopeByHost', v)}
                    />
                  </Row>
                </div>
              </div>
            )}

            {activeNav === 'shortcut-basic' && (
              <>
                <SectionTitle>{t('settings_shortcut_editable')}</SectionTitle>
                <ShortcutEditor
                  value={settings.keymapOverrides}
                  onChange={(ko) => u('keymapOverrides', ko)}
                />
                <SectionTitle>{t('settings_section_basic')}</SectionTitle>
                <ShortcutTable left={shortcutsBuiltinLeft} right={shortcutsBuiltinRight} t={t} />
              </>
            )}

            {activeNav === 'agent-ai' && <AiSettingsSection />}
            {activeNav === 'vault' && <VaultSection open={showSettings && activeNav === 'vault'} />}
            {activeNav === 'storage' && <StorageSection />}
          </div>
        </div>

        <div className="settings-footer">
          <span className="settings-footer-hint">{t('settings_footer_default')}</span>
          <div className="settings-footer-actions">
            <button type="button" className="settings-btn-outline" onClick={handleReset}>
              {t('settings_reset')}
            </button>
            <button
              type="button"
              className={`settings-btn-primary ${!dirty ? 'disabled' : ''}`}
              onClick={() => {
                void handleApply();
              }}
              disabled={!dirty}
            >
              {t('settings_apply')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
