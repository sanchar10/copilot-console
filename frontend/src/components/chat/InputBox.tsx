import { useState, useRef, useEffect, useCallback } from 'react';
import type { KeyboardEvent, DragEvent, ClipboardEvent } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useUIStore } from '../../stores/uiStore';
import { useViewedStore } from '../../stores/viewedStore';
import { useTabStore, tabId } from '../../stores/tabStore';
import { sendMessage, createSession, connectSession, enqueueMessage, abortSession, uploadFile, updateRuntimeSettings, compactSession } from '../../api/sessions';
import type { AttachmentRef, UploadedFile } from '../../api/sessions';
import { Button } from '../common/Button';
import { ModeSelector, type AgentMode } from './ModeSelector';
import { PinnedIcon } from './PinIcons';
import { SlashCommandPalette } from './SlashCommandPalette';
import type { SlashCommand } from './slashCommands';
import { SLASH_COMMANDS } from './slashCommands';

// Sessions whose backend SessionClient is confirmed ready.
// Resets on page refresh — correct since backend clients are also destroyed.
const readySessions = new Set<string>();

// Per-session agent mode. Survives component mount/unmount so mode persists
// when switching between new-session InputBox and session-tab InputBox.
const sessionModes = new Map<string, AgentMode>();

/**
 * Remove a session from the ready set.
 * Call when the backend destroys the SessionClient (e.g. CWD / MCP / tools change)
 * so the next message triggers the activation lock again.
 */
export function clearReadySession(sessionId: string) {
  readySessions.delete(sessionId);
  sessionModes.delete(sessionId);
}

/** @internal — test-only: check if a session is in the ready set. */
export function isSessionReady(sessionId: string): boolean {
  return readySessions.has(sessionId);
}

/** @internal — test-only: add a session to the ready set. */
export function markSessionReady(sessionId: string): void {
  readySessions.add(sessionId);
}

interface InputBoxProps {
  sessionId?: string;
  /** When set, InputBox auto-populates and submits this text, then calls onPromptSent */
  promptToSend?: string | null;
  onPromptSent?: () => void;
  /** Called when the user sends a message (for scroll reset) */
  onMessageSent?: () => void;
  /** Number of pins in the current session (for badge display) */
  pinsCount?: number;
  /** Whether the pins drawer is currently open */
  pinsOpen?: boolean;
  /** Toggle the pins drawer open/closed */
  onPinsToggle?: () => void;
  /** When set, appends this text to the textarea without auto-submitting. */
  prefillText?: string | null;
  /** Called after prefillText has been consumed (appended to input). */
  onPrefillConsumed?: () => void;
}

function fileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico'].includes(ext)) return '🖼️';
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return '🎬';
  if (['mp3', 'wav', 'ogg', 'flac', 'aac'].includes(ext)) return '🎵';
  if (['pdf'].includes(ext)) return '📑';
  if (['xls', 'xlsx', 'csv', 'tsv'].includes(ext)) return '📊';
  if (['doc', 'docx', 'rtf', 'odt'].includes(ext)) return '📝';
  if (['ppt', 'pptx'].includes(ext)) return '📽️';
  if (['zip', 'tar', 'gz', 'rar', '7z'].includes(ext)) return '📦';
  if (['js', 'ts', 'py', 'java', 'cpp', 'c', 'rs', 'go', 'rb', 'cs', 'sh', 'json', 'yaml', 'yml', 'xml', 'html', 'css'].includes(ext)) return '💻';
  if (['md', 'txt', 'log'].includes(ext)) return '📃';
  return '📄';
}

export function InputBox({ sessionId, promptToSend, onPromptSent, onMessageSent, pinsCount, pinsOpen, onPinsToggle, prefillText, onPrefillConsumed }: InputBoxProps) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<(UploadedFile & { attachmentRef: AttachmentRef })[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Slash command state
  const [showSlashPalette, setShowSlashPalette] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [activeCommand, setActiveCommand] = useState<SlashCommand | null>(null);
  const { isNewSession, newSessionSettings, addSession, moveSessionToTop, updateSessionTimestamp, updateSessionName } = useSessionStore();
  const { defaultModel, defaultCwd } = useUIStore();
  const { setAgentActive, markViewed } = useViewedStore();
  const { openTab: openGenericTab } = useTabStore();
  const {
    sendingSessionId,
    getStreamingState,
    setSending,
    setStreaming,
    addMessage,
    appendStreamingContent,
    addStreamingStep,
    setTokenUsage,
    finalizeTurn,
  } = useChatStore();

  // Check if streaming is happening for the current session
  const { isStreaming } = getStreamingState(sessionId || null);
  // Only disable this input if THIS session is currently activating
  const isSending = sendingSessionId === sessionId;
  const isDisabled = isSending;

  // Agent mode state: read from module-level map (survives mount/unmount), fall back to interactive
  const [sessionMode, setSessionMode_] = useState<AgentMode>(
    () => (sessionId ? sessionModes.get(sessionId) : undefined) ?? 'interactive'
  );
  const currentMode: AgentMode = isNewSession
    ? (newSessionSettings?.agentMode as AgentMode) || 'interactive'
    : sessionMode;

  // Sync mode when switching sessions — read from map or reset to interactive
  useEffect(() => {
    setSessionMode_(sessionId ? sessionModes.get(sessionId) ?? 'interactive' : 'interactive');
  }, [sessionId]);

  const handleModeChange = useCallback(async (newMode: AgentMode) => {
    if (isNewSession) {
      // New session: just update store memory
      useSessionStore.getState().updateNewSessionSettings({ agentMode: newMode });
    } else if (sessionId) {
      // Existing session: call backend via runtime-settings endpoint
      setSessionMode_(newMode);
      sessionModes.set(sessionId, newMode); // Persist across mount/unmount
      try {
        const result = await updateRuntimeSettings(sessionId, { mode: newMode });
        const confirmed = (result.mode ?? newMode) as AgentMode;
        setSessionMode_(confirmed);
        sessionModes.set(sessionId, confirmed);
        readySessions.add(sessionId);
      } catch (err) {
        console.error('Failed to set mode:', err);
        setSessionMode_(sessionMode);
        sessionModes.set(sessionId, sessionMode); // Revert
      }
    }
  }, [isNewSession, sessionId, sessionMode]);

  // --- Slash command handlers ---

  const handleSlashSelect = useCallback((cmd: SlashCommand) => {
    setShowSlashPalette(false);
    setSlashQuery('');
    if (cmd.executeImmediately) {
      // /help: show available commands as a system message
      if (cmd.name === 'help') {
        const helpLines = SLASH_COMMANDS.map(c => `${c.icon} **/${c.name}** — ${c.description}`).join('\n');
        const helpContent = `Available commands:\n${helpLines}`;
        if (sessionId) {
          addMessage(sessionId, {
            id: `system-help-${Date.now()}`,
            role: 'system',
            content: helpContent,
            timestamp: new Date().toISOString(),
          });
        }
      }
      return;
    }
    // Set the chip and clear input text
    setActiveCommand(cmd);
    setInput('');
    textareaRef.current?.focus();
  }, [sessionId, addMessage]);

  const handleSlashDismiss = useCallback(() => {
    setShowSlashPalette(false);
    setSlashQuery('');
  }, []);

  const clearActiveCommand = useCallback(() => {
    setActiveCommand(null);
  }, []);

  // Execute a slash command via API (compact only — fleet goes through normal sendMessage)
  const executeSlashCommand = useCallback(async (cmd: SlashCommand, _prompt: string) => {
    if (!sessionId) return;
    try {
      if (cmd.name === 'compact') {
        const result = await compactSession(sessionId);
        const detail = result.success
          ? `tokens freed: ${result.tokens_removed ?? '?'}`
          : 'compaction failed';
        addMessage(sessionId, {
          id: `system-compact-${Date.now()}`,
          role: 'system',
          content: `📦 Compact: ${detail}`,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error(`Failed to execute /${cmd.name}:`, err);
      addMessage(sessionId, {
        id: `system-error-${Date.now()}`,
        role: 'system',
        content: `❌ Failed to execute /${cmd.name}: ${err instanceof Error ? err.message : 'Unknown error'}`,
        timestamp: new Date().toISOString(),
      });
    }
  }, [sessionId, addMessage]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [input]);

  // Upload files and add to attachments
  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    // No session yet (new session tab) — store raw files for upload at submit time
    if (!sessionId) {
      setPendingFiles((prev) => [...prev, ...fileArray]);
      return;
    }

    setIsUploading(true);
    try {
      const results = await Promise.all(
        fileArray.map(async (file) => {
          const uploaded = await uploadFile(file, sessionId);
          return {
            ...uploaded,
            attachmentRef: { type: 'file' as const, path: uploaded.path, displayName: uploaded.originalName },
          };
        })
      );
      setAttachments((prev) => [...prev, ...results]);
    } catch (err) {
      console.error('Failed to upload files:', err);
    } finally {
      setIsUploading(false);
    }
  }, [sessionId]);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Drag and drop handlers
  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);
  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);
  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  // Paste handler for images
  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      handleFiles(files);
    }
  }, [handleFiles]);

  const handleAbort = async () => {
    if (!sessionId) return;
    try {
      await abortSession(sessionId);
    } catch (err) {
      console.error('Failed to abort:', err);
    }
  };

  // Auto-submit starter prompt when provided
  useEffect(() => {
    if (promptToSend) {
      handleSubmit(promptToSend);
      onPromptSent?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptToSend]);

  // Prefill textarea from [Ask] button — appends to existing input, does NOT auto-submit
  useEffect(() => {
    if (!prefillText) return;
    setInput((prev) => prev.trim() ? `${prev}\n${prefillText}` : prefillText);
    onPrefillConsumed?.();
    // Double rAF: first waits for React commit, second for DOM paint
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.selectionStart = el.selectionEnd = el.value.length;
        el.scrollTop = el.scrollHeight;
      }
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillText]);

  const handleSubmit = async (overrideText?: string) => {
    const trimmedInput = (overrideText || input).trim();

    // Slash command dispatch — if a command chip is active
    let isFleet = false;
    if (activeCommand) {
      if (activeCommand.name === 'fleet') {
        // Fleet goes through the normal sendMessage pipeline with fleet flag
        if (!trimmedInput) return; // Fleet requires a prompt
        isFleet = true;
        setActiveCommand(null);
        // Fall through to normal message flow below
      } else {
        // Non-fleet commands (compact, help) use executeSlashCommand
        if (activeCommand.requiresPrompt && !trimmedInput) return;
        setInput('');
        setActiveCommand(null);
        await executeSlashCommand(activeCommand, trimmedInput);
        return;
      }
    }

    if ((!isFleet && !trimmedInput && attachments.length === 0 && pendingFiles.length === 0) || isDisabled) return;

    // If agent is already running, enqueue the follow-up message.
    // Read currentSessionId from store directly (not the prop) to avoid
    // the race where the prop hasn't updated yet after session creation.
    const currentId = sessionId || useTabStore.getState().getActiveSessionId();
    if (isStreaming && currentId) {
      const enqueueAttachments = attachments.map((a) => a.attachmentRef);
      const resolvedContent = trimmedInput || (enqueueAttachments.length > 0 ? 'See attached file(s).' : '');
      const userMessage = {
        id: `temp-${Date.now()}`,
        role: 'user' as const,
        content: resolvedContent,
        timestamp: new Date().toISOString(),
        mode: 'enqueue' as const,
        attachments: enqueueAttachments.length > 0 ? enqueueAttachments.map((a) => ({ type: a.type, path: a.path, displayName: a.displayName })) : undefined,
      };
      addMessage(currentId, userMessage);
      updateSessionTimestamp(currentId);
      setInput('');
      setAttachments([]);

      try {
        await enqueueMessage(currentId, resolvedContent, enqueueAttachments.length > 0 ? enqueueAttachments : undefined);
      } catch (err) {
        console.error('Failed to enqueue message:', err);
      }
      return;
    }

    let activeSessionId = sessionId;
    // Track if this is a brand new session being created
    let isCreatingNewSession = isNewSession || !sessionId;
    // Capture pending mode before addSession clears newSessionSettings
    let initialAgentMode: string | undefined;

    setInput('');
    const pendingAttachments = attachments.map((a) => a.attachmentRef);
    setAttachments([]);

    // If this is a new session, create it first with the pending settings
    if (isNewSession || !sessionId) {
      try {
        // Use newSessionSettings if available, otherwise use defaults
        const sessionModel = newSessionSettings?.model || defaultModel;
        const sessionCwd = newSessionSettings?.cwd || defaultCwd;
        const sessionName = newSessionSettings?.name || 'New Session';
        const sessionMcpServers = newSessionSettings?.mcpServers;
        const sessionTools = newSessionSettings?.tools;
        // Capture mode before addSession clears newSessionSettings
        const pendingAgentMode = newSessionSettings?.agentMode;
        
        const session = await createSession({ 
          model: sessionModel,
          reasoning_effort: newSessionSettings?.reasoningEffort,
          name: sessionName,
          cwd: sessionCwd,
          mcp_servers: sessionMcpServers,
          tools: sessionTools,
          system_message: newSessionSettings?.systemMessage,
          agent_id: newSessionSettings?.agentId,
          sub_agents: newSessionSettings?.subAgents,
        });
        // Write mode to map BEFORE addSession triggers re-render and new InputBox mounts
        if (pendingAgentMode && pendingAgentMode !== 'interactive') {
          initialAgentMode = pendingAgentMode;
          sessionModes.set(session.session_id, pendingAgentMode as AgentMode);
        }
        addSession(session);
        openGenericTab({ id: tabId.session(session.session_id), type: 'session', label: session.session_name, sessionId: session.session_id });
        await connectSession(session.session_id);
        activeSessionId = session.session_id;
      } catch (err) {
        console.error('Failed to create session:', err);
        setSending(null);
        return;
      }
    } else {
      // Move existing session to top
      moveSessionToTop(sessionId);
    }

    if (!activeSessionId) {
      console.error('No session ID');
      return;
    }

    // Upload any pending files now that we have a session ID
    if (pendingFiles.length > 0) {
      try {
        const uploadResults = await Promise.all(
          pendingFiles.map(async (file) => {
            const uploaded = await uploadFile(file, activeSessionId!);
            return {
              type: 'file' as const,
              path: uploaded.path,
              displayName: uploaded.originalName,
            };
          })
        );
        pendingAttachments.push(...uploadResults);
      } catch (err) {
        console.error('Failed to upload pending files:', err);
      }
      setPendingFiles([]);
    }

    // For sessions not yet confirmed ready on the backend, lock input
    // until the first SSE event arrives (proves SessionClient is alive).
    // Once confirmed, subsequent messages skip the lock.
    // Placed here so we always have the real session ID (even for new sessions).
    const needsLock = !readySessions.has(activeSessionId);
    if (needsLock) {
      setSending(activeSessionId);
    }

    // Add user message to UI immediately and update timestamp
    const resolvedPrompt = trimmedInput || (pendingAttachments.length > 0 ? 'See attached file(s).' : '');
    const userMessage = {
      id: `temp-${Date.now()}`,
      role: 'user' as const,
      content: resolvedPrompt,
      timestamp: new Date().toISOString(),
      attachments: pendingAttachments.length > 0 ? pendingAttachments.map((a) => ({ type: a.type, path: a.path, displayName: a.displayName })) : undefined,
    };
    addMessage(activeSessionId, userMessage);
    onMessageSent?.();
    updateSessionTimestamp(activeSessionId);
    setStreaming(activeSessionId, true);

    // Fleet indicator — show "Fleet deployed" system message
    if (isFleet) {
      addMessage(activeSessionId, {
        id: `system-fleet-${Date.now()}`,
        role: 'system',
        content: `🚀 Fleet deployed: "${resolvedPrompt.length > 100 ? resolvedPrompt.slice(0, 100) + '...' : resolvedPrompt}"`,
        timestamp: new Date().toISOString(),
      });
    }
    
    // Mark as viewed NOW so we have a baseline timestamp for unread detection
    // This ensures that when agent completes, updated_at > lastViewed
    markViewed(activeSessionId);
    
    // Track that this session has an active agent
    setAgentActive(activeSessionId, true);

    // sendingCleared tracks whether we've re-enabled input on first SSE event.
    let sendingCleared = !needsLock; // already unlocked if session was ready
    const clearSendingOnce = () => {
      if (!sendingCleared) {
        if (activationTimer) clearTimeout(activationTimer);
        readySessions.add(activeSessionId!);
        setSending(null);
        sendingCleared = true;
      }
    };

    // Safety timeout: if activation takes too long, unlock input with error
    let activationTimer: ReturnType<typeof setTimeout> | null = null;
    if (needsLock) {
      activationTimer = setTimeout(() => {
        if (!sendingCleared) {
          clearSendingOnce();
          setStreaming(activeSessionId!, false);
          setAgentActive(activeSessionId!, false);
          addMessage(activeSessionId!, {
            id: `system-timeout-${Date.now()}`,
            role: 'system',
            content: '⚠️ Session activation timed out. An MCP server may be unresponsive. Try sending your message again.',
            timestamp: new Date().toISOString(),
          });
        }
      }, 45_000); // 45s — slightly longer than backend's 30s timeout
    }

    try {
      await sendMessage(
        activeSessionId,
        resolvedPrompt,
        (delta) => {
          clearSendingOnce();
          appendStreamingContent(activeSessionId!, delta);
        },
        (step) => {
          clearSendingOnce();
          // Compaction notifications → system message (they arrive after finalizeTurn and would be lost)
          if (step.title?.startsWith('⟳ Compacting') || step.title?.startsWith('✓ Context compacted') || step.title?.startsWith('✗ Compaction')) {
            const detail = step.detail ? ` — ${step.detail}` : '';
            addMessage(activeSessionId!, {
              id: `system-${Date.now()}`,
              role: 'system',
              content: `${step.title}${detail}`,
              timestamp: new Date().toISOString(),
            });
          } else {
            addStreamingStep(activeSessionId!, step);
          }
        },
        (usage) => {
          setTokenUsage(activeSessionId!, usage);
        },
        (_messageId, sessionName) => {
          if (activationTimer) clearTimeout(activationTimer);
          // All responses already finalized by turn_done / finalizeTurn().
          // Just clean up streaming & agent state.
          setStreaming(activeSessionId!, false);
          setSending(null);
          setAgentActive(activeSessionId!, false);
          // Auto-name: update session name if server sent an auto-generated name
          if (sessionName && activeSessionId) {
            updateSessionName(activeSessionId, sessionName);
          }
          // Update the session's timestamp so the sidebar shows it was modified
          updateSessionTimestamp(activeSessionId!);
          // If user is still viewing this session, mark as viewed
          const currentSession = useTabStore.getState().getActiveSessionId();
          if (currentSession === activeSessionId) {
            markViewed(activeSessionId!);
          }
        },
        (error) => {
          if (activationTimer) clearTimeout(activationTimer);
          console.error('Message error:', error);
          setStreaming(activeSessionId!, false);
          setSending(null);
          setAgentActive(activeSessionId!, false);
        },
        isCreatingNewSession,  // Skip resume attempt for brand new sessions
        undefined,  // onPendingMessages — not needed, finalizeTurn handles mode clearing
        (messageId?: string) => {
          // turn_done — agent finished responding to one message, more queued.
          // Insert the assistant response before the next queued user message.
          finalizeTurn(activeSessionId!, messageId);
        },
        pendingAttachments.length > 0 ? pendingAttachments : undefined,
        (mode) => { setSessionMode_(mode as AgentMode); if (activeSessionId) sessionModes.set(activeSessionId, mode as AgentMode); },
        initialAgentMode,
        isFleet
      );
    } catch (err) {
      if (activationTimer) clearTimeout(activationTimer);
      console.error('Failed to send message:', err);
      if (activeSessionId) {
        setStreaming(activeSessionId, false);
        setAgentActive(activeSessionId, false);
      }
      setSending(null);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // If palette is open, let it handle navigation keys
    if (showSlashPalette) {
      if (['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(e.key)) {
        // Handled by the palette's global keydown listener
        return;
      }
    }
    // Backspace on empty input clears the active command chip
    if (e.key === 'Backspace' && input === '' && activeCommand) {
      e.preventDefault();
      clearActiveCommand();
      return;
    }
    // Escape dismisses the command chip
    if (e.key === 'Escape' && activeCommand) {
      e.preventDefault();
      clearActiveCommand();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Handle input changes — detect slash command typing
  const handleInputChange = useCallback((value: string) => {
    setInput(value);
    if (!activeCommand && value.startsWith('/') && !value.includes(' ')) {
      // Show palette and filter by typed query
      setShowSlashPalette(true);
      setSlashQuery(value.slice(1));
    } else if (!activeCommand && value.startsWith('/') && value.includes(' ')) {
      // Space after a slash command name — auto-complete if exact match
      const cmdName = value.slice(1, value.indexOf(' '));
      const matched = SLASH_COMMANDS.find(c => c.name === cmdName);
      if (matched) {
        setShowSlashPalette(false);
        setSlashQuery('');
        if (matched.executeImmediately) {
          // Execute immediately (e.g. /help)
          handleSlashSelect(matched);
          setInput('');
        } else {
          // Set chip and keep the text after the space as prompt
          setActiveCommand(matched);
          setInput(value.slice(value.indexOf(' ') + 1));
        }
      } else {
        setShowSlashPalette(false);
        setSlashQuery('');
      }
    } else if (showSlashPalette) {
      setShowSlashPalette(false);
      setSlashQuery('');
    }
  }, [activeCommand, showSlashPalette, handleSlashSelect]);

  return (
    <div
      className={`border-t border-gray-200 dark:border-[#3a3a4e] bg-white dark:bg-[#1e1e2e] px-6 py-3 ${isDragOver ? 'ring-2 ring-blue-400 bg-blue-50 dark:bg-blue-900/30' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="max-w-4xl mx-auto">
        {/* Attachment chips */}
        {(attachments.length > 0 || pendingFiles.length > 0) && (
          <div className="flex flex-wrap gap-2 mb-2">
            {attachments.map((att, idx) => {
              return (
                <div key={`uploaded-${idx}`} className="flex items-center gap-1.5 bg-gray-50 dark:bg-[#2a2a3c] border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1 text-sm">
                  <span className="text-gray-500 dark:text-gray-400">{fileIcon(att.originalName)}</span>
                  <span className="text-gray-700 dark:text-gray-200 max-w-[200px] truncate">{att.originalName}</span>
                  <span className="text-gray-400 dark:text-gray-500 text-xs">({(att.size / 1024).toFixed(0)}KB)</span>
                  <button onClick={() => removeAttachment(idx)} className="text-gray-400 dark:text-gray-500 hover:text-red-500 ml-0.5" title="Remove">×</button>
                </div>
              );
            })}
            {pendingFiles.map((file, idx) => (
              <div key={`pending-${idx}`} className="flex items-center gap-1.5 bg-gray-50 dark:bg-[#2a2a3c] border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1 text-sm">
                <span className="text-gray-500 dark:text-gray-400">{fileIcon(file.name)}</span>
                <span className="text-gray-700 dark:text-gray-200 max-w-[200px] truncate">{file.name}</span>
                <span className="text-gray-400 dark:text-gray-500 text-xs">({(file.size / 1024).toFixed(0)}KB)</span>
                <button onClick={() => setPendingFiles((prev) => prev.filter((_, i) => i !== idx))} className="text-gray-400 dark:text-gray-500 hover:text-red-500 ml-0.5" title="Remove">×</button>
              </div>
            ))}
          </div>
        )}
        {isUploading && (
          <div className="text-xs text-gray-400 dark:text-gray-500 mb-1">Uploading...</div>
        )}
        {/* Input row — mirrors message layout: flex gap-3 [avatar-col w-8] [content flex-1] */}
        <div className="flex gap-3 items-center relative">
          {/* Avatar column: attach icon (aligns with avatars), mode selector floats left */}
          <div className="w-8 flex-shrink-0 relative flex items-center justify-center">
            {/* Mode selector — floats to the left of the avatar column */}
            <div className="absolute right-full mr-2 top-1/2 -translate-y-1/2 whitespace-nowrap z-10">
              <ModeSelector mode={currentMode} onModeChange={handleModeChange} disabled={isSending} />
            </div>
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = ''; }}
            />
            {/* Attach button — aligns with message avatars */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="h-8 w-8 flex items-center justify-center text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 disabled:opacity-50 rounded-full"
              title="Attach files"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>
          </div>
          {/* Content column — aligns with message bubble content */}
          <div className="flex-1 min-w-0 relative">
            {/* Slash command palette — floats above the input */}
            {showSlashPalette && (
              <SlashCommandPalette
                query={slashQuery}
                onSelect={(cmd) => { handleSlashSelect(cmd); setInput(''); }}
                onDismiss={handleSlashDismiss}
              />
            )}
            <div className="flex items-center gap-2">
              {/* Textarea with optional command chip inline */}
              <div className={`flex-1 min-w-0 flex items-center gap-2 rounded-lg border px-4 py-3 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent dark:bg-[#2a2a3c] ${
                isDragOver ? 'border-blue-400' : activeCommand ? 'border-blue-300 bg-blue-50/50 dark:border-blue-600 dark:bg-blue-900/10' : isStreaming ? 'border-amber-300 bg-amber-50 dark:border-amber-600 dark:bg-amber-900/20' : 'border-gray-300 dark:border-gray-600'
              }`}>
                {/* Command chip — inline inside the input */}
                {activeCommand && (
                  <button
                    onClick={clearActiveCommand}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-500/25 dark:text-blue-100 border border-blue-200 dark:border-blue-400/30 hover:bg-blue-200 dark:hover:bg-blue-500/35 transition-colors flex-shrink-0"
                    title={`Remove /${activeCommand.name} command`}
                  >
                    <span>{activeCommand.icon}</span>
                    <span>/{activeCommand.name}</span>
                    <span className="ml-0.5 text-blue-400 dark:text-blue-300">×</span>
                  </button>
                )}
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => handleInputChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder={activeCommand
                    ? (activeCommand.placeholder || `Press Send to execute /${activeCommand.name}`)
                    : isSending
                      ? "Activating session, please wait..."
                      : isStreaming 
                        ? "Type a follow-up... (will be queued for the agent)" 
                        : "Type a message... (Enter to send, Shift+Enter for new line)"}
                  className="flex-1 resize-none max-h-[200px] bg-transparent focus:outline-none dark:text-gray-100 dark:placeholder-gray-500"
                  rows={1}
                />
              </div>
            {/* Send button */}
            <Button
              onClick={() => handleSubmit()}
              disabled={
                activeCommand
                  ? (activeCommand.requiresPrompt && !input.trim()) || isDisabled
                  : (!input.trim() && attachments.length === 0 && pendingFiles.length === 0) || isDisabled
              }
              className="h-11 w-11 p-0"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </Button>
            {/* Stop button — always visible, disabled when not streaming */}
            <Button
              onClick={handleAbort}
              disabled={!isStreaming}
              className={`h-11 w-11 p-0 ${
                isStreaming
                  ? 'bg-red-500 hover:bg-red-600'
                  : 'bg-gray-200 dark:bg-gray-700 opacity-40 cursor-not-allowed'
              }`}
              title="Stop the agent"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
            </Button>
            </div>
          </div>
          {/* Pin drawer toggle — absolutely positioned right of stop button, outside bubble boundary */}
          {onPinsToggle && (pinsCount ?? 0) > 0 && (
            <button
              type="button"
              onClick={onPinsToggle}
              className={`absolute left-full ml-2 top-1/2 -translate-y-1/2 h-11 w-11 flex items-center justify-center rounded-lg transition-colors ${
                pinsOpen
                  ? 'bg-red-50 dark:bg-red-900/30 ring-1 ring-red-200 dark:ring-red-800'
                  : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
              title={pinsOpen ? 'Close pins drawer' : 'Open pins drawer'}
            >
              <PinnedIcon size={16} />
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-0.5">
                {pinsCount}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
