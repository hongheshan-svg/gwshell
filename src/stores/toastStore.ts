import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
  durationMs?: number; // 0 = sticky; undefined = default per kind
  action?: ToastAction;
}

interface ToastState {
  toasts: Toast[];
  pushToast: (toast: Omit<Toast, 'id'>) => string;
  dismissToast: (id: string) => void;
  clear: () => void;
}

const DEFAULT_DURATION_MS: Record<ToastKind, number> = {
  info: 5000,
  success: 4000,
  warning: 6000,
  error: 0, // sticky — user must dismiss
};

let toastSeq = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  pushToast: (toast) => {
    const id = `toast-${++toastSeq}`;
    const duration = toast.durationMs ?? DEFAULT_DURATION_MS[toast.kind];
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
    if (duration > 0) {
      setTimeout(() => {
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
      }, duration);
    }
    return id;
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));
