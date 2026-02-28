import { useState, useRef, useEffect } from 'react';
import type { Agent } from '../../types/agent';

interface SubAgentSelectorProps {
  availableAgents: Agent[];
  selectedIds: string[];
  onSelectionChange: (selectedIds: string[]) => void;
  disabled?: boolean;
  disabledReason?: string;
  readOnly?: boolean;
}

export function SubAgentSelector({
  availableAgents,
  selectedIds,
  onSelectionChange,
  disabled = false,
  disabledReason,
  readOnly = false,
}: SubAgentSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const enabledCount = availableAgents.filter(
    (agent) => selectedIds.includes(agent.id)
  ).length;

  const handleToggle = (agentId: string) => {
    if (selectedIds.includes(agentId)) {
      onSelectionChange(selectedIds.filter((id) => id !== agentId));
    } else {
      onSelectionChange([...selectedIds, agentId]);
    }
  };

  const handleSelectAll = () => {
    onSelectionChange(availableAgents.map((a) => a.id));
  };

  const handleDeselectAll = () => {
    onSelectionChange([]);
  };

  if (availableAgents.length === 0) {
    return null;
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md h-[30px]
          transition-colors duration-150
          ${disabled
            ? 'bg-gray-100/80 dark:bg-gray-800/80 text-gray-400 border border-gray-200/60 dark:border-gray-700/60 cursor-not-allowed'
            : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border border-purple-200/60 dark:border-purple-700/60 hover:bg-purple-200/80 dark:hover:bg-purple-800/40 cursor-pointer'
          }
        `}
        title={disabledReason || `${enabledCount}/${availableAgents.length} sub-agents enabled`}
      >
        <span className="text-sm leading-none">👥</span>
        <span>Sub-Agents</span>
        <span className="bg-purple-200/80 dark:bg-purple-800/40 text-purple-800 dark:text-purple-300 px-1.5 py-0.5 rounded text-[10px] font-semibold min-w-[2.5rem] text-center">
          {enabledCount}/{availableAgents.length}
        </span>
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
        <div className="absolute top-full left-0 mt-1 w-72 bg-white/95 dark:bg-[#2a2a3c]/95 backdrop-blur-xl border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50">
          <div className="p-2 border-b border-white/40 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Sub-Agents</span>
              {!readOnly && (
                <div className="flex gap-1">
                  <button
                    onClick={handleSelectAll}
                    className="text-[10px] text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300 px-1.5 py-0.5"
                  >
                    All
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button
                    onClick={handleDeselectAll}
                    className="text-[10px] text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300 px-1.5 py-0.5"
                  >
                    None
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto py-1">
            {availableAgents.map((agent) => {
              const isSelected = selectedIds.includes(agent.id);
              return (
                <label
                  key={agent.id}
                  className={`flex items-start gap-2 px-3 py-2 ${readOnly ? 'opacity-60 cursor-default' : 'hover:bg-white/40 dark:hover:bg-gray-700/40 cursor-pointer'}`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => handleToggle(agent.id)}
                    className="mt-0.5 h-4 w-4 text-purple-600 rounded border-gray-300 focus:ring-purple-500"
                    disabled={readOnly}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm">{agent.icon}</span>
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {agent.name}
                      </span>
                    </div>
                    {agent.description && (
                      <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate mt-0.5">
                        {agent.description}
                      </div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
