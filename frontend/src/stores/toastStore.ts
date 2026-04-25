/**
 * Toast notification store.
 * 
 * Usage: useToastStore.getState().addToast('Message', 'info')
 * Types: info, warning, success, error
 */

import { create } from 'zustand';

export type ToastType = 'info' | 'warning' | 'success' | 'error';

export interface ToastAction {
  label: string;
  /** If provided, clicking opens this URL in a new tab (user-gesture, popup-blocker safe). */
  href?: string;
  /** Optional click handler; runs in addition to href navigation. */
  onClick?: () => void;
}

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
  /** Optional inline action button (e.g. "Sign in"). */
  action?: ToastAction;
}

export interface AddToastOptions {
  duration?: number;
  action?: ToastAction;
  /** Reuse the same toast if one with this id is already shown (replaces it). */
  id?: string;
}

interface ToastState {
  toasts: Toast[];
  addToast: (message: string, type?: ToastType, durationOrOptions?: number | AddToastOptions) => string;
  removeToast: (id: string) => void;
}

let nextId = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (message, type = 'info', durationOrOptions = 5000) => {
    const opts: AddToastOptions =
      typeof durationOrOptions === 'number'
        ? { duration: durationOrOptions }
        : durationOrOptions;
    const duration = opts.duration ?? 5000;
    const id = opts.id ?? `toast-${++nextId}`;
    const toast: Toast = { id, message, type, duration, action: opts.action };

    set((state) => {
      // Replace any existing toast with the same id (used for sticky/dedup'd toasts).
      const filtered = state.toasts.filter((t) => t.id !== id);
      return { toasts: [...filtered, toast] };
    });

    if (duration > 0) {
      setTimeout(() => {
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
      }, duration);
    }

    return id;
  },

  removeToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
}));
