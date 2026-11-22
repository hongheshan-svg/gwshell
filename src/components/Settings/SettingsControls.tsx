import React from 'react';
import type { TranslationKeys } from '../../i18n';

export type SelectOption = string | { value: string; label: string };
const optionValue = (option: SelectOption) => (typeof option === 'string' ? option : option.value);
const optionLabel = (option: SelectOption) => (typeof option === 'string' ? option : option.label);

export interface ShortcutItem {
  labelKey: TranslationKeys;
  keys: string;
}

export const Toggle: React.FC<{ value: boolean; onChange: (v: boolean) => void }> = ({
  value,
  onChange,
}) => (
  <button
    className={`settings-toggle ${value ? 'on' : ''}`}
    onClick={() => onChange(!value)}
    type="button"
  >
    <span className="settings-toggle-knob" />
  </button>
);

export const Sel: React.FC<{
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
}> = ({ value, options, onChange }) => (
  <select className="settings-select" value={value} onChange={(e) => onChange(e.target.value)}>
    {options.map((o) => (
      <option key={optionValue(o)} value={optionValue(o)}>
        {optionLabel(o)}
      </option>
    ))}
  </select>
);

export const NumInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  prefix?: string;
  width?: number;
}> = ({ value, onChange, prefix, width }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
    {prefix && <span className="settings-desc">{prefix}</span>}
    <input
      className="settings-input"
      style={{ width: width ?? 70 }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  </div>
);

export const Row: React.FC<{ label: string; desc?: string; children: React.ReactNode }> = ({
  label,
  desc,
  children,
}) => (
  <div className="settings-row">
    <div className="settings-row-left">
      <span className="settings-label">{label}</span>
      {desc && <span className="settings-desc">{desc}</span>}
    </div>
    <div className="settings-row-right">{children}</div>
  </div>
);

export const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="settings-section-title">{children}</div>
);

export const ShortcutTable: React.FC<{
  left: ShortcutItem[];
  right: ShortcutItem[];
  t: (k: TranslationKeys) => string;
}> = ({ left, right, t }) => (
  <div className="settings-columns">
    <div className="settings-col">
      {left.map((s) => (
        <div key={s.labelKey} className="shortcut-row">
          <span className="shortcut-label">{t(s.labelKey)}</span>
          <span className="shortcut-keys">
            {s.keys.split(' ').map((k, i) => (
              <kbd key={i}>{k}</kbd>
            ))}
          </span>
        </div>
      ))}
    </div>
    <div className="settings-col">
      {right.map((s) => (
        <div key={s.labelKey} className="shortcut-row">
          <span className="shortcut-label">{t(s.labelKey)}</span>
          <span className="shortcut-keys">
            {s.keys.split(' ').map((k, i) => (
              <kbd key={i}>{k}</kbd>
            ))}
          </span>
        </div>
      ))}
    </div>
  </div>
);
