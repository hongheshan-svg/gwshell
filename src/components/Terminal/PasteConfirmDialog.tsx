// src/components/Terminal/PasteConfirmDialog.tsx
// Paste confirmation overlay shown before pasting multi-line text into a
// terminal. Extracted from TerminalView.tsx - pure JSX move, no logic changes.

import { useTranslation } from 'react-i18next';

interface PasteConfirmDialogProps {
  text: string;
  onCancel: () => void;
  onPaste: () => void;
}

export function PasteConfirmDialog({ text, onCancel, onPaste }: PasteConfirmDialogProps) {
  const { t } = useTranslation();
  const lineCount = text.split('\n').length;
  return (
    <div className="paste-confirm-overlay" onMouseDown={onCancel}>
      <div className="paste-confirm-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="paste-confirm-title">{t('paste_confirm_title')}</div>
        <div className="paste-confirm-lines">{t('paste_confirm_lines', { count: lineCount })}</div>
        <pre className="paste-confirm-preview">
          {text.split('\n').slice(0, 8).join('\n')}
          {lineCount > 8 ? '\n…' : ''}
        </pre>
        <div className="paste-confirm-actions">
          <button className="paste-confirm-btn" onClick={onCancel}>
            {t('paste_confirm_cancel')}
          </button>
          <button className="paste-confirm-btn primary" onClick={onPaste}>
            {t('paste_confirm_paste')}
          </button>
        </div>
      </div>
    </div>
  );
}
