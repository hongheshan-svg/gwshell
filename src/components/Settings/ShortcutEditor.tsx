import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settingsStore';
import { KEY_ACTIONS } from '../../keymap/actions';
import { eventToStep, stepToBinding, parseBinding } from '../../keymap/match';

export const ShortcutEditor: React.FC = () => {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const save = useSettingsStore((s) => s.save);
  const [capturing, setCapturing] = useState<string | null>(null);
  const [error, setError] = useState('');

  const overrides = settings.keymapOverrides || {};
  const currentBinding = (id: string): string | null => {
    const ov = overrides[id];
    if (ov !== undefined) return ov; // string or null
    return KEY_ACTIONS.find((a) => a.id === id)?.defaultBinding ?? null;
  };

  const setOverride = (id: string, value: string | null) => {
    void save({ ...settings, keymapOverrides: { ...overrides, [id]: value } });
  };
  const resetOverride = (id: string) => {
    const next = { ...overrides };
    delete next[id];
    void save({ ...settings, keymapOverrides: next });
  };

  const onCaptureKey = (id: string, e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { setCapturing(null); setError(''); return; }
    const step = eventToStep(e.nativeEvent);
    if (!step) return; // pure modifier — keep waiting
    const binding = stepToBinding(step);
    if (!parseBinding(binding)) { setError(t('shortcut_conflict')); return; }
    // conflict check within the rebindable set
    const clash = KEY_ACTIONS.find((a) => a.id !== id && currentBinding(a.id) === binding);
    if (clash) { setError(t('shortcut_conflict')); return; }
    setOverride(id, binding);
    setCapturing(null);
    setError('');
  };

  return (
    <div className="shortcut-editor">
      {KEY_ACTIONS.map((a) => {
        const b = currentBinding(a.id);
        return (
          <div className="shortcut-row" key={a.id}>
            <span className="shortcut-row-label">{t(a.labelKey)}</span>
            <div className="shortcut-row-keys">
              {capturing === a.id ? (
                <input
                  className="shortcut-capture"
                  autoFocus
                  readOnly
                  value={t('shortcut_press_key')}
                  onKeyDown={(e) => onCaptureKey(a.id, e)}
                  onBlur={() => { setCapturing(null); setError(''); }}
                />
              ) : (
                <button className="shortcut-chip" onClick={() => { setCapturing(a.id); setError(''); }}>
                  {b ? b.split(' ').map((s, i) => <kbd key={i}>{s}</kbd>) : <span className="shortcut-unbound">—</span>}
                </button>
              )}
              <button className="shortcut-mini" onClick={() => setOverride(a.id, null)} title={t('shortcut_unbind')}>⊘</button>
              <button className="shortcut-mini" onClick={() => resetOverride(a.id)} title={t('shortcut_reset')}>↺</button>
            </div>
          </div>
        );
      })}
      {error && <div className="shortcut-error">{error}</div>}
    </div>
  );
};
