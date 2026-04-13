/**
 * Toast notification container.
 * Renders a stack of toasts in the top-right corner.
 * Mount once in App.tsx.
 */

import { useEffect, useState } from 'react';
import { useToastStore, type Toast, type ToastType } from '../../stores/toastStore';

const TYPE_STYLES: Record<ToastType, string> = {
  info: 'bg-blue-600 dark:bg-blue-700 text-white',
  success: 'bg-emerald-600 dark:bg-emerald-700 text-white',
  warning: 'bg-amber-500 dark:bg-amber-600 text-white',
  error: 'bg-red-600 dark:bg-red-700 text-white',
};

const TYPE_ICONS: Record<ToastType, string> = {
  info: 'ℹ️',
  success: '✓',
  warning: '⚠',
  error: '❌',
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    // Slide in
    requestAnimationFrame(() => setVisible(true));

    // Start exit animation before removal
    if (toast.duration > 0) {
      const exitTimer = setTimeout(() => setExiting(true), toast.duration - 300);
      return () => clearTimeout(exitTimer);
    }
  }, [toast.duration]);

  return (
    <div
      className={`
        flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg
        text-sm font-medium max-w-sm
        transition-all duration-300 ease-out cursor-pointer
        ${TYPE_STYLES[toast.type]}
        ${visible && !exiting ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'}
      `}
      onClick={onDismiss}
      role="alert"
    >
      <span className="text-base leading-none flex-shrink-0">{TYPE_ICONS[toast.type]}</span>
      <span className="flex-1 min-w-0">{toast.message}</span>
    </div>
  );
}

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} onDismiss={() => removeToast(toast.id)} />
        </div>
      ))}
    </div>
  );
}
