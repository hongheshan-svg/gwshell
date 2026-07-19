import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useToastStore, type Toast } from '../../stores/toastStore';
import './toast.css';

export function ToastItem({ toast }: { toast: Toast }) {
  const { t } = useTranslation();
  const dismiss = useToastStore((s) => s.dismissToast);
  return (
    <div
      className={`toast-item toast-item--${toast.kind}`}
      role={toast.kind === 'error' ? 'alert' : 'status'}
      aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
    >
      <div className="toast-body">
        <div className="toast-title">{toast.title}</div>
        {toast.message && <div className="toast-message">{toast.message}</div>}
        {toast.action && (
          <button className="toast-action" onClick={toast.action.onClick}>
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        className="toast-close"
        onClick={() => dismiss(toast.id)}
        aria-label={t('common.dismiss')}
      >
        <X size={14} />
      </button>
    </div>
  );
}
