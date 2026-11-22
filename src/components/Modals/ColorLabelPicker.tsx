import React from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

const SESSION_COLOR_LABELS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#10b981',
  '#06b6d4',
  '#3b82f6',
  '#6366f1',
  '#a855f7',
  '#9ca3af',
  '#374151',
];

interface ColorLabelPickerProps {
  value: string;
  onChange: (color: string) => void;
}

export const ColorLabelPicker: React.FC<ColorLabelPickerProps> = ({ value, onChange }) => {
  const { t } = useTranslation();
  return (
    <div className="ssh-form-group">
      <label>{t('ssh_color_label')}</label>
      <div className="color-label-row">
        {SESSION_COLOR_LABELS.map((color) => (
          <button
            key={color}
            type="button"
            className={`color-dot ${value === color ? 'selected' : ''}`}
            style={{ background: color }}
            aria-label={color}
            aria-pressed={value === color}
            onClick={() => onChange(color)}
          />
        ))}
        <button type="button" className="color-dot-clear" onClick={() => onChange('')}>
          <X size={11} />
        </button>
      </div>
    </div>
  );
};
