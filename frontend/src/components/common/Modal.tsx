import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Visual size; defaults to ``md`` (max-w-md) for back-compat. */
  size?: 'md' | 'lg' | 'xl';
  /** Optional non-scrolling slot rendered between the header and the scrollable body (e.g. tab bar). */
  tabs?: ReactNode;
}

const SIZE_CLASS: Record<NonNullable<ModalProps['size']>, string> = {
  md: 'max-w-md',
  lg: 'max-w-xl',
  xl: 'max-w-4xl',
};

export function Modal({ isOpen, onClose, title, children, footer, size = 'md', tabs }: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/20 dark:bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative bg-white/95 dark:bg-[#2a2a3c]/95 backdrop-blur-xl border border-gray-200 dark:border-[#3a3a4e] rounded-2xl shadow-2xl ${SIZE_CLASS[size]} w-full mx-4 max-h-[90vh] flex flex-col`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/30 dark:border-[#3a3a4e]">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
            aria-label="Close dialog"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs (non-scrolling slot between header and body) */}
        {tabs && (
          <div className="px-6 pt-1 border-b border-gray-200 dark:border-[#3a3a4e]">
            {tabs}
          </div>
        )}

        {/* Content */}
        <div className="px-6 py-4 overflow-y-auto flex-1 min-h-0">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-white/30 dark:border-[#3a3a4e] bg-white/30 dark:bg-[#252536]/30">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
