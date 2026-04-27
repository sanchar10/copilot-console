import { useState, useRef, useEffect, useCallback } from 'react';
import type { KeyboardEvent } from 'react';
import { useChatStore, flushStreamingBuffer } from '../../stores/chatStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useUIStore } from '../../stores/uiStore';
import { useViewedStore } from '../../stores/viewedStore';
import { useTabStore, tabId } from '../../stores/tabStore';
import { useToastStore } from '../../stores/toastStore';
import { useAuthStore } from '../../stores/authStore';
import { sendMessage, createSession, connectSession, enqueueMessage, abortSession, uploadFile, updateRuntimeSettings, updateSession } from '../../api/sessions';
import { scheduleDesktopNotification, playUnreadTone } from '../../utils/desktopNotifications';
import { openSessionTab } from '../../utils/openSession';
import { Button } from '../common/Button';
import { ModeSelector, type AgentMode } from './ModeSelector';
import { PinnedIcon } from './PinIcons';
import { SlashCommandPalette } from './SlashCommandPalette';
import { fileIcon } from '../../utils/fileIcon';
import { useFileUpload } from './useFileUpload';
import { useSlashCommands } from './useSlashCommands';

// Sessions whose backend SessionClient is confirmed ready — now in chatStore.
// Legacy helpers re-exported for backward compatibility with tests and TabBar.
export function clearReadySession(sessionId: string) {
  useChatStore.getState().clearSessionState(sessionId);
}

/** @internal — test-only */
export function isSessionReady(sessionId: string): boolean {
  return useChatStore.getState().isSessionReady(sessionId);
}

/** @internal — test-only */
export function markSessionReady(sessionId: string): void {
  useChatStore.getState().markSessionReady(sessionId);
}

interface InputBoxProps {
  sessionId?: string;
  promptToSend?: string | null;
  onPromptSent?: () => void;
  onMessageSent?: () => void;
  pinsCount?: number;
  pinsOpen?: boolean;
  onPinsToggle?: () => void;
  prefillText?: string | null;
  onPrefillConsumed?: () => void;
  /** Agent items for the /agent submenu picker */
  agentPickerItems?: import('./SlashCommandPalette').AgentPickerItem[];
}

export function InputBox({ sessionId, promptToSend, onPromptSent, onMessageSent, pinsCount, pinsOpen, onPinsToggle, prefillText, onPrefillConsumed, agentPickerItems }: InputBoxProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // --- Extracted hooks ---
  const fileUpload = useFileUpload(sessionId);
  const slash = useSlashCommands(sessionId);

  const { isNewSession, newSessionSettings, addSession, moveSessionToTop, updateSessionTimestamp, updateSessionName } = useSessionStore();
  const { defaultModel, defaultCwd } = useUIStore();
  const { setAgentActive, markViewed } = useViewedStore();
  const { openTab: openGenericTab } = useTabStore();
  const {
    sendingSessionId, getStreamingState, setSending, setStreaming,
    addMessage, appendStreamingContent, addStreamingStep, setTokenUsage,
    finalizeTurn, setElicitation, clearElicitation, setAskUser, clearAskUser,
    pendingAskUser, pendingElicitation,
    isSessionReady: isSessionReadyFn, markSessionReady: markSessionReadyFn,
    setSessionMode: setSessionModeStore, getSessionMode,
  } = useChatStore();

  const { isStreaming, latestIntent } = getStreamingState(sessionId || null);
  const hasPendingInput = !!(sessionId && (pendingAskUser[sessionId] || pendingElicitation[sessionId]));
  const isSending = sendingSessionId === sessionId;
  const isDisabled = isSending;

  // Agent mode — session.json is source of truth, chatStore.sessionModes is UI cache
  const sessionAgentMode = useSessionStore.getState().sessions.find(s => s.session_id === sessionId)?.agent_mode;
  const [sessionMode, setSessionMode_] = useState<AgentMode>(
    () => (sessionId ? getSessionMode(sessionId) as AgentMode : undefined) ?? (sessionAgentMode as AgentMode) ?? 'interactive'
  );
  const currentMode: AgentMode = isNewSession
    ? (newSessionSettings?.agentMode as AgentMode) || 'interactive'
    : sessionMode;

  useEffect(() => {
    const storeMode = sessionId ? getSessionMode(sessionId) as AgentMode : undefined;
    const persistedMode = useSessionStore.getState().sessions.find(s => s.session_id === sessionId)?.agent_mode as AgentMode | undefined;
    setSessionMode_(storeMode ?? persistedMode ?? 'interactive');
  }, [sessionId, getSessionMode]);

  const handleModeChange = useCallback(async (newMode: AgentMode) => {
    if (isNewSession) {
      useSessionStore.getState().updateNewSessionSettings({ agentMode: newMode });
    } else if (sessionId) {
      // Skip if unchanged
      if (newMode === sessionMode) return;
      setSessionMode_(newMode);
      setSessionModeStore(sessionId, newMode);
      if (isSessionReadyFn(sessionId)) {
        // Active session — fire RPC (server persists after success)
        try {
          const result = await updateRuntimeSettings(sessionId, { mode: newMode });
          const confirmed = (result.mode ?? newMode) as AgentMode;
          setSessionMode_(confirmed);
          setSessionModeStore(sessionId, confirmed);
        } catch (err) {
          console.error('Failed to set mode:', err);
          setSessionMode_(sessionMode);
          setSessionModeStore(sessionId, sessionMode);
        }
      } else {
        // Resumed (not active) — PATCH session.json so backend reads it on activation
        try {
          await updateSession(sessionId, { agent_mode: newMode });
          useSessionStore.getState().updateSessionField(sessionId, 'agent_mode', newMode);
        } catch (err) {
          console.error('Failed to persist mode to session.json:', err);
        }
      }
    }
  }, [isNewSession, sessionId, sessionMode, setSessionModeStore, isSessionReadyFn]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [input]);

  const handleAbort = async () => {
    if (!sessionId) return;
    try {
      await abortSession(sessionId);
      clearAskUser(sessionId);
      clearElicitation(sessionId);
    } catch (err) {
      console.error('Failed to abort:', err);
    }
  };

  // Auto-submit starter prompt
  useEffect(() => {
    if (promptToSend) {
      handleSubmit(promptToSend);
      onPromptSent?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptToSend]);

  // Prefill textarea from [Ask] button
  useEffect(() => {
    if (!prefillText) return;
    setInput((prev) => prev.trim() ? `${prev}\n${prefillText}` : prefillText);
    onPrefillConsumed?.();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; el.scrollTop = el.scrollHeight; }
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillText]);

  // --- Core submit logic (kept inline — too many closure deps to extract safely) ---
  const handleSubmit = async (overrideText?: string) => {
    const trimmedInput = (overrideText || input).trim();

    // Warn if no auth is configured (non-blocking — message still sends)
    if (!useAuthStore.getState().status.authenticated) {
      useToastStore.getState().addToast('No auth configured — check Settings to connect a provider', 'warning');
    }

    // Slash command dispatch
    let isFleet = false;
    if (slash.activeCommand) {
      if (slash.activeCommand.name === 'fleet') {
        if (!trimmedInput) return;
        isFleet = true;
        slash.clearActiveCommand();
      } else {
        if (slash.activeCommand.interaction === 'prompt' && !trimmedInput) return;
        setInput('');
        const cmd = slash.activeCommand;
        slash.clearActiveCommand();
        await slash.executeSlashCommand(cmd, trimmedInput);
        return;
      }
    }

    if ((!isFleet && !trimmedInput && fileUpload.attachments.length === 0 && fileUpload.pendingFiles.length === 0) || isDisabled) return;

    // Enqueue if agent is already running
    const currentId = sessionId || useTabStore.getState().getActiveSessionId();
    if (isStreaming && currentId) {
      const enqueueAttachments = fileUpload.attachments.map((a) => a.attachmentRef);
      const resolvedContent = trimmedInput || (enqueueAttachments.length > 0 ? 'See attached file(s).' : '');
      addMessage(currentId, {
        id: `temp-${Date.now()}`, role: 'user', content: resolvedContent, timestamp: new Date().toISOString(),
        mode: 'enqueue', attachments: enqueueAttachments.length > 0 ? enqueueAttachments.map((a) => ({ type: a.type, path: a.path, displayName: a.displayName })) : undefined,
      });
      updateSessionTimestamp(currentId);
      setInput('');
      fileUpload.consumeAttachments();
      try { await enqueueMessage(currentId, resolvedContent, enqueueAttachments.length > 0 ? enqueueAttachments : undefined); } catch (err) { console.error('Failed to enqueue message:', err); }
      return;
    }

    let activeSessionId = sessionId;
    let isCreatingNewSession = isNewSession || !sessionId;
    let initialAgentMode: string | undefined;
    let initialCompact = false;

    setInput('');
    const pendingAttachments = fileUpload.consumeAttachments();

    // Create session if needed
    if (isNewSession || !sessionId) {
      try {
        const sessionModel = newSessionSettings?.model || defaultModel;
        const sessionCwd = newSessionSettings?.cwd || defaultCwd;
        const sessionName = newSessionSettings?.name || 'New Session';
        const pendingAgentMode = newSessionSettings?.agentMode;
        const session = await createSession({
          model: sessionModel, reasoning_effort: newSessionSettings?.reasoningEffort,
          name: sessionName, cwd: sessionCwd, mcp_servers: newSessionSettings?.mcpServers,
          tools: newSessionSettings?.tools, system_message: newSessionSettings?.systemMessage,
          agent_id: newSessionSettings?.agentId, sub_agents: newSessionSettings?.subAgents,
          // Persist agent/mode in session.json from the start
          selected_agent: newSessionSettings?.selectedAgent || newSessionSettings?.pendingAgent || undefined,
          agent_mode: (pendingAgentMode && pendingAgentMode !== 'interactive') ? pendingAgentMode : undefined,
        });
        if (pendingAgentMode && pendingAgentMode !== 'interactive') {
          initialAgentMode = pendingAgentMode;
          setSessionModeStore(session.session_id, pendingAgentMode);
        }
        if (newSessionSettings?.pendingCompact) {
          initialCompact = true;
        }
        addSession(session);
        openGenericTab({ id: tabId.session(session.session_id), type: 'session', label: session.session_name, sessionId: session.session_id });
        await connectSession(session.session_id);
        activeSessionId = session.session_id;
      } catch (err) {
        console.error('Failed to create session:', err);
        const msg = err instanceof TypeError ? 'Server unavailable — could not create session' : (err instanceof Error ? err.message : 'Failed to create session');
        useToastStore.getState().addToast(msg, 'error');
        setSending(null);
        return;
      }
    } else {
      moveSessionToTop(sessionId);
    }

    if (!activeSessionId) { console.error('No session ID'); return; }

    // Upload pending files
    const filesToUpload = fileUpload.consumePendingFiles();
    if (filesToUpload.length > 0) {
      try {
        const uploadResults = await Promise.all(filesToUpload.map(async (file) => {
          const uploaded = await uploadFile(file, activeSessionId!);
          return { type: 'file' as const, path: uploaded.path, displayName: uploaded.originalName };
        }));
        pendingAttachments.push(...uploadResults);
      } catch (err) { console.error('Failed to upload pending files:', err); }
    }

    // Activation lock
    const needsLock = !isSessionReadyFn(activeSessionId);
    if (needsLock) setSending(activeSessionId);

    // For resumed sessions (not new), gather pending compact flag
    // Agent/mode now come from session.json — no need to read from chatStore
    if (needsLock && !isCreatingNewSession && activeSessionId) {
      const currentMode = getSessionMode(activeSessionId);
      if (currentMode && currentMode !== 'interactive') {
        initialAgentMode = currentMode;
      }
      // Consume pending compact flag (one-shot action, not a persistent setting)
      const chatState = useChatStore.getState();
      if (chatState.consumePendingCompact(activeSessionId)) {
        initialCompact = true;
      }
      // Note: agent selection now comes from session.json (backend reads it on resume)
      // No need to consume pendingAgent from chatStore
    }

    const resolvedPrompt = trimmedInput || (pendingAttachments.length > 0 ? 'See attached file(s).' : '');
    addMessage(activeSessionId, {
      id: `temp-${Date.now()}`, role: 'user', content: resolvedPrompt, timestamp: new Date().toISOString(),
      attachments: pendingAttachments.length > 0 ? pendingAttachments.map((a) => ({ type: a.type, path: a.path, displayName: a.displayName })) : undefined,
    });
    onMessageSent?.();
    updateSessionTimestamp(activeSessionId);
    setStreaming(activeSessionId, true);

    if (isFleet) {
      addMessage(activeSessionId, { id: `system-fleet-${Date.now()}`, role: 'system', content: `🚀 Fleet deployed: "${resolvedPrompt.length > 100 ? resolvedPrompt.slice(0, 100) + '...' : resolvedPrompt}"`, timestamp: new Date().toISOString() });
    }

    markViewed(activeSessionId);
    setAgentActive(activeSessionId, true);

    let sendingCleared = !needsLock;
    const clearSendingOnce = () => {
      if (!sendingCleared) {
        if (activationTimer) clearTimeout(activationTimer);
        markSessionReadyFn(activeSessionId!);
        setSending(null);
        sendingCleared = true;
      }
    };

    let activationTimer: ReturnType<typeof setTimeout> | null = null;
    if (needsLock) {
      activationTimer = setTimeout(() => {
        if (!sendingCleared) {
          clearSendingOnce();
          setStreaming(activeSessionId!, false);
          setAgentActive(activeSessionId!, false);
          addMessage(activeSessionId!, { id: `system-timeout-${Date.now()}`, role: 'system', content: '⚠️ Session activation timed out. An MCP server may be unresponsive. Try sending your message again.', timestamp: new Date().toISOString() });
        }
      }, 60_000);
    }

    try {
      await sendMessage(activeSessionId, resolvedPrompt, {
        onDelta: (delta) => { clearSendingOnce(); appendStreamingContent(activeSessionId!, delta); },
        onStep: (step) => {
          clearSendingOnce();
          if (step.title?.startsWith('⟳ Compacting') || step.title?.startsWith('✓ Context compacted') || step.title?.startsWith('✗ Compaction')
              || step.title?.startsWith('🤖 Agent:') || step.title?.startsWith('✨ Agent:') || step.title?.startsWith('✗ Agent')) {
            addMessage(activeSessionId!, { id: `system-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, role: 'system', content: `${step.title}${step.detail ? ` — ${step.detail}` : ''}`, timestamp: new Date().toISOString() });
          } else { addStreamingStep(activeSessionId!, step); }
        },
        onUsageInfo: (usage) => { setTokenUsage(activeSessionId!, usage); },
        onDone: (_messageId, sessionName) => {
          if (activationTimer) clearTimeout(activationTimer);
          flushStreamingBuffer(activeSessionId!);
          setStreaming(activeSessionId!, false); setSending(null); setAgentActive(activeSessionId!, false);
          if (sessionName && activeSessionId) updateSessionName(activeSessionId, sessionName);
          updateSessionTimestamp(activeSessionId!);
          const currentSession = useTabStore.getState().getActiveSessionId();
          if (currentSession === activeSessionId) { markViewed(activeSessionId!); } else { playUnreadTone(); }
          if (activeSessionId) {
            const sid = activeSessionId; const name = sessionName || newSessionSettings?.name || 'Copilot';
            scheduleDesktopNotification(sid, name, 'response',
              () => { const ct = useTabStore.getState().getActiveSessionId?.() || useTabStore.getState().activeTabId; return ct !== `session:${sid}` && ct !== sid; },
              () => { const s = useSessionStore.getState().sessions.find(s => s.session_id === sid); if (s) openSessionTab(s); },
            );
          }
        },
        onError: (error) => { if (activationTimer) clearTimeout(activationTimer); flushStreamingBuffer(activeSessionId!); console.error('Message error:', error); useToastStore.getState().addToast(typeof error === 'string' ? error : 'Message failed — server error', 'error'); setStreaming(activeSessionId!, false); setSending(null); setAgentActive(activeSessionId!, false); },
        isNewSession: isCreatingNewSession,
        onTurnDone: (messageId?: string, eventId?: string, timestamp?: string) => { flushStreamingBuffer(activeSessionId!); finalizeTurn(activeSessionId!, messageId, eventId, timestamp); },
        attachments: pendingAttachments.length > 0 ? pendingAttachments : undefined,
        onModeChanged: (mode) => { setSessionMode_(mode as AgentMode); if (activeSessionId) setSessionModeStore(activeSessionId, mode); },
        agentMode: initialAgentMode,
        fleet: isFleet,
        compact: initialCompact || undefined,
        onElicitation: (data) => {
          if (activeSessionId) {
            setElicitation(activeSessionId, data);
            const sid = activeSessionId; const name = newSessionSettings?.name || 'Copilot';
            scheduleDesktopNotification(sid, name, 'input_needed',
              () => { const ct = useTabStore.getState().getActiveSessionId?.() || useTabStore.getState().activeTabId; return ct !== `session:${sid}` && ct !== sid; },
              () => { const s = useSessionStore.getState().sessions.find(s => s.session_id === sid); if (s) openSessionTab(s); },
            );
          }
        },
        onAskUser: (data) => {
          if (activeSessionId) {
            setAskUser(activeSessionId, data);
            const sid = activeSessionId; const name = newSessionSettings?.name || 'Copilot';
            scheduleDesktopNotification(sid, name, 'input_needed',
              () => { const ct = useTabStore.getState().getActiveSessionId?.() || useTabStore.getState().activeTabId; return ct !== `session:${sid}` && ct !== sid; },
              () => { const s = useSessionStore.getState().sessions.find(s => s.session_id === sid); if (s) openSessionTab(s); },
            );
          }
        },
      });
    } catch (err) {
      if (activationTimer) clearTimeout(activationTimer);
      console.error('Failed to send message:', err);
      const msg = err instanceof TypeError ? 'Server unavailable — message not sent' : (err instanceof Error ? err.message : 'Failed to send message');
      useToastStore.getState().addToast(msg, 'error');
      if (activeSessionId) { setStreaming(activeSessionId, false); setAgentActive(activeSessionId, false); }
    } finally { setSending(null); }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slash.showSlashPalette && ['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(e.key)) return;
    if (e.key === 'Backspace' && input === '' && slash.activeCommand) { e.preventDefault(); slash.clearActiveCommand(); return; }
    if (e.key === 'Escape' && slash.activeCommand) { e.preventDefault(); slash.clearActiveCommand(); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  };

  const handleInputChange = useCallback((value: string) => {
    const result = slash.processInputForSlash(value);
    setInput(result.consumed ? result.newInput : value);
  }, [slash]);

  return (
    <div
      className={`border-t border-gray-200 dark:border-[#3a3a4e] bg-white dark:bg-[#1e1e2e] px-6 py-3 ${fileUpload.isDragOver ? 'ring-2 ring-blue-400 bg-blue-50 dark:bg-blue-900/30' : ''}`}
      onDragOver={fileUpload.handleDragOver}
      onDragLeave={fileUpload.handleDragLeave}
      onDrop={fileUpload.handleDrop}
    >
      <div className="max-w-4xl mx-auto">
        {/* Attachment chips */}
        {(fileUpload.attachments.length > 0 || fileUpload.pendingFiles.length > 0) && (
          <div className="flex flex-wrap gap-2 mb-2">
            {fileUpload.attachments.map((att, idx) => (
              <div key={`uploaded-${idx}`} className="flex items-center gap-1.5 bg-gray-50 dark:bg-[#2a2a3c] border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1 text-sm">
                <span className="text-gray-500 dark:text-gray-400">{fileIcon(att.originalName)}</span>
                <span className="text-gray-700 dark:text-gray-200 max-w-[200px] truncate">{att.originalName}</span>
                <span className="text-gray-400 dark:text-gray-500 text-xs">({(att.size / 1024).toFixed(0)}KB)</span>
                <button onClick={() => fileUpload.removeAttachment(idx)} className="text-gray-400 dark:text-gray-500 hover:text-red-500 ml-0.5" title="Remove" aria-label={`Remove ${att.originalName}`}>×</button>
              </div>
            ))}
            {fileUpload.pendingFiles.map((file, idx) => (
              <div key={`pending-${idx}`} className="flex items-center gap-1.5 bg-gray-50 dark:bg-[#2a2a3c] border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1 text-sm">
                <span className="text-gray-500 dark:text-gray-400">{fileIcon(file.name)}</span>
                <span className="text-gray-700 dark:text-gray-200 max-w-[200px] truncate">{file.name}</span>
                <span className="text-gray-400 dark:text-gray-500 text-xs">({(file.size / 1024).toFixed(0)}KB)</span>
                <button onClick={() => fileUpload.removePendingFile(idx)} className="text-gray-400 dark:text-gray-500 hover:text-red-500 ml-0.5" title="Remove" aria-label={`Remove ${file.name}`}>×</button>
              </div>
            ))}
          </div>
        )}
        {fileUpload.isUploading && <div className="text-xs text-gray-400 dark:text-gray-500 mb-1">Uploading...</div>}
        {/* Input row */}
        <div className="flex gap-3 items-center relative">
          <div className="w-8 flex-shrink-0 relative flex items-center justify-center">
            <div className="absolute right-full mr-2 top-1/2 -translate-y-1/2 whitespace-nowrap z-10">
              <ModeSelector mode={currentMode} onModeChange={handleModeChange} disabled={isSending} />
            </div>
            <input ref={fileUpload.fileInputRef} type="file" multiple className="hidden" onChange={fileUpload.onFileInputChange} />
            <button onClick={fileUpload.openFilePicker} className="h-8 w-8 flex items-center justify-center text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 disabled:opacity-50 rounded-full" title="Attach files" aria-label="Attach files">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>
          </div>

          <div className="flex-1 min-w-0 relative">
            {slash.showSlashPalette && (
              <SlashCommandPalette
                query={slash.slashQuery}
                onSelect={(cmd) => { slash.handleSlashSelect(cmd); setInput(''); }}
                onDismiss={slash.handleSlashDismiss}
                agentItems={agentPickerItems}
                onAgentSelect={(name) => { slash.handleAgentSelect(name); setInput(''); }}
              />
            )}
            <div className="flex items-center gap-2">
              <div className={`flex-1 min-w-0 flex items-center gap-2 rounded-lg border px-3 pt-2 pb-1.5 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent dark:bg-[#2a2a3c] ${
              fileUpload.isDragOver ? 'border-blue-400' : slash.activeCommand ? 'border-blue-300 bg-blue-50/50 dark:border-blue-600 dark:bg-blue-900/10' : isStreaming ? 'border-amber-300 bg-amber-50 dark:border-amber-600 dark:bg-amber-900/20' : 'border-gray-300 dark:border-gray-600'
            }`}>
              {slash.activeCommand && (
                <button onClick={slash.clearActiveCommand} className="flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-500/25 dark:text-blue-100 border border-blue-200 dark:border-blue-400/30 hover:bg-blue-200 dark:hover:bg-blue-500/35 transition-colors flex-shrink-0" title={`Remove /${slash.activeCommand.name} command`} aria-label={`Remove /${slash.activeCommand.name} command`}>
                  <span>{slash.activeCommand.icon}</span>
                  <span>/{slash.activeCommand.name}</span>
                  <span className="ml-0.5 text-blue-400 dark:text-blue-300">×</span>
                </button>
              )}
              <div className="relative flex-1">
                {isStreaming && !isSending && !input && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 text-sm pointer-events-none flex items-center gap-1.5">
                    <span className="flex items-center gap-0.5">
                      <span className="w-1.5 h-1.5 bg-gray-500 dark:bg-gray-300 rounded-full animate-bounce [animation-delay:0ms]" />
                      <span className="w-1.5 h-1.5 bg-gray-500 dark:bg-gray-300 rounded-full animate-bounce [animation-delay:150ms]" />
                      <span className="w-1.5 h-1.5 bg-gray-500 dark:bg-gray-300 rounded-full animate-bounce [animation-delay:300ms]" />
                    </span>
                    {hasPendingInput ? "Waiting for your input above…" : latestIntent || "Thinking… queue a follow-up message"}
                  </span>
                )}
                <textarea
                  ref={textareaRef} value={input}
                  onChange={(e) => handleInputChange(e.target.value)}
                  onKeyDown={handleKeyDown} onPaste={fileUpload.handlePaste} autoFocus={isNewSession}
                  placeholder={slash.activeCommand
                    ? (slash.activeCommand.placeholder || `Press Send to execute /${slash.activeCommand.name}`)
                    : isSending ? "Activating session, please wait..."
                    : isStreaming ? ""
                    : "Type a message... (Enter to send, Shift+Enter for new line)"}
                  className="w-full resize-none max-h-[200px] bg-transparent focus:outline-none dark:text-gray-100 dark:placeholder-gray-500"
                  rows={1}
                />
              </div>
            </div>
              <Button onClick={() => handleSubmit()} disabled={
                slash.activeCommand
                  ? (slash.activeCommand.interaction === 'prompt' && !input.trim()) || isDisabled
                  : (!input.trim() && fileUpload.attachments.length === 0 && fileUpload.pendingFiles.length === 0) || isDisabled
              } className="h-11 w-11 p-0" aria-label="Send message" title="Send message (Enter)">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </Button>
              <Button onClick={handleAbort} disabled={!isStreaming} className={`h-11 w-11 p-0 ${isStreaming ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-200 dark:bg-gray-700 opacity-40 cursor-not-allowed'}`} title="Stop the agent" aria-label="Stop the agent">
                <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
              </Button>
            </div>

            {/* Pins button — positioned outside right */}
            {onPinsToggle && (pinsCount ?? 0) > 0 && (
              <button type="button" onClick={onPinsToggle}
                className={`absolute left-full ml-2 top-1/2 -translate-y-1/2 h-11 w-11 flex items-center justify-center rounded-lg transition-colors ${pinsOpen ? 'bg-red-50 dark:bg-red-900/30 ring-1 ring-red-200 dark:ring-red-800' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                title={pinsOpen ? 'Close pins drawer' : 'Open pins drawer'}
              >
                <PinnedIcon size={16} />
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-0.5">{pinsCount}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
