import { useToastStore, type ToastAction } from '../stores/toastStore';

interface ToastOptions {
  title: string;
  message?: string;
  durationMs?: number;
  action?: ToastAction;
}

export function useToast() {
  const pushToast = useToastStore((s) => s.pushToast);
  return {
    info: (opts: ToastOptions) => pushToast({ kind: 'info', ...opts }),
    success: (opts: ToastOptions) => pushToast({ kind: 'success', ...opts }),
    warning: (opts: ToastOptions) => pushToast({ kind: 'warning', ...opts }),
    error: (opts: ToastOptions) => pushToast({ kind: 'error', ...opts }),
  };
}
