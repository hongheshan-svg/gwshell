// src/components/Terminal/TerminalContextMenu.tsx
// Context menu overlay for the terminal (copy/paste/select all/clear).
// Extracted from TerminalView.tsx - pure JSX move, no logic changes.

import { useTranslation } from 'react-i18next';
import type { TerminalContextMenuState } from './types';

interface TerminalContextMenuProps {
  state: TerminalContextMenuState;
  onCopy: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
  onClear: () => void;
}

export function TerminalContextMenu({
  state,
  onCopy,
  onPaste,
  onSelectAll,
  onClear,
}: TerminalContextMenuProps) {
  const { t } = useTranslation();
  return (
    <div
      className="context-menu terminal-context-menu"
      style={{ left: state.x, top: state.y }}
    >
      <button
        type="button"
        className="context-menu-item"
        disabled={!state.canCopy}
        onClick={onCopy}
      >
        {t('settings_sc_copy')}
      </button>
      <button type="button" className="context-menu-item" onClick={onPaste}>
        {t('settings_sc_paste')}
      </button>
      <div className="context-menu-divider" />
      <button type="button" className="context-menu-item" onClick={onSelectAll}>
        {t('settings_sc_selectall')}
      </button>
      <button type="button" className="context-menu-item" onClick={onClear}>
        {t('settings_sc_clear')}
      </button>
    </div>
  );
}
