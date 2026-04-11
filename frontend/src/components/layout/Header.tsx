import { useState, useEffect } from 'react';
import { MCPSelector } from '../chat/MCPSelector';
import { ToolsSelector } from '../chat/ToolsSelector';
import { SubAgentSelector } from '../chat/SubAgentSelector';
import { TokenUsageSlider } from '../chat/TokenUsageSlider';
import { RelatedSessions } from '../chat/RelatedSessions';
import { FolderBrowserModal } from '../common/FolderBrowserModal';
import { SystemPromptEditor } from '../common/SystemPromptEditor';
import { ModelSelector } from '../common/ModelSelector';
import { useProjectStore } from '../../stores/projectStore';
import type { DiscoverableAgentsResponse } from '../../types/agent';
import type { MCPServer, MCPServerSelections } from '../../types/mcp';
import type { ToolInfo, ToolSelections } from '../../api/tools';
import type { AgentTools, SystemMessage, Agent } from '../../types/agent';
import type { Session } from '../../types/session';
import type { Model } from '../../api/models';

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

interface HeaderProps {
  sessionName?: string;
  model?: string;
  reasoningEffort?: string | null;
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
  isActivating?: boolean;
  sessions?: Session[];
  currentSessionId?: string;
  openTabs?: string[];
  eligibleSubAgents?: Agent[];
  discoverableAgents?: DiscoverableAgentsResponse;
  subAgentSelections?: string[];


  onRelatedSessionClick?: (sessionId: string) => void;
  onNameChange?: (newName: string) => void;
  onModelChange?: (newModel: string, reasoningEffort?: string | null) => void;
  onReasoningEffortChange?: (effort: string | null) => void;
  onCwdChange?: (newCwd: string) => void;
  onMcpSelectionsChange?: (selections: string[]) => void;
  onToolSelectionsChange?: (selections: AgentTools) => void;
  onSystemMessageChange?: (systemMessage: SystemMessage | null) => void;
  onSubAgentSelectionsChange?: (selections: string[]) => void;
}

export function Header({ 
  sessionName, 
  model,
  reasoningEffort,
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
  isActivating = false,
  sessions = [],
  currentSessionId,
  openTabs = [],
  eligibleSubAgents = [],
  discoverableAgents,
  subAgentSelections = [],
  onRelatedSessionClick,
  onNameChange,
  onModelChange,
  onReasoningEffortChange,
  onCwdChange,
  onMcpSelectionsChange,
  onToolSelectionsChange,
  onSystemMessageChange,
  onSubAgentSelectionsChange,
}: HeaderProps) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState(sessionName || '');
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const projects = useProjectStore(s => s.projects);

  // Derive project name reactively from subscribed projects state
  const projectDisplayName = (() => {
    if (!cwd) return '';
    const norm = cwd.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    for (const [storedCwd, name] of Object.entries(projects)) {
      if (storedCwd.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === norm) {
        return name;
      }
    }
    const segments = cwd.replace(/\\/g, '/').replace(/\/+$/, '').split('/');
    return segments.pop() || cwd;
  })();

  // Sync edit states with props
  useEffect(() => {
    setEditName(sessionName || '');
  }, [sessionName]);

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

  return (
    <header className="h-14 border-b border-gray-100 dark:border-[#3a3a4e] bg-white dark:bg-[#252536] shadow-sm dark:shadow-black/20 flex items-center px-6 relative z-20">
      <div className="flex items-center gap-3 flex-1 min-w-0 [&>*]:flex-shrink-0">
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

            {/* System Prompt — locked after session creation */}
            {onSystemMessageChange && (
              <SystemPromptEditor
                value={systemMessage}
                onChange={onSystemMessageChange}
                variant="compact"
                disabled={!isNewSession || hasActiveResponse}
              />
            )}

            {/* Model badge - changeable anytime */}
            {model && (
              <ModelSelector
                models={availableModels}
                selectedModelId={model}
                reasoningEffort={reasoningEffort || null}
                onModelChange={(modelId, effort) => {
                  if (onModelChange) onModelChange(modelId, effort);
                }}
                onReasoningEffortChange={onReasoningEffortChange}
                disabled={false}
                readOnly={isActivating}
                variant="compact"
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
            {((discoverableAgents && Object.values(discoverableAgents).some(s => s.agents.length > 0)) || eligibleSubAgents.length > 0) && onSubAgentSelectionsChange && (
              <SubAgentSelector
                discoverableAgents={discoverableAgents}
                availableAgents={!discoverableAgents ? eligibleSubAgents : undefined}
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

            {/* CWD badge - single button, click opens folder browser */}
            {cwd && (
              <button
                onClick={() => onCwdChange && setShowFolderBrowser(true)}
                className={`h-[30px] px-2.5 py-1 text-xs font-medium rounded-md flex items-center gap-1.5 transition-colors duration-150 min-w-0 max-w-[200px] bg-blue-50 dark:bg-blue-900/[0.18] text-blue-700 dark:text-blue-300 border border-blue-200/60 dark:border-blue-500/35 ${
                  !onCwdChange
                    ? 'cursor-default'
                    : 'hover:bg-blue-100 dark:hover:bg-blue-900/50'
                }`}
                title={`${cwd}\nClick to change folder`}
                disabled={!onCwdChange}
              >
                <svg className="w-3.5 h-3.5 flex-shrink-0 translate-y-[0.5px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <span className="truncate">{projectDisplayName}</span>
              </button>
            )}

            {/* Folder Browser Modal */}
            {onCwdChange && (
              <FolderBrowserModal
                isOpen={showFolderBrowser}
                onClose={() => setShowFolderBrowser(false)}
                onSelect={(path) => {
                  onCwdChange(path);
                }}
                initialPath={cwd}
                disableSelect={hasActiveResponse || isActivating}
                disableSelectReason={isActivating ? 'Please wait, session is activating...' : hasActiveResponse ? 'Please wait, agent is responding...' : undefined}
              />
            )}

            {/* Sessions using same project folder */}
            {cwd && onRelatedSessionClick && (
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
              <div className="ml-auto flex items-center gap-2">
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
    </header>
  );
}
