import { useState, useRef, useEffect } from 'react';
import type { MCPServer, MCPServerSelections } from '../../types/mcp';

interface MCPSelectorProps {
  availableServers: MCPServer[];
  selections: MCPServerSelections;
  onSelectionsChange: (selections: MCPServerSelections) => void;
  disabled?: boolean;
  /** When true, dropdown opens for viewing but all controls inside are disabled */
  readOnly?: boolean;
}

export function MCPSelector({
  availableServers,
  selections,
  onSelectionsChange,
  disabled = false,
  readOnly = false,
}: MCPSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  // Count enabled servers
  const enabledCount = availableServers.filter(
    (server) => selections[server.name] !== false
  ).length;

  const handleToggle = (serverName: string) => {
    const currentValue = selections[serverName] !== false;
    onSelectionsChange({
      ...selections,
      [serverName]: !currentValue,
    });
  };

  const handleSelectAll = () => {
    const allEnabled: MCPServerSelections = {};
    availableServers.forEach((server) => {
      allEnabled[server.name] = true;
    });
    onSelectionsChange(allEnabled);
  };

  const handleDeselectAll = () => {
    const allDisabled: MCPServerSelections = {};
    availableServers.forEach((server) => {
      allDisabled[server.name] = false;
    });
    onSelectionsChange(allDisabled);
  };

  if (availableServers.length === 0) {
    return null;
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md
          transition-colors duration-150
          ${disabled 
            ? 'bg-gray-100/80 dark:bg-gray-800/80 text-gray-400 border border-gray-200/60 dark:border-gray-700/60 cursor-not-allowed' 
            : 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border border-blue-200/60 dark:border-blue-700/60 hover:bg-blue-100 dark:hover:bg-blue-800/40 cursor-pointer'
          }
        `}
        title={`${enabledCount}/${availableServers.length} MCP servers enabled`}
      >
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"
          />
        </svg>
        <span>MCP</span>
        <span className="bg-blue-200/80 dark:bg-blue-800/40 text-blue-800 dark:text-blue-300 px-1.5 py-0.5 rounded text-[10px] font-semibold min-w-[2.5rem] text-center">
          {enabledCount}/{availableServers.length}
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
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">MCP Servers</span>
              {!readOnly && (
              <div className="flex gap-1">
                <button
                  onClick={handleSelectAll}
                  className="text-[10px] text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 px-1.5 py-0.5"
                >
                  All
                </button>
                <span className="text-gray-300 dark:text-gray-600">|</span>
                <button
                  onClick={handleDeselectAll}
                  className="text-[10px] text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 px-1.5 py-0.5"
                >
                  None
                </button>
              </div>
              )}
            </div>
          </div>
          
          <div className="max-h-64 overflow-y-auto py-1">
            {availableServers.map((server) => {
              const isEnabled = selections[server.name] !== false;
              return (
                <label
                  key={server.name}
                  className={`flex items-start gap-2 px-3 py-2 ${readOnly ? 'opacity-60 cursor-default' : 'hover:bg-white/40 dark:hover:bg-gray-700/40 cursor-pointer'}`}
                >
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    onChange={() => handleToggle(server.name)}
                    className="mt-0.5 h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                    disabled={readOnly}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {server.name}
                      </span>
                      <span className="text-[10px] text-gray-400 bg-white/50 dark:bg-gray-700/50 px-1 py-0.5 rounded">
                        {server.source}
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-500 truncate mt-0.5">
                      {server.url 
                        ? server.url 
                        : `${server.command || ''} ${(server.args || []).join(' ')}`}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
          
          {availableServers.length === 0 && (
            <div className="px-3 py-4 text-center text-sm text-gray-500">
              No MCP servers configured
            </div>
          )}
        </div>
      )}
    </div>
  );
}
