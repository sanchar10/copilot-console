import { useRef, useEffect, useCallback, useState, memo } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { useChatStore } from '../../stores/chatStore';
import { useUIStore } from '../../stores/uiStore';
import { useTabStore } from '../../stores/tabStore';
import { MessageBubble } from './MessageBubble';
import { usePinStore } from '../../stores/pinStore';
import { StreamingMessage } from './StreamingMessage';
import { InputBox, clearReadySession } from './InputBox';
import { TabBar } from './TabBar';
import { Header } from '../layout/Header';
import { AgentLibrary } from '../agents/AgentLibrary';
import { PinnedIcon } from './PinIcons';
import { AgentEditor } from '../agents/AgentEditor';
import { AutomationManager } from '../automations/AutomationManager';
import { TaskBoard } from '../taskboard/TaskBoard';
import { TaskRunDetail } from '../taskboard/TaskRunDetail';
import { WorkflowLibrary } from '../workflows/WorkflowLibrary';
import { WorkflowEditor } from '../workflows/WorkflowEditor';
import { WorkflowRunView } from '../workflows/WorkflowRunView';
import { updateSession, getSession, updateRuntimeSettings } from '../../api/sessions';
import { getAgent, getEligibleSubAgents } from '../../api/agents';
import type { AgentTools, SystemMessage, Agent, StarterPrompt } from '../../types/agent';

/**
 * Per-session tab content — owns its own scroll position, header, messages, and input.
 * Stays mounted when hidden so scroll position and DOM are preserved.
 */
export function scrollToMessageBySdkId(mid: string, fallbackContent?: string): HTMLElement | null {
  const esc = (window as any).CSS?.escape ? (window as any).CSS.escape(mid) : mid.replace(/"/g, '\\"');
  let el = document.querySelector(`[data-sdk-message-id="${esc}"]`) as HTMLElement | null;

  // Fallback: scan message elements for matching text content
  if (!el && fallbackContent) {
    const needle = fallbackContent.toLowerCase();
    const candidates = document.querySelectorAll('[data-sdk-message-id]');
    for (const node of candidates) {
      if ((node as HTMLElement).textContent?.toLowerCase().includes(needle)) {
        el = node as HTMLElement;
        break;
      }
    }
  }

  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return el;
}

function formatPinTimestamp(ts: string) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

/** Compose the pre-fill text for the [Ask] button. */
function composeAskPrefill(messageContent: string, note: string): string {
  const truncated = messageContent.slice(0, 500);
  const quoted = truncated
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n');
  const suffix = messageContent.length > 500 ? '\n> ...' : '';
  const noteSection = note.trim() ? `\n\n${note.trim()}` : '\n\n';
  return `Following up on your earlier response:\n\n${quoted}${suffix}${noteSection}`;
}

/** Auto-resize a textarea up to a max height (5 lines ≈ 120px). */
function autoResizeTextarea(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
}

function PinsDrawer({
  sessionId,
  pins,
  onClose,
  onAsk,
  focusPinId,
  onFocusConsumed,
}: {
  sessionId: string;
  pins: { id: string; sdk_message_id: string; created_at: string; title?: string | null; excerpt?: string | null; note?: string | null }[];
  onClose: () => void;
  onAsk?: (prefillText: string) => void;
  focusPinId?: string | null;
  onFocusConsumed?: () => void;
}) {
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [scrollFailedPin, setScrollFailedPin] = useState<string | null>(null);
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  useEffect(() => {
    setDraftNotes((prev) => {
      const next = { ...prev };
      for (const p of pins) {
        if (next[p.id] === undefined) next[p.id] = p.note ?? '';
      }
      return next;
    });
  }, [pins]);

  // Reset delete confirmation when pins change
  useEffect(() => {
    setConfirmingDelete(null);
  }, [pins]);

  // Auto-resize all textareas on mount / drawer reopen
  useEffect(() => {
    for (const el of Object.values(textareaRefs.current)) {
      autoResizeTextarea(el);
    }
  }, [pins]);

  // Focus the textarea of a newly created pin (after React renders it)
  useEffect(() => {
    if (!focusPinId) return;
    const el = textareaRefs.current[focusPinId];
    if (el) {
      el.focus();
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    onFocusConsumed?.();
  }, [focusPinId, pins, onFocusConsumed]);

  const sortedPins = [...pins].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  const handleAsk = (p: typeof pins[0]) => {
    const baseNote = p.note ?? '';
    const note = draftNotes[p.id] ?? baseNote;
    const isDirty = note !== baseNote;

    // Auto-save dirty note before asking
    const savePromise = isDirty
      ? usePinStore.getState().updatePin(sessionId, p.id, { note }).catch((e) => console.error('Failed to save note:', e))
      : Promise.resolve();

    savePromise.then(() => {
      // Look up full message from chatStore, fallback to excerpt
      const messages = useChatStore.getState().messagesPerSession[sessionId] || [];
      const fullMsg = messages.find((m) => m.sdk_message_id === p.sdk_message_id);
      const content = fullMsg?.content || p.excerpt || '';

      if (!content) return;
      const prefill = composeAskPrefill(content, note);
      onAsk?.(prefill);
    });
  };

  return (
    <aside data-pins-drawer className="w-96 border-l border-gray-200 dark:border-gray-700 bg-white/90 dark:bg-[#1f1f2e]/90 backdrop-blur p-3 overflow-y-auto">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold text-sm text-gray-800 dark:text-gray-100 flex items-center gap-1.5"><PinnedIcon size={16} /> Pins ({pins.length})</div>
        <button
          type="button"
          className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500"
          onClick={onClose}
          title="Close"
        >
          Close
        </button>
      </div>

      {sortedPins.length === 0 ? (
        <div className="mt-3 text-sm text-gray-500 dark:text-gray-400">No pins yet.</div>
      ) : (
        <div className="mt-3 space-y-3">
          {sortedPins.map((p) => {
            const baseNote = p.note ?? '';
            const note = draftNotes[p.id] ?? baseNote;
            const isDirty = note !== baseNote;
            const title = p.title || p.excerpt || p.sdk_message_id;

            return (
              <div key={p.id} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-[#2a2a3c]/70 p-3">
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    className="flex-1 text-left"
                    onClick={() => {
                      const el = scrollToMessageBySdkId(p.sdk_message_id);
                      if (!el) {
                        setScrollFailedPin(p.id);
                        setTimeout(() => setScrollFailedPin(null), 2000);
                      }
                    }}
                    title={title}
                  >
                    <div className="text-xs text-gray-500 dark:text-gray-400">{formatPinTimestamp(p.created_at)}</div>
                    <div className="text-sm font-medium text-blue-700 dark:text-blue-300 hover:underline line-clamp-2">{title}</div>
                    {scrollFailedPin === p.id && (
                      <div className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">Message not available</div>
                    )}
                  </button>
                  {/* Inline delete confirmation */}
                  {confirmingDelete === p.id ? (
                    <span className="text-xs flex items-center gap-1 whitespace-nowrap">
                      <span className="text-gray-500 dark:text-gray-400">Delete?</span>
                      <button
                        type="button"
                        className="text-red-600 dark:text-red-400 hover:underline"
                        onClick={() => {
                          usePinStore.getState().deletePin(sessionId, p.id).catch((e) => console.error('Failed to unpin:', e));
                          setConfirmingDelete(null);
                        }}
                      >
                        Yes
                      </button>
                      <span className="text-gray-400 dark:text-gray-500">·</span>
                      <button
                        type="button"
                        className="text-gray-500 dark:text-gray-400 hover:underline"
                        onClick={() => setConfirmingDelete(null)}
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 px-1"
                      title="Delete pin"
                      onClick={() => setConfirmingDelete(p.id)}
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div className="mt-2">
                  <textarea
                    ref={(el) => { textareaRefs.current[p.id] = el; }}
                    className="w-full text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-[#1f1f2e]/60 px-2 py-1.5 text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 resize-y overflow-y-auto"
                    rows={1}
                    style={{ minHeight: '1.75rem', maxHeight: '18.75rem' }}
                    placeholder="Add a note (optional)"
                    value={note}
                    onChange={(e) => {
                      setDraftNotes((prev) => ({ ...prev, [p.id]: e.target.value }));
                      autoResizeTextarea(e.target);
                    }}
                  />
                  <div className="mt-2 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      disabled={!p.excerpt && !p.title}
                      className="text-xs px-2 py-1 rounded border transition-colors border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 hover:border-emerald-300 dark:hover:border-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
                      onClick={() => handleAsk(p)}
                      title="Pre-fill input with this pin's context"
                    >
                      Ask
                    </button>
                    <button
                      type="button"
                      disabled={!isDirty}
                      className={`text-xs px-2 py-1 rounded border transition-colors ${isDirty ? 'border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:border-blue-300 dark:hover:border-blue-500' : 'border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'}`}
                      onClick={() => {
                        usePinStore.getState().updatePin(sessionId, p.id, { note }).catch((e) => console.error('Failed to update pin:', e));
                      }}
                      title="Save note"
                    >
                      Save
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}

const SessionTabContent = memo(function SessionTabContent({ sessionId, isActive }: { sessionId: string; isActive: boolean }) {
  const { sessions, availableMcpServers, availableTools, setSessions, updateSessionMcpServers, updateSessionTools } = useSessionStore();
  const { messagesPerSession, getStreamingState, getTokenUsage, sendingSessionId } = useChatStore();
  const { availableModels } = useUIStore();
  const { tabs, openTab: openGenericTab, switchTab: switchGenericTab } = useTabStore();
  const pins = usePinStore((s) => s.pinsPerSession[sessionId]) || [];
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const isProgrammaticScrollRef = useRef(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [eligibleSubAgents, setEligibleSubAgents] = useState<Agent[]>([]);
  const [starterPrompts, setStarterPrompts] = useState<StarterPrompt[]>([]);
  const [promptToSend, setPromptToSend] = useState<string | null>(null);
  const [askPrefill, setAskPrefill] = useState<string | null>(null);
  const [focusPinId, setFocusPinId] = useState<string | null>(null);

  const session = sessions.find((s) => s.session_id === sessionId);
  const rawMessages = messagesPerSession[sessionId];
  const isLoadingMessages = rawMessages === undefined;
  const messages = rawMessages || [];
  const { content: streamingContent, steps: streamingSteps, isStreaming } = getStreamingState(sessionId);
  const tokenUsage = getTokenUsage(sessionId);

  // Feature 2: open drawer + set focus target — PinsDrawer's useEffect handles actual focus after render
  const handlePinCreated = useCallback(() => {
    setPinsOpen(true);
    // Find the newest pin (just created) to focus its textarea
    const currentPins = usePinStore.getState().pinsPerSession[sessionId] || [];
    const newest = [...currentPins].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0];
    if (newest) setFocusPinId(newest.id);
  }, [sessionId]);

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
    setShowScrollButton(!nearBottom);
  }, [isNearBottom]);

  // Auto-scroll: only when user hasn't scrolled up
  useEffect(() => {
    if (isActive && !userScrolledUpRef.current) {
      isProgrammaticScrollRef.current = true;
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
      // Use setTimeout to ensure all scroll events from instant scroll have fired
      setTimeout(() => { isProgrammaticScrollRef.current = false; }, 50);
    }
  }, [messages, streamingContent, streamingSteps, isActive]);

  // Re-engage auto-scroll when streaming stops (but don't hide button — user may still be scrolled up)
  useEffect(() => {
    if (!isStreaming) {
      userScrolledUpRef.current = false;
      // Recheck scroll position — button stays if still scrolled up after content settles
      requestAnimationFrame(() => {
        const nearBottom = isNearBottom();
        setShowScrollButton(!nearBottom);
      });
    }
  }, [isStreaming, isNearBottom]);

  // Scroll-to-bottom handler for the button
  const scrollToBottom = useCallback(() => {
    userScrolledUpRef.current = false;
    setShowScrollButton(false);
    isProgrammaticScrollRef.current = true;
    messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
    setTimeout(() => { isProgrammaticScrollRef.current = false; }, 50);
  }, []);

  // Re-engage auto-scroll when user sends a message
  const handleMessageSent = useCallback(() => {
    userScrolledUpRef.current = false;
    setShowScrollButton(false);
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
    // Same folder selected — no-op
    const currentCwd = sessions.find(s => s.session_id === sessionId)?.cwd;
    if (newCwd === currentCwd) return;
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

  const { updateSessionModel } = useSessionStore();
  const handleModelChange = useCallback(async (model: string, reasoningEffort?: string | null) => {
    // Optimistic update
    updateSessionModel(sessionId, model, reasoningEffort ?? null);
    try {
      await updateRuntimeSettings(sessionId, {
        model,
        reasoning_effort: reasoningEffort ?? undefined,
      });
    } catch (error) {
      console.error('Failed to update model:', error);
      // Revert on failure
      if (session) {
        updateSessionModel(sessionId, session.model, session.reasoning_effort ?? null);
      }
    }
  }, [sessionId, session, updateSessionModel]);

  // Fetch eligible sub-agents (exclude session's own agent)
  useEffect(() => {
    const agentId = session?.agent_id;
    getEligibleSubAgents(agentId || undefined)
      .then(setEligibleSubAgents)
      .catch(() => setEligibleSubAgents([]));
  }, [session?.agent_id]);

  // Load pins for this session (only when first activated)
  const didFetchPinsRef = useRef(false);
  useEffect(() => {
    if (!isActive || didFetchPinsRef.current) return;
    didFetchPinsRef.current = true;
    usePinStore.getState().fetchPins(sessionId);
  }, [isActive, sessionId]);

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
        reasoningEffort={session?.reasoning_effort}
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
        isActivating={sendingSessionId === sessionId}
        sessions={sessions}
        currentSessionId={sessionId}
        openTabs={tabs.filter((t) => t.type === 'session' && t.sessionId).map((t) => t.sessionId!)}
        onRelatedSessionClick={handleRelatedSessionClick}
        onNameChange={handleNameChange}
        onModelChange={handleModelChange}
        onCwdChange={handleCwdChange}
        onMcpSelectionsChange={handleMcpSelectionsChange}
        onToolSelectionsChange={handleToolSelectionsChange}
        onSystemMessageChange={handleSystemMessageChange}
        eligibleSubAgents={eligibleSubAgents}
        subAgentSelections={session?.sub_agents || []}
        onSubAgentSelectionsChange={handleSubAgentSelectionsChange}
      />

      {/* Messages Area + Input + Pins Drawer */}
      <div className="relative flex-1 min-h-0 flex">
        {/* Chat column: messages + input */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="relative flex-1 min-h-0">
            <div className="absolute inset-0">
              <div ref={scrollContainerRef} onScroll={handleScroll} className="h-full overflow-y-auto p-4">
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
                        <MessageBubble key={message.id} message={message} cwd={session?.cwd} sessionId={sessionId} onPinCreated={handlePinCreated} />
                      ))}
                      {isStreaming && <StreamingMessage content={streamingContent} steps={streamingSteps} cwd={session?.cwd} />}
                    </>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </div>
            </div>

            {/* Scroll-to-bottom button */}
            <button
              onClick={scrollToBottom}
              className={`absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/80 dark:bg-[#2a2a3c]/80 backdrop-blur text-gray-900 dark:text-gray-100 px-3 py-1.5 rounded-full shadow-lg border border-gray-300 dark:border-gray-600 text-sm flex items-center gap-1.5 hover:bg-white/95 dark:hover:bg-[#2a2a3c]/95 transition-opacity duration-200 z-10 ${showScrollButton ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
            </button>
          </div>

          {/* Input Area */}
          <InputBox
            sessionId={sessionId}
            promptToSend={promptToSend}
            onPromptSent={() => setPromptToSend(null)}
            onMessageSent={handleMessageSent}
            pinsCount={pins.length}
            pinsOpen={pinsOpen}
            onPinsToggle={() => setPinsOpen((v) => !v)}
            prefillText={askPrefill}
            onPrefillConsumed={() => setAskPrefill(null)}
          />
        </div>

        {/* Pins Drawer — full height beside chat + input */}
        {pinsOpen && <PinsDrawer sessionId={sessionId} pins={pins} onClose={() => setPinsOpen(false)} onAsk={setAskPrefill} focusPinId={focusPinId} onFocusConsumed={() => setFocusPinId(null)} />}
      </div>
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

  const handleNewSessionModelChange = useCallback((model: string, reasoningEffort?: string | null) => {
    updateNewSessionSettings({ model, reasoningEffort: reasoningEffort ?? null });
  }, [updateNewSessionSettings]);

  const handleNewSessionReasoningEffortChange = useCallback((reasoningEffort: string | null) => {
    updateNewSessionSettings({ reasoningEffort });
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
            reasoningEffort={newSessionSettings.reasoningEffort}
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
            onReasoningEffortChange={handleNewSessionReasoningEffortChange}
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
