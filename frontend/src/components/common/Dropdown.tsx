import { useState, useRef, useEffect, useCallback } from 'react';

export interface DropdownOption {
  value: string;
  label: string;
  title?: string;
}

interface DropdownProps {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  className?: string;
  /** Custom class for the dropdown list panel */
  dropdownClassName?: string;
  /** 'compact' for inline badge style, 'full' for form-width input */
  variant?: 'compact' | 'full';
}

export function Dropdown({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  label,
  disabled = false,
  className = '',
  dropdownClassName,
  variant = 'full',
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const isCompact = variant === 'compact';

  const selectedOption = options.find(o => o.value === value);
  const displayLabel = selectedOption?.label || placeholder;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setHighlightIndex(-1);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || highlightIndex < 0 || !listRef.current) return;
    const items = listRef.current.querySelectorAll('[data-dropdown-item]');
    items[highlightIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [highlightIndex, open]);

  const handleToggle = useCallback(() => {
    if (disabled) return;
    setOpen(prev => {
      if (!prev) {
        // Opening: highlight current selection
        const idx = options.findIndex(o => o.value === value);
        setHighlightIndex(idx >= 0 ? idx : 0);
      }
      return !prev;
    });
  }, [disabled, options, value]);

  const handleSelect = useCallback((optionValue: string) => {
    onChange(optionValue);
    setOpen(false);
    setHighlightIndex(-1);
  }, [onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        handleToggle();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIndex(prev => Math.min(prev + 1, options.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightIndex >= 0 && highlightIndex < options.length) {
          handleSelect(options[highlightIndex].value);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        setHighlightIndex(-1);
        break;
    }
  }, [open, highlightIndex, options, handleToggle, handleSelect]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {label}
        </label>
      )}
      {/* Trigger button */}
      <button
        type="button"
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        className={isCompact
          ? `px-2.5 py-1 text-xs font-medium rounded-md flex items-center gap-1.5 transition-colors ${
              !disabled
                ? 'bg-gray-50 dark:bg-[#2a2a3c] text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#32324a] cursor-pointer border border-gray-200 dark:border-[#3a3a4e]'
                : 'bg-gray-100 dark:bg-[#2a2a3c] text-gray-400 dark:text-gray-500 cursor-default border border-gray-200/60 dark:border-gray-700/60'
            }`
          : `w-full px-3 py-2 border rounded-lg text-sm flex items-center justify-between transition-colors ${
              !disabled
                ? 'border-gray-200 dark:border-[#3a3a4e] bg-white dark:bg-[#1e1e2e] text-gray-900 dark:text-gray-100 hover:border-gray-300 dark:hover:border-gray-500 cursor-pointer'
                : 'border-gray-200/60 dark:border-gray-700/60 bg-gray-50 dark:bg-[#1e1e2e] text-gray-400 dark:text-gray-500 cursor-default'
            }`
        }
      >
        <span className={`truncate min-w-0 ${isCompact ? 'max-w-[200px]' : 'flex-1 text-left'}`}>
          {displayLabel}
        </span>
        {!disabled && (
          <svg className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''} ${isCompact ? 'w-3 h-3' : 'w-4 h-4 text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {/* Dropdown list */}
      {open && (
        <div
          ref={listRef}
          className={`absolute top-full mt-1 bg-white dark:bg-[#2a2a3c] border border-gray-200 dark:border-[#3a3a4e] rounded-md shadow-lg dark:shadow-black/20 z-50 overflow-y-auto ${
            dropdownClassName || (isCompact ? 'left-0 min-w-[180px] max-h-60' : 'left-0 right-0 min-w-full max-h-60')
          }`}
          role="listbox"
        >
          {options.map((option, i) => {
            const isSelected = option.value === value;
            const isHighlighted = i === highlightIndex;
            return (
              <button
                key={option.value}
                type="button"
                data-dropdown-item
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelect(option.value)}
                onMouseEnter={() => setHighlightIndex(i)}
                title={option.title}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  isSelected
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                    : isHighlighted
                    ? 'bg-gray-100 dark:bg-[#32324a] text-gray-900 dark:text-gray-100'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#32324a]'
                }`}
              >
                {option.label}
              </button>
            );
          })}
          {options.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 italic">
              No options
            </div>
          )}
        </div>
      )}
    </div>
  );
}
