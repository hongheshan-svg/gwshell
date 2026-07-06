import { useToastStore } from '../../stores/toastStore';
import { ToastItem } from './ToastItem';
import './toast.css';

export function ToastProvider() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div className="toast-stack" aria-label="Notifications">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
