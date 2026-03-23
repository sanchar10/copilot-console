import { useState, useRef, useEffect } from 'react';
import type { SystemMessage } from '../../types/agent';

interface SystemPromptEditorProps {
  /** Current system message value. null/undefined = SDK default */
  value: SystemMessage | null | undefined;
  /** Called when value changes */
  onChange: (value: SystemMessage | null) => void;
  /** compact = header popover badge, full = agent editor form */
  variant?: 'compact' | 'full';
  /** When true, shows badge but prevents editing (compact only) */
  disabled?: boolean;
}

export function SystemPromptEditor({
  value,
  onChange,
  variant = 'compact',
  disabled = false,
}: SystemPromptEditorProps) {
  const hasContent = !!(value?.content?.trim());
  
  if (variant === 'full') {
    return <FullVariant value={value} onChange={onChange} />;
  }
  return <CompactVariant value={value} onChange={onChange} hasContent={hasContent} disabled={disabled} />;
}

/** Full variant — used in AgentEditor */
function FullVariant({
  value,
  onChange,
}: {
  value: SystemMessage | null | undefined;
  onChange: (value: SystemMessage | null) => void;
}) {
  const mode = value?.mode || 'replace';
  const content = value?.content || '';

  const handleModeChange = (newMode: 'replace' | 'append') => {
    onChange({ mode: newMode, content });
  };

  const handleContentChange = (newContent: string) => {
    if (!newContent.trim()) {
      onChange(null);
    } else {
      onChange({ mode, content: newContent });
    }
  };

  return (
    <section className="bg-white/50 dark:bg-[#252536]/50 backdrop-blur rounded-xl border border-white/40 dark:border-[#3a3a4e] p-5 space-y-4">
      <h2 className="font-semibold text-gray-700 dark:text-gray-200">System Prompt</h2>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={mode === 'replace'}
            onChange={() => handleModeChange('replace')}
          />
          Replace default
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={mode === 'append'}
            onChange={() => handleModeChange('append')}
          />
          Append to default
        </label>
      </div>
      <textarea
        value={content}
        onChange={(e) => handleContentChange(e.target.value)}
        placeholder="Enter the system prompt..."
        rows={6}
        className="w-full px-3 py-2 border border-white/40 dark:border-gray-600 bg-white/50 dark:bg-[#1e1e2e] backdrop-blur rounded-lg text-sm font-mono dark:text-gray-100 focus:ring-2 focus:ring-blue-500/50 focus:border-transparent"
      />
    </section>
  );
}

/** Compact variant — used in chat header */
function CompactVariant({
  value,
  onChange,
  hasContent,
  disabled = false,
}: {
  value: SystemMessage | null | undefined;
  onChange: (value: SystemMessage | null) => void;
  hasContent: boolean;
  disabled?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Local draft state — only committed on explicit Apply
  const [draftMode, setDraftMode] = useState<'replace' | 'append'>(value?.mode || 'replace');
  const [draftContent, setDraftContent] = useState(value?.content || '');

  // Sync draft from props when popover opens
  useEffect(() => {
    if (isOpen) {
      setDraftMode(value?.mode || 'replace');
      setDraftContent(value?.content || '');
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Commit draft to parent and close
  const commitAndClose = () => {
    const trimmed = draftContent.trim();
    const newValue: SystemMessage | null = trimmed
      ? { mode: draftMode, content: draftContent }
      : null;
    const oldKey = value ? `${value.mode}:${value.content}` : '';
    const newKey = newValue ? `${newValue.mode}:${newValue.content}` : '';
    if (oldKey !== newKey) {
      onChange(newValue);
    }
    setIsOpen(false);
  };

  // Discard draft and close
  const discardAndClose = () => {
    setIsOpen(false);
  };

  // Close on outside click — discards unsaved changes
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        discardAndClose();
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }); // runs every render to capture latest refs

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => {
          if (isOpen) {
            discardAndClose();
          } else {
            setIsOpen(true);
          }
        }}
        className={`h-[30px] px-2.5 py-1 text-xs font-medium rounded-md flex items-center gap-1.5 transition-colors duration-150 cursor-pointer ${
          disabled
            ? 'bg-gray-100/80 dark:bg-[#32324a] text-gray-600 dark:text-gray-400 border border-gray-200/60 dark:border-gray-600 cursor-default'
            : 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200/60 dark:border-blue-700 hover:bg-blue-100 dark:hover:bg-blue-900/50'
        }`}
        title={hasContent ? `System prompt (${value?.mode || 'replace'})` : 'No custom system prompt — using SDK default'}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span>{hasContent ? 'Prompt' : 'Default'}</span>
        <svg
          className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1 w-96 bg-white/95 dark:bg-[#2a2a3c]/95 backdrop-blur-xl border border-gray-200 dark:border-[#3a3a4e] rounded-lg shadow-lg z-50">
          {/* Mode toggle */}
          <div className="flex items-center gap-4 px-3 py-2 border-b border-white/40 dark:border-[#3a3a4e]">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Mode:{disabled && <span className="text-gray-400 dark:text-gray-500 ml-1">(locked)</span>}</span>
            <label className={`flex items-center gap-1.5 text-xs ${disabled ? 'opacity-50' : ''}`}>
              <input
                type="radio"
                checked={draftMode === 'replace'}
                onChange={() => setDraftMode('replace')}
                className="h-3 w-3"
                disabled={disabled}
              />
              Replace
            </label>
            <label className={`flex items-center gap-1.5 text-xs ${disabled ? 'opacity-50' : ''}`}>
              <input
                type="radio"
                checked={draftMode === 'append'}
                onChange={() => setDraftMode('append')}
                className="h-3 w-3"
                disabled={disabled}
              />
              Append
            </label>
          </div>

          {/* Content */}
          <div className="p-3">
            <textarea
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              placeholder="Enter system prompt... (empty = SDK default)"
              rows={5}
              className={`w-full px-2 py-1.5 border border-white/40 dark:border-gray-600 rounded text-xs font-mono resize-y ${disabled ? 'bg-white/30 dark:bg-[#1e1e2e]/30 text-gray-500 dark:text-gray-500 cursor-default' : 'bg-white/50 dark:bg-[#1e1e2e] dark:text-gray-100 focus:ring-2 focus:ring-blue-500/50 focus:border-transparent'}`}
              autoFocus={!disabled}
              readOnly={disabled}
              disabled={disabled}
            />
          </div>

          {/* Footer */}
          <div className="px-3 py-2 border-t border-white/40 dark:border-[#3a3a4e] bg-white/30 dark:bg-[#252536]/30 rounded-b-lg flex items-center justify-between">
            <div className="text-[10px] text-gray-500 dark:text-gray-500">
              {disabled
                ? 'Cannot be changed after session starts'
                : draftContent.trim() ? `${draftMode === 'replace' ? 'Replaces' : 'Appends to'} default Copilot prompt` : 'Using SDK default system prompt'}
            </div>
            {!disabled && (
              <button
                onClick={commitAndClose}
                className="px-2.5 py-1 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
              >
                Apply
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
