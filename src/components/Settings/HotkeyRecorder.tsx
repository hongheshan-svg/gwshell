import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

const ACCEL_DISPLAY: Record<string, string> = {
  CommandOrControl: 'Ctrl',
  Backquote: '`',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  Minus: '-',
  Equal: '=',
  Space: 'Space',
};

const ACCEL_FROM_CODE: Record<string, string> = {
  Backquote: 'Backquote',
  Backslash: 'Backslash',
  BracketLeft: 'BracketLeft',
  BracketRight: 'BracketRight',
  Comma: 'Comma',
  Period: 'Period',
  Slash: 'Slash',
  Semicolon: 'Semicolon',
  Quote: 'Quote',
  Minus: 'Minus',
  Equal: 'Equal',
  Space: 'Space',
};

function displayAccel(accel: string): string {
  return accel
    .split('+')
    .map((p) => ACCEL_DISPLAY[p] ?? p)
    .join('+');
}

export const HotkeyRecorder: React.FC<{
  value: string;
  disabled?: boolean;
  onChange: (accel: string) => void;
}> = ({ value, disabled, onChange }) => {
  const { t } = useTranslation();
  const [recording, setRecording] = useState(false);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      setRecording(false);
      return;
    }
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
    const parts: string[] = [];
    if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');
    if (parts.length === 0) return;
    const code = e.code;
    let key: string | null = null;
    if (code.startsWith('Key')) key = code.slice(3);
    else if (code.startsWith('Digit')) key = code.slice(5);
    else if (/^F\d{1,2}$/.test(code)) key = code;
    else key = ACCEL_FROM_CODE[code] ?? null;
    if (!key) return;
    onChange([...parts, key].join('+'));
    setRecording(false);
  };

  return (
    <button
      type="button"
      data-shortcut-capture="true"
      className={`settings-input hotkey-recorder${recording ? ' recording' : ''}`}
      disabled={disabled}
      onClick={() => setRecording(true)}
      onKeyDown={handleKeyDown}
      onBlur={() => setRecording(false)}
    >
      {recording ? t('settings_hotkey_recording') : displayAccel(value)}
    </button>
  );
};
