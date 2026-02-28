import { useRef, useEffect, useCallback, useState, memo } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { useChatStore } from '../../stores/chatStore';
import { useUIStore } from '../../stores/uiStore';
import { useTabStore } from '../../stores/tabStore';
import { MessageBubble } from './MessageBubble';
import { StreamingMessage } from './StreamingMessage';
import { InputBox, clearReadySession } from './InputBox';
import { TabBar } from './TabBar';
import { Header } from '../layout/Header';
import { AgentLibrary } from '../agents/AgentLibrary';
import { AgentEditor } from '../agents/AgentEditor';
import { AutomationManager } from '../automations/AutomationManager';
import { TaskBoard } from '../taskboard/TaskBoard';
import { TaskRunDetail } from '../taskboard/TaskRunDetail';
import { WorkflowLibrary } from '../workflows/WorkflowLibrary';
import { WorkflowEditor } from '../workflows/WorkflowEditor';
import { WorkflowRunView } from '../workflows/WorkflowRunView';
import { updateSession, getSession } from '../../api/sessions';
import { getAgent, getEligibleSubAgents } from '../../api/agents';
import type { AgentTools, SystemMessage, Agent, StarterPrompt } from '../../types/agent';

/**
 * Per-session tab content — owns its own scroll position, header, messages, and input.
 * Stays mounted when hidden so scroll position and DOM are preserved.
 */
const SessionTabContent = memo(function SessionTabContent({ sessionId, isActive }: { sessionId: string; isActive: boolean }) {
  const { sessions, availableMcpServers, availableTools, setSessions, updateSessionMcpServers, updateSessionTools } = useSessionStore();
  const { messagesPerSession, getStreamingState, getTokenUsage } = useChatStore();
  const { availableModels } = useUIStore();
  const { tabs, openTab: openGenericTab, switchTab: switchGenericTab } = useTabStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const isProgrammaticScrollRef = useRef(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [eligibleSubAgents, setEligibleSubAgents] = useState<Agent[]>([]);
  const [starterPrompts, setStarterPrompts] = useState<StarterPrompt[]>([]);
  const [promptToSend, setPromptToSend] = useState<string | null>(null);

  const session = sessions.find((s) => s.session_id === sessionId);
  const rawMessages = messagesPerSession[sessionId];
  const isLoadingMessages = rawMessages === undefined;
  const messages = rawMessages || [];
  const { content: streamingContent, steps: streamingSteps, isStreaming } = getStreamingState(sessionId);
  const tokenUsage = getTokenUsage(sessionId);

  // Show spinner only after 300ms delay to avoid flash on fast loads
  const [showSpinner, setShowSpinner] = useState(false);
  useEffect(() => {
    if (!isLoadingMessages) { setShowSpinner(false); return; }
    const timer = setTimeout(() => setShowSpinner(true), 300);
    return () => clearTimeout(timer);
  }, [isLoadingMessages]);

  // Check if scroll container is near bottom (within threshold)
  const isNearBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  }, []);

  // Handle user scroll — detect if they scrolled away from bottom
  const handleScroll = useCallback(() => {
    if (isProgrammaticScrollRef.current) return;
    const nearBottom = isNearBottom();
    userScrolledUpRef.current = !nearBottom;
    setShowScrollButton(!nearBottom && isStreaming);
  }, [isNearBottom, isStreaming]);

  // Auto-scroll: only when user hasn't scrolled up
  useEffect(() => {
    if (isActive && !userScrolledUpRef.current) {
      isProgrammaticScrollRef.current = true;
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
      // Reset flag after scroll event fires
      requestAnimationFrame(() => { isProgrammaticScrollRef.current = false; });
    }
  }, [messages, streamingContent, streamingSteps, isActive]);

  // Re-engage auto-scroll when streaming stops
  useEffect(() => {
    if (!isStreaming) {
      userScrolledUpRef.current = false;
      setShowScrollButton(false);
    }
  }, [isStreaming]);

  // Scroll-to-bottom handler for the button
  const scrollToBottom = useCallback(() => {
    userScrolledUpRef.current = false;
    setShowScrollButton(false);
    isProgrammaticScrollRef.current = true;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    requestAnimationFrame(() => { isProgrammaticScrollRef.current = false; });
  }, []);

  // Handlers
  const handleNameChange = useCallback(async (newName: string) => {
    try {
      const updatedSession = await updateSession(sessionId, { name: newName });
      setSessions(sessions.map(s =>
        s.session_id === sessionId ? { ...s, session_name: updatedSession.session_name } : s
      ));
    } catch (error) {
      console.error('Failed to update name:', error);
    }
  }, [sessionId, sessions, setSessions]);

  const handleCwdChange = useCallback(async (newCwd: string) => {
    try {
      const updatedSession = await updateSession(sessionId, { cwd: newCwd });
      setSessions(sessions.map(s =>
        s.session_id === sessionId ? { ...s, cwd: updatedSession.cwd } : s
      ));
      // Backend destroys SessionClient on CWD change — mark session as not ready
      clearReadySession(sessionId);
    } catch (error) {
      console.error('Failed to update CWD:', error);
    }
  }, [sessionId, sessions, setSessions]);

  const handleMcpSelectionsChange = useCallback(async (mcpServers: string[]) => {
    try {
      await updateSession(sessionId, { mcp_servers: mcpServers });
      updateSessionMcpServers(sessionId, mcpServers);
      // Backend destroys SessionClient on MCP change — mark session as not ready
      clearReadySession(sessionId);
    } catch (error) {
      console.error('Failed to update MCP servers:', error);
    }
  }, [sessionId, updateSessionMcpServers]);

  const handleToolSelectionsChange = useCallback(async (tools: AgentTools) => {
    try {
      await updateSession(sessionId, { tools });
      updateSessionTools(sessionId, tools);
      // Backend destroys SessionClient on tools change — mark session as not ready
      clearReadySession(sessionId);
    } catch (error) {
      console.error('Failed to update tools:', error);
    }
  }, [sessionId, updateSessionTools]);

  const handleSystemMessageChange = useCallback(async (systemMessage: SystemMessage | null) => {
    try {
      await updateSession(sessionId, { system_message: systemMessage });
      setSessions(sessions.map(s => 
        s.session_id === sessionId ? { ...s, system_message: systemMessage } : s
      ));
      clearReadySession(sessionId);
    } catch (error) {
      console.error('Failed to update system message:', error);
    }
  }, [sessionId, sessions, setSessions]);

  const handleSubAgentSelectionsChange = useCallback(async (subAgents: string[]) => {
    try {
      await updateSession(sessionId, { sub_agents: subAgents });
      setSessions(sessions.map(s =>
        s.session_id === sessionId ? { ...s, sub_agents: subAgents } : s
      ));
      clearReadySession(sessionId);
    } catch (error) {
      console.error('Failed to update sub-agents:', error);
    }
  }, [sessionId, sessions, setSessions]);

  // Fetch eligible sub-agents (exclude session's own agent)
  useEffect(() => {
    const agentId = session?.agent_id;
    getEligibleSubAgents(agentId || undefined)
      .then(setEligibleSubAgents)
      .catch(() => setEligibleSubAgents([]));
  }, [session?.agent_id]);

  // Fetch starter prompts from agent definition
  useEffect(() => {
    const agentId = session?.agent_id;
    if (agentId) {
      getAgent(agentId)
        .then((agent) => setStarterPrompts(agent.starter_prompts || []))
        .catch(() => setStarterPrompts([]));
    }
  }, [session?.agent_id]);

  const handleRelatedSessionClick= useCallback(async (targetSessionId: string) => {
    const { messagesPerSession, setMessages } = useChatStore.getState();
    const targetTabId = `session:${targetSessionId}`;
    if (useTabStore.getState().isTabOpen(targetTabId)) {
      switchGenericTab(targetTabId);
      return;
    }
    try {
      if (!messagesPerSession[targetSessionId]) {
        const sessionData = await getSession(targetSessionId);
        setMessages(targetSessionId, sessionData.messages);
      }
      openGenericTab({ id: targetTabId, type: 'session', label: 'Session', sessionId: targetSessionId });
    } catch (err) {
      console.error('Failed to open related session:', err);
    }
  }, [openGenericTab, switchGenericTab]);

  return (
    <div
      className="flex-1 flex flex-col h-full overflow-hidden"
      style={{ display: isActive ? 'flex' : 'none' }}
    >
      <Header
        sessionName={session?.session_name}
        model={session?.model}
        cwd={session?.cwd}
        isNewSession={false}
        availableModels={availableModels}
        availableMcpServers={availableMcpServers}
        mcpSelections={session?.mcp_servers || []}
        availableTools={availableTools}
        toolSelections={session?.tools || { custom: [], builtin: [], excluded_builtin: [] }}
        systemMessage={session?.system_message}
        tokenUsage={tokenUsage}
        hasActiveResponse={isStreaming}
        sessions={sessions}
        currentSessionId={sessionId}
        openTabs={tabs.filter((t) => t.type === 'session' && t.sessionId).map((t) => t.sessionId!)}
        onRelatedSessionClick={handleRelatedSessionClick}
        onNameChange={handleNameChange}
        onCwdChange={handleCwdChange}
        onMcpSelectionsChange={handleMcpSelectionsChange}
        onToolSelectionsChange={handleToolSelectionsChange}
        onSystemMessageChange={handleSystemMessageChange}
        eligibleSubAgents={eligibleSubAgents}
        subAgentSelections={session?.sub_agents || []}
        onSubAgentSelectionsChange={handleSubAgentSelectionsChange}
      />

      {/* Messages Area */}
      <div className="relative flex-1 min-h-0">
        <div ref={scrollContainerRef} onScroll={handleScroll} className="absolute inset-0 overflow-y-auto p-4">
          <div className="max-w-4xl mx-auto space-y-6">
            {isLoadingMessages && showSpinner ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
                <svg className="w-6 h-6 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <p className="text-sm">Loading messages...</p>
              </div>
            ) : messages.length === 0 && !isStreaming ? (
              <div className="flex flex-col items-center justify-center h-full gap-4">
                <p className="text-gray-400">Start a conversation...</p>
                {starterPrompts.length > 0 && (
                  <div className="w-full max-w-4xl mx-auto space-y-2 px-4">
                    {starterPrompts.map((sp, idx) => (
                      <button
                        key={idx}
                        onClick={() => setPromptToSend(sp.prompt)}
                        title={sp.prompt}
                        className="w-full text-left px-4 py-2.5 rounded-lg border border-white/40 dark:border-[#3a3a4e] bg-white/50 dark:bg-[#2a2a3c]/50 hover:bg-white/80 dark:hover:bg-[#2a2a3c]/80 transition-colors"
                      >
                        <div className="font-medium text-gray-700 dark:text-gray-200">{sp.title}</div>
                        <div className="text-sm text-gray-500 dark:text-gray-400 truncate">{sp.prompt}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                {messages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
                {isStreaming && <StreamingMessage content={streamingContent} steps={streamingSteps} />}
              </>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>
        {/* Scroll-to-bottom button */}
        {showScrollButton && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/80 dark:bg-[#2a2a3c]/80 backdrop-blur text-gray-700 dark:text-gray-200 px-3 py-1.5 rounded-full shadow-lg border border-white/40 dark:border-gray-700 text-sm flex items-center gap-1.5 hover:bg-white/95 dark:hover:bg-[#2a2a3c]/95 transition-colors z-10"
          >
            ↓ New messages
          </button>
        )}
      </div>

      {/* Input Area */}
      <InputBox sessionId={sessionId} promptToSend={promptToSend} onPromptSent={() => setPromptToSend(null)} />
    </div>
  );
});

export function ChatPane() {
  const { sessions, isNewSession, newSessionSettings, availableMcpServers, availableTools, updateNewSessionSettings } = useSessionStore();
  const { availableModels } = useUIStore();
  const { tabs, activeTabId, openTab: openGenericTab, switchTab: switchGenericTab } = useTabStore();

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeSessionId = activeTab?.type === 'session' ? activeTab.sessionId || null : null;
  const openSessionIds = tabs.filter((t) => t.type === 'session' && t.sessionId).map((t) => t.sessionId!);

  // Handle new session settings changes (before first message)
  const handleNewSessionNameChange = useCallback((name: string) => {
    updateNewSessionSettings({ name });
  }, [updateNewSessionSettings]);

  const handleNewSessionModelChange = useCallback((model: string) => {
    updateNewSessionSettings({ model });
  }, [updateNewSessionSettings]);

  const handleNewSessionCwdChange = useCallback((cwd: string) => {
    updateNewSessionSettings({ cwd });
  }, [updateNewSessionSettings]);

  const handleNewSessionMcpChange = useCallback((mcpServers: string[]) => {
    updateNewSessionSettings({ mcpServers });
  }, [updateNewSessionSettings]);

  const handleNewSessionToolsChange = useCallback((tools: AgentTools) => {
    updateNewSessionSettings({ tools });
  }, [updateNewSessionSettings]);

  const handleNewSessionSystemMessageChange = useCallback((systemMessage: SystemMessage | null) => {
    updateNewSessionSettings({ systemMessage });
  }, [updateNewSessionSettings]);

  const handleNewSessionSubAgentChange = useCallback((subAgents: string[]) => {
    updateNewSessionSettings({ subAgents });
  }, [updateNewSessionSettings]);

  // Fetch eligible sub-agents for new session view
  const [newSessionEligibleSubAgents, setNewSessionEligibleSubAgents] = useState<Agent[]>([]);
  useEffect(() => {
    if (isNewSession) {
      const agentId = newSessionSettings?.agentId;
      getEligibleSubAgents(agentId || undefined)
        .then(setNewSessionEligibleSubAgents)
        .catch(() => setNewSessionEligibleSubAgents([]));
    }
  }, [isNewSession, newSessionSettings?.agentId]);

  // Fetch starter prompts for new session from agent
  const [newSessionStarterPrompts, setNewSessionStarterPrompts] = useState<StarterPrompt[]>([]);
  const [newSessionPromptToSend, setNewSessionPromptToSend] = useState<string | null>(null);
  useEffect(() => {
    if (isNewSession && newSessionSettings?.agentId) {
      getAgent(newSessionSettings.agentId)
        .then((agent) => setNewSessionStarterPrompts(agent.starter_prompts || []))
        .catch(() => setNewSessionStarterPrompts([]));
    } else {
      setNewSessionStarterPrompts([]);
    }
  }, [isNewSession, newSessionSettings?.agentId]);

  const handleNewSessionRelatedClick = useCallback(async (targetSessionId: string) => {
    const { messagesPerSession, setMessages } = useChatStore.getState();
    const targetTabId = `session:${targetSessionId}`;
    if (useTabStore.getState().isTabOpen(targetTabId)) {
      switchGenericTab(targetTabId);
      return;
    }
    try {
      if (!messagesPerSession[targetSessionId]) {
        const sessionData = await getSession(targetSessionId);
        setMessages(targetSessionId, sessionData.messages);
      }
      openGenericTab({ id: targetTabId, type: 'session', label: 'Session', sessionId: targetSessionId });
    } catch (err) {
      console.error('Failed to open related session:', err);
    }
  }, [openGenericTab, switchGenericTab]);

  // Whether the new-session view is the active content
  const showNewSession = isNewSession && newSessionSettings && !activeTabId;

  // No tabs open and not creating new session
  if (tabs.length === 0 && !isNewSession) {
    return (
      <div className="flex-1 flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-gray-500 dark:text-gray-400">
            <svg
              className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-gray-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
            <p className="text-lg font-medium dark:text-gray-100">No session selected</p>
            <p className="text-sm mt-1 dark:text-gray-400">Select a session or create a new one to start chatting</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <TabBar />
      {/* New session view — shown when isNewSession and no tab is active */}
      {showNewSession && newSessionSettings && (
        <div className="flex-1 flex flex-col">
          <Header
            sessionName={newSessionSettings.name}
            model={newSessionSettings.model}
            cwd={newSessionSettings.cwd}
            isNewSession={true}
            availableModels={availableModels}
            availableMcpServers={availableMcpServers}
            mcpSelections={newSessionSettings.mcpServers}
            availableTools={availableTools}
            toolSelections={newSessionSettings.tools}
            systemMessage={newSessionSettings.systemMessage}
            sessions={sessions}
            openTabs={openSessionIds}
            onRelatedSessionClick={handleNewSessionRelatedClick}
            onNameChange={handleNewSessionNameChange}
            onModelChange={handleNewSessionModelChange}
            onCwdChange={handleNewSessionCwdChange}
            onMcpSelectionsChange={handleNewSessionMcpChange}
            onToolSelectionsChange={handleNewSessionToolsChange}
            onSystemMessageChange={handleNewSessionSystemMessageChange}
            eligibleSubAgents={newSessionEligibleSubAgents}
            subAgentSelections={newSessionSettings.subAgents || []}
            onSubAgentSelectionsChange={handleNewSessionSubAgentChange}
          />
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <div className="text-center text-gray-500 dark:text-gray-400">
                <svg className="w-16 h-16 mx-auto mb-4 text-blue-300 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <p className="text-lg font-medium dark:text-gray-100">How can I help you today?</p>
                <p className="text-sm mt-1 text-gray-400 dark:text-gray-500">Type a message to start a new session</p>
              </div>
              {newSessionStarterPrompts.length > 0 && (
                <div className="w-full max-w-4xl mx-auto space-y-2 px-4">
                  {newSessionStarterPrompts.map((sp, idx) => (
                    <button
                      key={idx}
                      onClick={() => setNewSessionPromptToSend(sp.prompt)}
                      title={sp.prompt}
                      className="w-full text-left px-4 py-2.5 rounded-lg border border-white/40 dark:border-[#3a3a4e] bg-white/50 dark:bg-[#2a2a3c]/50 hover:bg-white/80 dark:hover:bg-[#2a2a3c]/80 transition-colors"
                    >
                      <div className="font-medium text-gray-700 dark:text-gray-200">{sp.title}</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400 truncate">{sp.prompt}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <InputBox promptToSend={newSessionPromptToSend} onPromptSent={() => setNewSessionPromptToSend(null)} />
        </div>
      )}
      {!showNewSession && activeTab?.type === 'agent-library' && <AgentLibrary />}
      {!showNewSession && activeTab?.type === 'agent-detail' && activeTab.agentId && (
        <AgentEditor agentId={activeTab.agentId} />
      )}
      {!showNewSession && activeTab?.type === 'automation-manager' && (
        <AutomationManager agentId={activeTab.agentId} />
      )}
      {!showNewSession && activeTab?.type === 'task-board' && (
        <TaskBoard automationId={activeTab.automationId} automationName={activeTab.automationId ? activeTab.label.replace('Runs: ', '') : undefined} />
      )}
      {!showNewSession && activeTab?.type === 'task-run-detail' && activeTab.runId && (
        <TaskRunDetail runId={activeTab.runId} />
      )}
      {!showNewSession && activeTab?.type === 'workflow-library' && <WorkflowLibrary />}
      {!showNewSession && activeTab?.type === 'workflow-editor' && activeTab.workflowId && (
        <WorkflowEditor workflowId={activeTab.workflowId} />
      )}
      {!showNewSession && activeTab?.type === 'workflow-run' && activeTab.workflowId && activeTab.runId && (
        <WorkflowRunView workflowId={activeTab.workflowId} runId={activeTab.runId} />
      )}
      {openSessionIds.map((sessionId) => (
        <SessionTabContent
          key={sessionId}
          sessionId={sessionId}
          isActive={!showNewSession && sessionId === activeSessionId}
        />
      ))}
    </div>
  );
}
