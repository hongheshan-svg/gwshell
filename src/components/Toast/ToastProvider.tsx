import { useTranslation } from 'react-i18next';
import { useToastStore } from '../../stores/toastStore';
import { ToastItem } from './ToastItem';
import './toast.css';

export function ToastProvider() {
  const { t } = useTranslation();
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div className="toast-stack" aria-label={t('common.notifications')}>
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
