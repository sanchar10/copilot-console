import { useState, useRef, useEffect } from 'react';
import type { Agent, DiscoverableAgent, DiscoverableAgentsResponse, AgentSourceType } from '../../types/agent';

interface SubAgentSelectorProps {
  /** Grouped agents from discovery API (new unified mode). */
  discoverableAgents?: DiscoverableAgentsResponse;
  /** Legacy: flat list of console agents (for AgentEditor which doesn't need sections). */
  availableAgents?: Agent[];
  selectedIds: string[];
  onSelectionChange: (selectedIds: string[]) => void;
  disabled?: boolean;
  disabledReason?: string;
  readOnly?: boolean;
}

const SECTION_ORDER: AgentSourceType[] = ['copilot_global', 'github_global', 'github_cwd', 'console_global'];

const SECTION_ICONS: Record<AgentSourceType, string> = {
  copilot_global: '🤖',
  github_global: '🌐',
  github_cwd: '📁',
  console_global: '🧩',
};

export function SubAgentSelector({
  discoverableAgents,
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

  // Compute total available and selected counts
  let totalAvailable = 0;
  const allAvailableIds = new Set<string>();
  if (discoverableAgents) {
    for (const section of Object.values(discoverableAgents)) {
      totalAvailable += section.agents.length;
      for (const a of section.agents) allAvailableIds.add(a.id);
    }
  } else if (availableAgents) {
    totalAvailable = availableAgents.length;
    for (const a of availableAgents) allAvailableIds.add(a.id);
  }

  // Only count selections that still exist in available agents
  const enabledCount = selectedIds.filter((id) => allAvailableIds.has(id)).length;

  const handleToggle = (agentId: string) => {
    if (selectedIds.includes(agentId)) {
      onSelectionChange(selectedIds.filter((id) => id !== agentId));
    } else {
      onSelectionChange([...selectedIds, agentId]);
    }
  };

  const handleSectionAll = (agents: DiscoverableAgent[]) => {
    const ids = agents.map((a) => a.id);
    const newSelected = [...selectedIds.filter((id) => !ids.includes(id)), ...ids];
    onSelectionChange(newSelected);
  };

  const handleSectionNone = (agents: DiscoverableAgent[]) => {
    const ids = new Set(agents.map((a) => a.id));
    onSelectionChange(selectedIds.filter((id) => !ids.has(id)));
  };

  // Legacy mode: flat list (for AgentEditor)
  const handleLegacyAll = () => {
    if (availableAgents) onSelectionChange(availableAgents.map((a) => a.id));
  };
  const handleLegacyNone = () => onSelectionChange([]);

  if (totalAvailable === 0) {
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
            : 'bg-blue-50 dark:bg-blue-900/[0.18] text-blue-700 dark:text-blue-300 border border-blue-200/60 dark:border-blue-500/35 hover:bg-blue-100 dark:hover:bg-blue-800/40 cursor-pointer'
          }
        `}
        title={disabledReason || `${enabledCount}/${totalAvailable} sub-agents enabled`}
      >
        <span className="text-sm leading-none">👥</span>
        <span>Sub-Agents</span>
        <span className="bg-blue-200/80 dark:bg-blue-800/40 text-blue-800 dark:text-blue-300 px-1.5 py-0.5 rounded text-[10px] font-semibold min-w-[2.5rem] text-center">
          {enabledCount}/{totalAvailable}
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
        <div className="absolute top-full left-0 mt-1 w-80 bg-white/95 dark:bg-[#2a2a3c]/95 backdrop-blur-xl border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50">
          <div className="max-h-80 overflow-y-auto">
            {discoverableAgents ? (
              // Sectioned mode
              SECTION_ORDER.map((sourceType) => {
                const section = discoverableAgents[sourceType];
                if (!section) return null;
                const agents = section.agents;
                const sectionSelectedCount = agents.filter((a) => selectedIds.includes(a.id)).length;

                return (
                  <div key={sourceType}>
                    {/* Section header */}
                    <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50/80 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-700/50 sticky top-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs">{SECTION_ICONS[sourceType]}</span>
                        <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                          {section.label}
                        </span>
                        {agents.length > 0 && (
                          <span className="text-[10px] text-gray-400 dark:text-gray-500">
                            ({sectionSelectedCount}/{agents.length})
                          </span>
                        )}
                      </div>
                      {!readOnly && agents.length > 0 && (
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleSectionAll(agents)}
                            className="text-[10px] text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 px-1 py-0.5"
                          >
                            All
                          </button>
                          <span className="text-gray-300 dark:text-gray-600">|</span>
                          <button
                            onClick={() => handleSectionNone(agents)}
                            className="text-[10px] text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 px-1 py-0.5"
                          >
                            None
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Agent list or empty hint */}
                    {agents.length === 0 ? (
                      <div className="px-3 py-2 text-[11px] text-gray-400 dark:text-gray-500 italic">
                        No agents found
                      </div>
                    ) : (
                      agents.map((agent) => {
                        const isSelected = selectedIds.includes(agent.id);
                        return (
                          <label
                            key={agent.id}
                            className={`flex items-start gap-2 px-3 py-1.5 ${readOnly ? 'opacity-60 cursor-default' : 'hover:bg-white/40 dark:hover:bg-gray-700/40 cursor-pointer'}`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggle(agent.id)}
                              className="mt-0.5 h-3.5 w-3.5 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                              disabled={readOnly}
                            />
                            <div className="flex-1 min-w-0">
                              <span className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate block">
                                {agent.display_name}
                              </span>
                              {agent.description && (
                                <div className="text-[10px] text-gray-500 dark:text-gray-400 truncate mt-0.5">
                                  {agent.description.length > 80 ? agent.description.slice(0, 80) + '…' : agent.description}
                                </div>
                              )}
                            </div>
                          </label>
                        );
                      })
                    )}
                  </div>
                );
              })
            ) : availableAgents ? (
              // Legacy flat mode (AgentEditor)
              <>
                <div className="p-2 border-b border-white/40 dark:border-gray-700">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Sub-Agents</span>
                    {!readOnly && (
                      <div className="flex gap-1">
                        <button onClick={handleLegacyAll} className="text-[10px] text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 px-1.5 py-0.5">All</button>
                        <span className="text-gray-300 dark:text-gray-600">|</span>
                        <button onClick={handleLegacyNone} className="text-[10px] text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 px-1.5 py-0.5">None</button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="py-1">
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
                          className="mt-0.5 h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                          disabled={readOnly}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm">{agent.icon}</span>
                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{agent.name}</span>
                          </div>
                          {agent.description && (
                            <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate mt-0.5">{agent.description}</div>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
