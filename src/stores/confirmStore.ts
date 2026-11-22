import { create } from 'zustand';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ConfirmState {
  open: boolean;
  options: ConfirmOptions | null;
  resolve: ((ok: boolean) => void) | null;
  request: (opts: ConfirmOptions) => Promise<boolean>;
  respond: (ok: boolean) => void;
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  open: false,
  options: null,
  resolve: null,
  request: (opts) =>
    new Promise<boolean>((resolve) => {
      // If a previous confirm dialog is still pending, cancel it cleanly so its
      // awaited Promise never leaks or hangs forever.
      get().resolve?.(false);
      set({ open: true, options: opts, resolve });
    }),
  respond: (ok) => {
    get().resolve?.(ok);
    set({ open: false, options: null, resolve: null });
  },
}));
