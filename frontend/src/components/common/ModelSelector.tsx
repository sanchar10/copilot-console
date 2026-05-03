import { useState, useRef, useEffect } from 'react';
import type { Model } from '../../api/models';

interface ModelSelectorProps {
  models: Model[];
  selectedModelId: string;
  reasoningEffort: string | null;
  onModelChange: (modelId: string, effort: string | null) => void;
  onReasoningEffortChange?: (effort: string) => void;
  disabled?: boolean;
  /** When true, dropdown opens but items are non-selectable (grayed out) */
  readOnly?: boolean;
  /** 'compact' for header badge, 'full' for form-width input */
  variant?: 'compact' | 'full';
}

export function ModelSelector({
  models,
  selectedModelId,
  reasoningEffort,
  onModelChange,
  onReasoningEffortChange,
  disabled = false,
  readOnly = false,
  variant = 'compact',
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [expandedModelId, setExpandedModelId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setExpandedModelId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const currentModel = models.find(m => m.id === selectedModelId);
  const modelName = currentModel?.name || selectedModelId;
  // Compact label drops only the redundant "Claude " vendor prefix; "GPT-..." etc.
  // are left intact since "GPT" is itself the family identifier. Full name is
  // still shown in the dropdown and in tooltips.
  const compactLabel = modelName.replace(/^Claude\s+/i, '');
  const hasReasoning = !!(currentModel?.supported_reasoning_efforts?.length);
  const displayEffort = reasoningEffort || currentModel?.default_reasoning_effort || null;

  const handleToggle = () => {
    if (disabled || models.length === 0) return;
    setOpen(!open);
    if (open) setExpandedModelId(null);
  };

  const handleModelSelect = (m: Model) => {
    if (readOnly) return;
    const defaultEffort = m.supported_reasoning_efforts?.length
      ? (m.default_reasoning_effort || m.supported_reasoning_efforts[0])
      : null;
    onModelChange(m.id, defaultEffort);
    setOpen(false);
    setExpandedModelId(null);
  };

  const handleReasoningSelect = (modelId: string, effort: string) => {
    if (readOnly) return;
    const m = models.find(mod => mod.id === modelId);
    if (m) onModelChange(m.id, effort);
    if (onReasoningEffortChange) onReasoningEffortChange(effort);
    setOpen(false);
    setExpandedModelId(null);
  };

  const isCompact = variant === 'compact';

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={handleToggle}
        className={isCompact
          ? `w-[120px] h-[30px] px-2.5 py-0.5 text-xs font-medium rounded-md flex items-center gap-1.5 transition-colors duration-150 ${
              !disabled
                ? 'bg-blue-50 dark:bg-blue-900/[0.18] text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/30 cursor-pointer border border-blue-200/60 dark:border-blue-500/35'
                : 'bg-gray-100 dark:bg-[#2a2a3c] text-gray-600 dark:text-gray-400 cursor-default border border-gray-200/60 dark:border-gray-700/60'
            }`
          : `w-full px-3 py-2 border rounded-lg text-sm flex items-center justify-between transition-colors ${
              !disabled
                ? 'border-white/40 bg-white/50 dark:bg-[#1e1e2e] dark:border-gray-600 dark:text-gray-100 hover:border-blue-300 dark:hover:border-blue-600 cursor-pointer'
                : 'border-white/40 bg-gray-50 dark:bg-[#1e1e2e] dark:border-gray-600 text-gray-500 dark:text-gray-400 cursor-default'
            }`
        }
        title={disabled ? 'Model cannot be changed' : 'Click to change model'}
      >
        <div className={`flex flex-col items-start leading-tight min-w-0 flex-1 ${isCompact ? '' : ''}`}>
          <span className={`truncate w-full text-left ${isCompact ? '' : ''}`} title={modelName}>{isCompact ? compactLabel : modelName}</span>
          {hasReasoning && displayEffort && (
            <span className="text-[9px] opacity-70 capitalize">{displayEffort}</span>
          )}
        </div>
        {!disabled && (
          <svg className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''} ${isCompact ? 'w-3.5 h-3.5' : 'w-4 h-4 text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className={`absolute top-full mt-1 bg-white dark:bg-[#2a2a3c] border dark:border-[#3a3a4e] rounded-md shadow-lg dark:shadow-black/20 z-50 max-h-60 overflow-y-auto ${
          isCompact ? 'left-0 min-w-[200px]' : 'left-0 right-0 min-w-full'
        }`}>
          {models.map((m) => {
            const isSelected = m.id === selectedModelId;
            const supportsReasoning = !!(m.supported_reasoning_efforts?.length);
            const isExpanded = expandedModelId === m.id;
            return (
              <div key={m.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (supportsReasoning) {
                      setExpandedModelId(isExpanded ? null : m.id);
                    } else {
                      handleModelSelect(m);
                    }
                  }}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between ${
                    readOnly
                      ? 'opacity-50 cursor-default'
                      : 'hover:bg-gray-100 dark:hover:bg-[#32324a]'
                  } ${
                    isSelected ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'
                  }`}
                >
                  <span>{m.name}</span>
                  {supportsReasoning && (
                    <svg className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  )}
                </button>
                {supportsReasoning && isExpanded && (
                  <div className="px-3 py-1.5 bg-gray-50 dark:bg-[#1e1e2e] flex gap-1 flex-wrap">
                    {m.supported_reasoning_efforts!.map((level) => {
                      const isExplicitlySelected = isSelected && reasoningEffort === level;
                      const isDefault = m.default_reasoning_effort === level;
                      return (
                        <button
                          key={level}
                          type="button"
                          onClick={() => handleReasoningSelect(m.id, level)}
                          className={`px-2 py-0.5 text-[11px] rounded-full border transition-colors ${
                            isExplicitlySelected
                              ? 'bg-blue-100 dark:bg-blue-900/40 border-blue-300 dark:border-blue-600 text-blue-700 dark:text-blue-300'
                              : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#32324a]'
                          }`}
                        >
                          {level}{isDefault && !isExplicitlySelected ? ' ●' : ''}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
