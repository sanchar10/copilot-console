import { useState, useEffect } from 'react';
import { MCPSelector } from '../chat/MCPSelector';
import { ToolsSelector } from '../chat/ToolsSelector';
import { SubAgentSelector } from '../chat/SubAgentSelector';
import { TokenUsageSlider } from '../chat/TokenUsageSlider';
import { RelatedSessions } from '../chat/RelatedSessions';
import { FolderBrowserModal } from '../common/FolderBrowserModal';
import { SystemPromptEditor } from '../common/SystemPromptEditor';
import { useProjectStore } from '../../stores/projectStore';
import type { MCPServer, MCPServerSelections } from '../../types/mcp';
import type { ToolInfo, ToolSelections } from '../../api/tools';
import type { AgentTools, SystemMessage, Agent } from '../../types/agent';
import type { Session } from '../../types/session';

/** Convert string[] to Record<string, boolean> for selector components */
function listToSelections(list: string[], allItems: { name: string }[]): Record<string, boolean> {
  const selections: Record<string, boolean> = {};
  for (const item of allItems) {
    selections[item.name] = list.includes(item.name);
  }
  return selections;
}

/** Convert Record<string, boolean> back to string[] (only enabled names) */
function selectionsToList(selections: Record<string, boolean>): string[] {
  return Object.entries(selections)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
}

interface Model {
  id: string;
  name: string;
}

interface HeaderProps {
  sessionName?: string;
  model?: string;
  cwd?: string;
  isNewSession?: boolean;
  availableModels?: Model[];
  availableMcpServers?: MCPServer[];
  mcpSelections?: string[];
  availableTools?: ToolInfo[];
  toolSelections?: AgentTools;
  systemMessage?: SystemMessage | null;
  tokenUsage?: { tokenLimit: number; currentTokens: number; messagesLength: number } | null;
  hasActiveResponse?: boolean;
  sessions?: Session[];
  currentSessionId?: string;
  openTabs?: string[];
  eligibleSubAgents?: Agent[];
  subAgentSelections?: string[];
  onRelatedSessionClick?: (sessionId: string) => void;
  onNameChange?: (newName: string) => void;
  onModelChange?: (newModel: string) => void;
  onCwdChange?: (newCwd: string) => void;
  onMcpSelectionsChange?: (selections: string[]) => void;
  onToolSelectionsChange?: (selections: AgentTools) => void;
  onSystemMessageChange?: (systemMessage: SystemMessage | null) => void;
  onSubAgentSelectionsChange?: (selections: string[]) => void;
  cwdError?: string | null;
}

export function Header({ 
  sessionName, 
  model, 
  cwd, 
  isNewSession = false,
  availableModels = [],
  availableMcpServers = [],
  mcpSelections = [],
  availableTools = [],
  toolSelections = { custom: [], builtin: [], excluded_builtin: [] },
  systemMessage,
  tokenUsage = null,
  hasActiveResponse = false,
  sessions = [],
  currentSessionId,
  openTabs = [],
  onRelatedSessionClick,
  onNameChange,
  onModelChange,
  onCwdChange,
  onMcpSelectionsChange,
  onToolSelectionsChange,
  onSystemMessageChange,
  eligibleSubAgents = [],
  subAgentSelections = [],
  onSubAgentSelectionsChange,
  cwdError 
}: HeaderProps) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState(sessionName || '');
  const [isEditingCwd, setIsEditingCwd] = useState(false);
  const [editCwd, setEditCwd] = useState(cwd || '');
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);

  // Sync edit states with props
  useEffect(() => {
    setEditName(sessionName || '');
  }, [sessionName]);

  useEffect(() => {
    setEditCwd(cwd || '');
  }, [cwd]);

  // Name editing
  const handleNameClick = () => {
    if (onNameChange) {
      setEditName(sessionName || '');
      setIsEditingName(true);
    }
  };

  const handleNameSave = () => {
    if (onNameChange && editName.trim()) {
      onNameChange(editName.trim());
    }
    setIsEditingName(false);
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleNameSave();
    } else if (e.key === 'Escape') {
      setIsEditingName(false);
      setEditName(sessionName || '');
    }
  };

  // CWD editing
  const handleCwdClick = () => {
    if (onCwdChange && cwd && !hasActiveResponse) {
      setEditCwd(cwd);
      setIsEditingCwd(true);
    }
  };

  const handleCwdSave = () => {
    if (onCwdChange && editCwd.trim()) {
      onCwdChange(editCwd.trim());
    }
    setIsEditingCwd(false);
  };

  const handleCwdKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCwdSave();
    } else if (e.key === 'Escape') {
      setIsEditingCwd(false);
      setEditCwd(cwd || '');
    }
  };

  // Model selection (only for new sessions)
  const handleModelClick = () => {
    if (isNewSession && onModelChange && availableModels.length > 0) {
      setShowModelDropdown(!showModelDropdown);
    }
  };

  const handleModelSelect = (modelId: string) => {
    if (onModelChange) {
      onModelChange(modelId);
    }
    setShowModelDropdown(false);
  };

  // Format CWD for display (show last 2-3 path segments)
  const formatCwd = (path: string) => {
    if (!path) return '';
    const segments = path.replace(/\\/g, '/').split('/').filter(Boolean);
    if (segments.length <= 3) return path;
    return '.../' + segments.slice(-2).join('/');
  };

  // Get model display name
  const modelName = availableModels.find(m => m.id === model)?.name || model;

  return (
    <header className="h-14 border-b border-gray-100 dark:border-[#3a3a4e] bg-white dark:bg-[#252536] shadow-sm dark:shadow-black/20 flex items-center px-6 relative z-20">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {sessionName ? (
          <>
            {/* Session Name - clickable to edit */}
            {isEditingName ? (
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={handleNameKeyDown}
                onBlur={handleNameSave}
                className="font-medium text-gray-900 dark:text-gray-100 px-2 py-0.5 border border-blue-300 dark:border-blue-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 w-[200px] dark:bg-[#2a2a3c]"
                autoFocus
              />
            ) : (
              <h2 
                className={`font-medium text-gray-900 dark:text-gray-100 w-[200px] truncate ${onNameChange ? 'cursor-pointer hover:text-blue-600 dark:hover:text-blue-400' : ''}`}
                onClick={handleNameClick}
                title={sessionName || (onNameChange ? 'Click to edit session name' : undefined)}
              >
                {sessionName}
              </h2>
            )}

            {/* Separator */}
            <div className="h-5 w-[2px] bg-gray-300 dark:bg-gray-600 mx-0.5" />

            {/* Model badge - clickable dropdown for new sessions, static for existing */}
            {model && (
              <div className="relative">
                <button
                  onClick={handleModelClick}
                  className={`min-w-[80px] h-[30px] px-2.5 py-1 text-xs font-medium rounded-md flex items-center gap-1.5 transition-colors duration-150 ${
                    isNewSession 
                      ? 'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/50 cursor-pointer' 
                      : 'bg-gray-100 dark:bg-[#2a2a3c] text-gray-600 dark:text-gray-400 cursor-default'
                  }`}
                  title={isNewSession ? 'Click to change model' : 'Model cannot be changed after session starts'}
                >
                  {modelName}
                  {isNewSession && (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  )}
                </button>
                
                {/* Model dropdown */}
                {showModelDropdown && (
                  <div className="absolute top-full left-0 mt-1 bg-white dark:bg-[#2a2a3c] border dark:border-[#3a3a4e] rounded-md shadow-lg dark:shadow-black/20 z-50 min-w-[150px] max-h-60 overflow-y-auto">
                    {availableModels.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => handleModelSelect(m.id)}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-[#32324a] ${
                          m.id === model ? 'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400' : 'text-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {m.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* System Prompt */}
            {onSystemMessageChange && (
              <SystemPromptEditor
                value={systemMessage}
                onChange={onSystemMessageChange}
                variant="compact"
                disabled={!isNewSession || hasActiveResponse}
              />
            )}

            {/* Tools selector */}
            {onToolSelectionsChange && (
              <ToolsSelector
                availableTools={availableTools}
                selections={listToSelections(toolSelections.custom, availableTools)}
                onSelectionsChange={(s: ToolSelections) => onToolSelectionsChange({ ...toolSelections, custom: selectionsToList(s) })}
                builtinTools={toolSelections.builtin}
                excludedBuiltinTools={toolSelections.excluded_builtin}
                onBuiltinToolsChange={isNewSession ? (builtin, excluded) => onToolSelectionsChange({ ...toolSelections, builtin, excluded_builtin: excluded }) : undefined}
                readOnly={hasActiveResponse}
                subAgentsActive={subAgentSelections.length > 0}
              />
            )}

            {/* MCP Server selector */}
            {availableMcpServers.length > 0 && onMcpSelectionsChange && (
              <MCPSelector
                availableServers={availableMcpServers}
                selections={listToSelections(mcpSelections, availableMcpServers)}
                onSelectionsChange={(s: MCPServerSelections) => onMcpSelectionsChange(selectionsToList(s))}
                readOnly={hasActiveResponse}
              />
            )}

            {/* Sub-Agent selector (Agent Teams) */}
            {eligibleSubAgents.length > 0 && onSubAgentSelectionsChange && (
              <SubAgentSelector
                availableAgents={eligibleSubAgents}
                selectedIds={subAgentSelections}
                onSelectionChange={onSubAgentSelectionsChange}
                readOnly={hasActiveResponse}
                disabled={toolSelections.custom.length > 0 || toolSelections.builtin.length > 0}
                disabledReason={
                  (toolSelections.custom.length > 0 || toolSelections.builtin.length > 0)
                    ? 'Sub-agents cannot be used with custom or builtin tools (SDK limitation)'
                    : undefined
                }
              />
            )}

            {/* Project badge */}
            {cwd && !isEditingCwd && (() => {
              const projName = useProjectStore.getState().getProjectName(cwd);
              return projName ? (
                <span
                  className="h-[30px] px-2 py-1 text-xs font-medium bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 rounded-md flex items-center gap-1 flex-shrink-0"
                  title={`Project: ${projName}`}
                >
                  <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                  <span className="truncate max-w-[120px]">{projName}</span>
                </span>
              ) : null;
            })()}

            {/* CWD badge - clickable to edit */}
            {cwd && !isEditingCwd && (
              <div className="flex items-center gap-0.5 max-w-[200px] h-[30px]">
                <button
                  onClick={handleCwdClick}
                  className="h-[30px] px-2.5 py-1 text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-l-md hover:bg-blue-100 dark:hover:bg-blue-900/50 flex items-center gap-1.5 transition-colors duration-150 min-w-0"
                  title={`Working directory: ${cwd}\nClick to change`}
                >
                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  <span className="truncate">{formatCwd(cwd)}</span>
                </button>
                {onCwdChange && (
                  <button
                    onClick={() => !hasActiveResponse && setShowFolderBrowser(true)}
                    className={`h-[30px] px-1.5 py-1 text-xs rounded-r-md border-l border-blue-200 dark:border-blue-800 transition-colors duration-150 flex items-center ${
                      hasActiveResponse ? 'bg-gray-100 dark:bg-[#2a2a3c] text-gray-400 dark:text-gray-500 cursor-not-allowed' : 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50'
                    }`}
                    title={hasActiveResponse ? 'Cannot change folder while response is active' : 'Browse for folder'}
                    disabled={hasActiveResponse}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
                    </svg>
                  </button>
                )}
              </div>
            )}
            {isEditingCwd && (
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={editCwd}
                  onChange={(e) => setEditCwd(e.target.value)}
                  onKeyDown={handleCwdKeyDown}
                  onBlur={handleCwdSave}
                  className={`h-[30px] px-2.5 py-1 text-xs font-medium border rounded-md focus:outline-none focus:ring-1 w-64 dark:bg-[#2a2a3c] dark:text-gray-100 ${
                    cwdError ? 'border-red-300 dark:border-red-600 focus:ring-red-500' : 'border-blue-300 dark:border-blue-600 focus:ring-blue-500'
                  }`}
                  autoFocus
                  placeholder="Enter working directory path"
                />
                <button
                  onClick={() => setShowFolderBrowser(true)}
                  className="h-[30px] px-1.5 py-1 text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-md hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors duration-150 flex items-center"
                  title="Browse for folder"
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
                  </svg>
                </button>
              </div>
            )}
            {cwdError && (
              <span className="text-xs text-red-600 dark:text-red-400">{cwdError}</span>
            )}

            {/* Folder Browser Modal */}
            {onCwdChange && (
              <FolderBrowserModal
                isOpen={showFolderBrowser}
                onClose={() => setShowFolderBrowser(false)}
                onSelect={(path) => {
                  onCwdChange(path);
                  setEditCwd(path);
                  setIsEditingCwd(false);
                }}
                initialPath={cwd}
              />
            )}

            {/* Sessions using same folder */}
            {cwd && onRelatedSessionClick && !cwdError && (
              <RelatedSessions
                sessions={sessions}
                currentSessionId={currentSessionId}
                cwd={cwd}
                openTabs={openTabs}
                onSessionClick={onRelatedSessionClick}
              />
            )}

            {/* Token usage slider - right aligned, only for existing sessions */}
            {!isNewSession && (
              <div className="ml-auto">
                <TokenUsageSlider
                  tokenLimit={tokenUsage?.tokenLimit}
                  currentTokens={tokenUsage?.currentTokens}
                  messagesLength={tokenUsage?.messagesLength}
                  isActive={hasActiveResponse}
                />
              </div>
            )}
          </>
        ) : (
          <h2 className="text-gray-500 dark:text-gray-400">Select or create a session</h2>
        )}
      </div>

      {/* Close dropdown when clicking outside */}
      {showModelDropdown && (
        <div 
          className="fixed inset-0 z-0" 
          onClick={() => setShowModelDropdown(false)}
        />
      )}
    </header>
  );
}
