import { useState, useRef, useEffect } from 'react';
import type { ToolInfo, ToolSelections } from '../../api/tools';

interface ToolsSelectorProps {
  availableTools: ToolInfo[];
  selections: ToolSelections;
  onSelectionsChange: (selections: ToolSelections) => void;
  /** Opt-in built-in tool names (whitelist). Empty = all built-in tools. */
  builtinTools?: string[];
  /** Opt-out built-in tool names (blacklist). Ignored if builtinTools is non-empty. */
  excludedBuiltinTools?: string[];
  /** Called when built-in tools change */
  onBuiltinToolsChange?: (builtin: string[], excluded: string[]) => void;
  disabled?: boolean;
  disabledReason?: string;
  /** When true, dropdown opens for viewing but all controls inside are disabled */
  readOnly?: boolean;
  /** When true, sub-agents are active — custom tools + "Only" mode disabled, "All"/"Exclude" still available */
  subAgentsActive?: boolean;
}

export function ToolsSelector({
  availableTools,
  selections,
  onSelectionsChange,
  builtinTools = [],
  excludedBuiltinTools = [],
  onBuiltinToolsChange,
  disabled = false,
  disabledReason,
  readOnly = false,
  subAgentsActive = false,
}: ToolsSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Draft state for built-in tools — only committed on Apply or "All" radio
  const [draftMode, setDraftMode] = useState<'all' | 'include' | 'exclude'>(
    builtinTools.length > 0 ? 'include' : excludedBuiltinTools.length > 0 ? 'exclude' : 'all'
  );
  const [draftText, setDraftText] = useState(
    builtinTools.length > 0 ? builtinTools.join(', ') : excludedBuiltinTools.join(', ')
  );

  // Sync draft from props when dropdown opens
  useEffect(() => {
    if (isOpen) {
      if (builtinTools.length > 0) {
        setDraftMode('include');
        setDraftText(builtinTools.join(', '));
      } else if (excludedBuiltinTools.length > 0) {
        setDraftMode('exclude');
        setDraftText(excludedBuiltinTools.join(', '));
      } else {
        setDraftMode('all');
        setDraftText('');
      }
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync when props change while closed (e.g. new session settings)
  useEffect(() => {
    if (!isOpen) {
      if (builtinTools.length > 0) {
        setDraftMode('include');
        setDraftText(builtinTools.join(', '));
      } else if (excludedBuiltinTools.length > 0) {
        setDraftMode('exclude');
        setDraftText(excludedBuiltinTools.join(', '));
      } else {
        setDraftMode('all');
        setDraftText('');
      }
    }
  }, [builtinTools.join(','), excludedBuiltinTools.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Count enabled tools
  const enabledCount = availableTools.filter(
    (tool) => selections[tool.name] !== false
  ).length;

  const handleToggle = (toolName: string) => {
    const currentValue = selections[toolName] !== false;
    onSelectionsChange({
      ...selections,
      [toolName]: !currentValue,
    });
  };

  const handleSelectAll = () => {
    const allEnabled: ToolSelections = {};
    availableTools.forEach((tool) => {
      allEnabled[tool.name] = true;
    });
    onSelectionsChange(allEnabled);
  };

  const handleDeselectAll = () => {
    const allDisabled: ToolSelections = {};
    availableTools.forEach((tool) => {
      allDisabled[tool.name] = false;
    });
    onSelectionsChange(allDisabled);
  };

  const parseToolList = (text: string): string[] => {
    return text.split(',').map(s => s.trim()).filter(Boolean);
  };

  const handleBuiltinModeChange = (mode: 'all' | 'include' | 'exclude') => {
    setDraftMode(mode);
    if (mode === 'all') {
      setDraftText('');
      // "All" commits immediately — no text to review
      onBuiltinToolsChange?.([], []);
    }
  };

  const handleBuiltinTextChange = (text: string) => {
    setDraftText(text);
    // Draft only — committed on Apply
  };

  const applyBuiltinTools = () => {
    const tools = parseToolList(draftText);
    onBuiltinToolsChange?.(
      draftMode === 'include' ? tools : [],
      draftMode === 'exclude' ? tools : []
    );
    setIsOpen(false);
  };

  // Badge summary
  const builtinSummary = draftMode === 'all' ? '' 
    : draftMode === 'include' ? ` +${parseToolList(draftText).length}` 
    : ` -${parseToolList(draftText).length}`;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          h-[30px] flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md
          transition-colors duration-150
          ${disabled 
            ? 'bg-gray-100/80 dark:bg-gray-800/80 text-gray-400 border border-gray-200/60 dark:border-gray-700/60 cursor-not-allowed' 
            : 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border border-blue-200/60 dark:border-blue-700/60 hover:bg-blue-100 dark:hover:bg-blue-800/40 cursor-pointer'
          }
        `}
        title={disabledReason || `${enabledCount}/${availableTools.length} custom tools${builtinSummary ? `, built-in: ${draftMode}${builtinSummary}` : ''}`}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span>Tools</span>
        <span className="bg-blue-200 dark:bg-blue-800/40 text-blue-800 dark:text-blue-300 px-1.5 py-0.5 rounded text-[10px] font-semibold w-[3.5rem] text-center">
          {enabledCount}/{availableTools.length}{builtinSummary}
        </span>
        <svg
          className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1 w-80 bg-white/95 dark:bg-[#2a2a3c]/95 backdrop-blur-xl border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50">
          {/* Custom Tools Header */}
          {availableTools.length > 0 && (
            <>
              <div className="flex items-center justify-between px-3 py-2 border-b border-white/40 dark:border-gray-700">
                <span className={`text-xs font-medium ${subAgentsActive ? 'text-gray-400 dark:text-gray-500' : 'text-gray-600 dark:text-gray-400'}`}>
                  Custom Tools
                  {subAgentsActive && <span className="text-[10px] text-gray-400 ml-1">(disabled with sub-agents)</span>}
                </span>
                {!readOnly && !subAgentsActive && (
                <div className="flex gap-2">
                  <button onClick={handleSelectAll} className="text-[10px] text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium">All</button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button onClick={handleDeselectAll} className="text-[10px] text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium">None</button>
                </div>
                )}
              </div>
              <div className="max-h-48 overflow-y-auto py-1">
                {availableTools.map((tool) => {
                  const isEnabled = selections[tool.name] !== false;
                  return (
                    <label key={tool.name} className={`flex items-start gap-2 px-3 py-1.5 ${(readOnly || subAgentsActive) ? 'opacity-60 cursor-default' : 'hover:bg-white/40 dark:hover:bg-gray-700/40 cursor-pointer'}`}>
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={() => handleToggle(tool.name)}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        disabled={readOnly || subAgentsActive}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{tool.name}</div>
                        <div className="text-xs text-gray-500 line-clamp-1">{tool.description}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </>
          )}

          {/* Built-in Tools Section */}
          <>
            <div className="px-3 py-2 border-t border-white/40 dark:border-gray-700">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                Built-in Tools
                {!onBuiltinToolsChange && <span className="text-[10px] text-gray-400 ml-1">(locked)</span>}
              </span>
              <div className={`flex items-center gap-3 mt-1.5 ${readOnly ? 'opacity-60' : ''}`}>
                <label className={`flex items-center gap-1 text-[11px] ${!onBuiltinToolsChange ? 'opacity-50' : ''}`}>
                  <input type="radio" checked={draftMode === 'all'} onChange={() => handleBuiltinModeChange('all')} className="h-3 w-3" disabled={!onBuiltinToolsChange || readOnly} />
                  All
                </label>
                <label className={`flex items-center gap-1 text-[11px] ${(!onBuiltinToolsChange || subAgentsActive) ? 'opacity-50' : ''}`} title={subAgentsActive ? 'Include mode not available with sub-agents' : ''}>
                  <input type="radio" checked={draftMode === 'include'} onChange={() => handleBuiltinModeChange('include')} className="h-3 w-3" disabled={!onBuiltinToolsChange || readOnly || subAgentsActive} />
                  Only
                </label>
                <label className={`flex items-center gap-1 text-[11px] ${!onBuiltinToolsChange ? 'opacity-50' : ''}`}>
                  <input type="radio" checked={draftMode === 'exclude'} onChange={() => handleBuiltinModeChange('exclude')} className="h-3 w-3" disabled={!onBuiltinToolsChange || readOnly} />
                  Exclude
                </label>
              </div>
              {draftMode !== 'all' && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <input
                    type="text"
                    value={draftText}
                    onChange={(e) => handleBuiltinTextChange(e.target.value)}
                    placeholder={draftMode === 'include' ? 'e.g. web_search, view, edit' : 'e.g. powershell, sql'}
                    className={`flex-1 px-2 py-1 border border-white/40 dark:border-gray-600 rounded text-xs ${(onBuiltinToolsChange && !readOnly) ? 'focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white/50 dark:bg-gray-700/50' : 'bg-white/30 dark:bg-gray-800/30 text-gray-500 cursor-default'}`}
                    disabled={!onBuiltinToolsChange || readOnly}
                    readOnly={!onBuiltinToolsChange || readOnly}
                  />
                  {onBuiltinToolsChange && !readOnly && (
                    <button
                      onClick={applyBuiltinTools}
                      className="px-2 py-1 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors whitespace-nowrap"
                    >
                      Apply
                    </button>
                  )}
                </div>
              )}
            </div>
          </>

          {/* Footer */}
          <div className="px-3 py-2 border-t border-white/40 dark:border-gray-700 bg-white/30 dark:bg-gray-800/30 rounded-b-lg">
            <div className="text-[10px] text-gray-500">
              Custom: ~/.copilot-console/tools/ {draftMode !== 'all' && `· Built-in: ${draftMode === 'include' ? 'opt-in' : 'opt-out'}`}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
