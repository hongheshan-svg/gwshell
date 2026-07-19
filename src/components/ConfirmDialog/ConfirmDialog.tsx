import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirmStore } from '../../stores/confirmStore';
import './confirm.css';

export function ConfirmDialog() {
  const { t } = useTranslation();
  const open = useConfirmStore((s) => s.open);
  const options = useConfirmStore((s) => s.options);
  const respond = useConfirmStore((s) => s.respond);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        respond(false);
        return;
      }
      // Enter: only confirm if no button is focused. If a button IS focused,
      // let its native click handler fire (so Enter on Cancel cancels, not
      // confirms). This fixes the a11y bug where Tab to Cancel + Enter would
      // confirm instead of cancel.
      if (e.key === 'Enter') {
        const active = document.activeElement;
        const isButtonFocused =
          active instanceof HTMLButtonElement && active.closest('.confirm-dialog');
        if (!isButtonFocused) {
          respond(true);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, respond]);

  if (!open || !options) return null;

  return (
    <div className="confirm-overlay" role="presentation" onClick={() => respond(false)}>
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div id="confirm-title" className="confirm-title">
          {options.title}
        </div>
        {options.message && <div className="confirm-message">{options.message}</div>}
        <div className="confirm-actions">
          <button className="confirm-btn" onClick={() => respond(false)}>
            {options.cancelLabel ?? t('common.cancel')}
          </button>
          <button
            ref={confirmBtnRef}
            className={`confirm-btn ${options.danger ? 'confirm-btn--danger' : ''}`}
            onClick={() => respond(true)}
          >
            {options.confirmLabel ?? t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
