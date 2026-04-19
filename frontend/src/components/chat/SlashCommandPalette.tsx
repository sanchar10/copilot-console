import { useState, useEffect, useRef, useCallback } from 'react';
import type { SlashCommand } from './slashCommands';
import { filterCommands } from './slashCommands';

export interface AgentPickerItem {
  /** Agent name as registered in SDK custom_agents */
  name: string;
  /** Display label */
  displayName: string;
  /** Optional description */
  description?: string;
  /** True for the "Copilot (default)" entry */
  isDefault?: boolean;
}

interface SlashCommandPaletteProps {
  /** Current text after the '/' (for filtering) */
  query: string;
  /** Called when user selects a command */
  onSelect: (command: SlashCommand) => void;
  /** Called when user dismisses the palette */
  onDismiss: () => void;
  /** Available agents for the /agent submenu */
  agentItems?: AgentPickerItem[];
  /** Called when user selects an agent from the submenu (null = deselect / default) */
  onAgentSelect?: (agentName: string | null) => void;
}

export function SlashCommandPalette({ query, onSelect, onDismiss, agentItems, onAgentSelect }: SlashCommandPaletteProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [submenuCommand, setSubmenuCommand] = useState<SlashCommand | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const commands = filterCommands(query);

  // Build the effective submenu items list
  const submenuItems: AgentPickerItem[] = submenuCommand
    ? [{ name: '__default__', displayName: 'Copilot (default)', isDefault: true }, ...(agentItems || [])]
    : [];

  // Reset selection when query or submenu changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query, submenuCommand]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onDismiss();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onDismiss]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (submenuCommand) {
        // Second-level: agent list navigation
        if (submenuItems.length === 0) return;
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex((i) => (i + 1) % submenuItems.length);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex((i) => (i - 1 + submenuItems.length) % submenuItems.length);
        } else if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          const item = submenuItems[selectedIndex];
          onAgentSelect?.(item.isDefault ? null : item.name);
          setSubmenuCommand(null);
          onDismiss();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setSubmenuCommand(null); // back to first level
        }
      } else {
        // First-level: command list navigation
        if (commands.length === 0) return;
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex((i) => (i + 1) % commands.length);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex((i) => (i - 1 + commands.length) % commands.length);
        } else if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          const cmd = commands[selectedIndex];
          if (cmd.interaction === 'submenu') {
            setSubmenuCommand(cmd);
          } else {
            onSelect(cmd);
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onDismiss();
        }
      }
    },
    [commands, submenuItems, selectedIndex, onSelect, onDismiss, onAgentSelect, submenuCommand],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!submenuCommand && commands.length === 0) return null;

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 mb-1 w-64 bg-gray-50 dark:bg-[#232336] border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl z-50 py-1 max-h-[40vh] overflow-y-auto"
    >
      {submenuCommand ? (
        <>
          {/* Submenu header */}
          <button
            onClick={() => setSubmenuCommand(null)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide hover:text-gray-600 dark:hover:text-gray-300"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Select Agent
          </button>
          {submenuItems.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500 italic">
              No agents available — add sub-agents first
            </div>
          ) : (
            submenuItems.map((item, idx) => (
              <button
                key={item.name}
                onClick={() => {
                  onAgentSelect?.(item.isDefault ? null : item.name);
                  setSubmenuCommand(null);
                  onDismiss();
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                  idx === selectedIndex
                    ? 'bg-blue-50 dark:bg-blue-500/20 text-blue-800 dark:text-blue-100'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#33334a]'
                }`}
              >
                <span className="text-base flex-shrink-0">{item.isDefault ? '✨' : '🤖'}</span>
                <div className="flex flex-col items-start min-w-0">
                  <span className={`font-medium ${item.isDefault ? 'italic' : ''}`}>{item.displayName}</span>
                  {item.description && (
                    <span className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-[180px]">{item.description}</span>
                  )}
                </div>
              </button>
            ))
          )}
        </>
      ) : (
        <>
          <div className="px-2 py-1 text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
            Commands
          </div>
          {commands.map((cmd, idx) => (
            <button
              key={cmd.name}
              onClick={() => {
                if (cmd.interaction === 'submenu') {
                  setSubmenuCommand(cmd);
                } else {
                  onSelect(cmd);
                }
              }}
              onMouseEnter={() => setSelectedIndex(idx)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                idx === selectedIndex
                  ? 'bg-blue-50 dark:bg-blue-500/20 text-blue-800 dark:text-blue-100'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#33334a]'
              }`}
            >
              <span className="text-base flex-shrink-0">{cmd.icon}</span>
              <div className="flex flex-col items-start min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">/{cmd.name}</span>
                  {cmd.usage && <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">{cmd.usage}</span>}
                </div>
                <span className="text-xs text-gray-400 dark:text-gray-500 truncate">{cmd.description}</span>
              </div>
              {cmd.interaction === 'submenu' && (
                <svg className="w-3 h-3 ml-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
