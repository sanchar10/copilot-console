import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { mobileApiClient, getApiBase, getHeaders } from '../mobileClient';
import { SSE_EVENTS } from '../../utils/sseConstants';
import { useChatStore } from '../../stores/chatStore';
import { useViewedStore } from '../../stores/viewedStore';
import { useSessionStore } from '../../stores/sessionStore';
import type { Message } from '../../types/message';
import type { ChatStep } from '../../types/message';
import type { AskUserRequest, ElicitationRequest } from '../../api/sessions';
import { parseSteps, countUserInputs } from '../mobileStepParser';
import { MobileAskUserCard } from './MobileAskUserCard';
import { MobileElicitationCard } from './MobileElicitationCard';

const EMPTY_MESSAGES: Message[] = [];

interface SessionData {
  session_id: string;
  session_name: string;
  model: string;
  messages: Message[];
}

interface ResponseStatus {
  active: boolean;
  status?: string;
  chunks_count?: number;
  steps_count?: number;
}

export function MobileChatView() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionData | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const isProgrammaticScrollRef = useRef(false);
  const initialScrollDoneRef = useRef(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const isMountedRef = useRef(true);

  // Pending ask_user / elicitation state
  const [pendingAskUser, setPendingAskUser] = useState<AskUserRequest | null>(null);
  const [pendingElicitation, setPendingElicitation] = useState<ElicitationRequest | null>(null);
  const pendingRequestRef = useRef<{ type: 'ask_user' | 'elicitation'; requestId: string } | null>(null);

  // Read from chatStore (use shallow equality to avoid infinite re-render from new [] refs)
  const messages = useChatStore(s => sessionId ? s.messagesPerSession[sessionId] : undefined) ?? EMPTY_MESSAGES;
  const streamingState = useChatStore(s => s.getStreamingState(sessionId || null));
  const setMessages = useChatStore(s => s.setMessages);
  const addMessage = useChatStore(s => s.addMessage);
  const appendStreamingContent = useChatStore(s => s.appendStreamingContent);
  const addStreamingStep = useChatStore(s => s.addStreamingStep);
  const setStreaming = useChatStore(s => s.setStreaming);
  const finalizeTurn = useChatStore(s => s.finalizeTurn);

  const { markViewed, setAgentActive } = useViewedStore();
  const updateSessionTimestamp = useSessionStore(s => s.updateSessionTimestamp);
  const updateSessionName = useSessionStore(s => s.updateSessionName);

  // Load session data
  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      try {
        const data = await mobileApiClient.get<SessionData>(`/sessions/${sessionId}`);
        setSession(data);
        setMessages(sessionId, data.messages);
        // Sync in-memory store so blue dot clears immediately (no pull-to-refresh needed)
        markViewed(sessionId);

        // Check if there's an active response to resume
        const status = await mobileApiClient.get<ResponseStatus>(`/sessions/${sessionId}/response-status`);
        if (status.active) {
          resumeStream(status.chunks_count || 0, status.steps_count || 0);
        } else {
          // No active response — clear any stale streaming/agent state
          setStreaming(sessionId, false);
          setAgentActive(sessionId, false);
        }
      } catch (err) {
        console.error('Failed to load session:', err);
        setError(err instanceof Error ? err.message : 'Failed to load session');
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId]);

  // Reset scroll tracking when entering a new session
  useEffect(() => {
    initialScrollDoneRef.current = false;
    userScrolledUpRef.current = false;
    setShowScrollButton(false);
  }, [sessionId]);

  // Detect if user is near the bottom of the scroll container
  const isNearBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  }, []);

  // Track user scroll to show/hide ↓ button
  const handleScroll = useCallback(() => {
    if (isProgrammaticScrollRef.current) return;
    const nearBottom = isNearBottom();
    userScrolledUpRef.current = !nearBottom;
    setShowScrollButton(!nearBottom);
  }, [isNearBottom]);
  // Scroll to bottom — used for both initial load and auto-scroll
  const doScrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    isProgrammaticScrollRef.current = true;
    el.scrollTop = el.scrollHeight - el.clientHeight;
    setTimeout(() => { isProgrammaticScrollRef.current = false; }, 50);
  }, []);

  // Auto-scroll on messages/streaming changes
  useEffect(() => {
    if (messages.length === 0 || loading) return;

    if (!initialScrollDoneRef.current) {
      // Initial load: scroll to bottom unconditionally, with delay to ensure DOM is painted
      initialScrollDoneRef.current = true;
      setTimeout(() => doScrollToBottom(), 50);
    } else if (!userScrolledUpRef.current) {
      // Subsequent updates: only if user hasn't scrolled up
      doScrollToBottom();
    }
  }, [messages, streamingState.content, loading, doScrollToBottom]);

  // Scroll-to-bottom handler for the floating button
  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    userScrolledUpRef.current = false;
    setShowScrollButton(false);
    isProgrammaticScrollRef.current = true;
    el.scrollTop = el.scrollHeight - el.clientHeight;
    setTimeout(() => { isProgrammaticScrollRef.current = false; }, 50);
  }, []);

  // Cleanup event source + cancel pending requests on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      eventSourceRef.current?.close();
      // Cancel pending ask_user/elicitation if user navigates away
      // Use fetch with keepalive for reliable delivery during navigation
      const pending = pendingRequestRef.current;
      if (pending && sessionId) {
        const base = getApiBase();
        const headers = getHeaders({ 'Content-Type': 'application/json' });
        if (pending.type === 'ask_user') {
          fetch(`${base}/sessions/${sessionId}/user-input-response`, {
            method: 'POST', headers, keepalive: true,
            body: JSON.stringify({ request_id: pending.requestId, cancelled: true }),
          }).catch(() => {});
        } else {
          fetch(`${base}/sessions/${sessionId}/elicitation-response`, {
            method: 'POST', headers, keepalive: true,
            body: JSON.stringify({ request_id: pending.requestId, action: 'cancel' }),
          }).catch(() => {});
        }
        pendingRequestRef.current = null;
      }
    };
  }, [sessionId]);

  const reloadMessages = useCallback((sid: string) => {
    mobileApiClient.get<SessionData>(`/sessions/${sid}`)
      .then(data => {
        setMessages(sid, data.messages);
        setStreaming(sid, false);
        if (isMountedRef.current) markViewed(sid);
      })
      .catch(() => {});
  }, [setMessages, setStreaming, markViewed]);

  const resumeStream = useCallback((fromChunk = 0, fromStep = 0) => {
    if (!sessionId) return;
    eventSourceRef.current?.close();

    const es = mobileApiClient.createEventSource(
      `/sessions/${sessionId}/response-stream`,
      { from_chunk: String(fromChunk), from_step: String(fromStep) }
    );
    eventSourceRef.current = es;
    setStreaming(sessionId, true);

    es.addEventListener(SSE_EVENTS.DELTA, (event) => {
      const data = JSON.parse(event.data);
      appendStreamingContent(sessionId, data.content);
    });

    es.addEventListener(SSE_EVENTS.STEP, (event) => {
      const step = JSON.parse(event.data);
      addStreamingStep(sessionId, step);
    });

    es.addEventListener(SSE_EVENTS.DONE, () => {
      es.close();
      reloadMessages(sessionId);
    });

    es.addEventListener(SSE_EVENTS.ERROR, () => {
      es.close();
      reloadMessages(sessionId);
    });

    // Handle ask_user/elicitation in resume stream (unlikely but safety net)
    es.addEventListener('ask_user', (event) => {
      const data = JSON.parse(event.data);
      if (data.request_id) {
        setPendingAskUser(data as AskUserRequest);
        pendingRequestRef.current = { type: 'ask_user', requestId: data.request_id };
      }
    });

    es.addEventListener('elicitation', (event) => {
      const data = JSON.parse(event.data);
      if (data.request_id) {
        setPendingElicitation(data as ElicitationRequest);
        pendingRequestRef.current = { type: 'elicitation', requestId: data.request_id };
      }
    });

    es.onerror = () => {
      // EventSource will try to reconnect automatically
    };
  }, [sessionId]);

  const handleSend = async () => {
    if (!input.trim() || !sessionId || sending) return;
    const content = input.trim();
    setInput('');
    setSending(true);

    // Re-engage auto-scroll when user sends a message
    userScrolledUpRef.current = false;
    setShowScrollButton(false);

    // Optimistic UI: add user message
    const userMsg: Message = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    };
    addMessage(sessionId, userMsg);
    setStreaming(sessionId, true);
    setAgentActive(sessionId, true);

    try {
      // Check if agent is active — enqueue if so, otherwise send new message
      const status = await mobileApiClient.get<ResponseStatus>(`/sessions/${sessionId}/response-status`);

      if (status.active) {
        // Enqueue to running agent
        await mobileApiClient.post(`/sessions/${sessionId}/enqueue`, {
          content,
          is_new_session: false,
        });
        // Resume the existing stream
        resumeStream(status.chunks_count, status.steps_count);
      } else {
        // Connect session first
        await mobileApiClient.post(`/sessions/${sessionId}/connect`);

        // POST /messages returns an SSE stream — read it directly (same as desktop)
        const response = await fetch(`${getApiBase()}/sessions/${sessionId}/messages`, {
          method: 'POST',
          headers: getHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ content, is_new_session: false }),
        });

        if (!response.ok || !response.body) {
          reloadMessages(sessionId);
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = '';
        let receivedDone = false;

        const onDone = (sessionName?: string) => {
          setStreaming(sessionId, false);
          setAgentActive(sessionId, false);
          // Always bump timestamp so blue dot can appear if user navigated away
          updateSessionTimestamp(sessionId);
          // Only mark viewed if user is still on this chat screen
          if (isMountedRef.current) markViewed(sessionId);
          if (sessionName) updateSessionName(sessionId, sessionName);
        };

        const processEvent = (eventText: string) => {
          const lines = eventText.split(/\r?\n/);
          let eventName = '';
          let eventData = '';
          for (const line of lines) {
            if (line.startsWith('event:')) eventName = line.replace(/^event:\s?/, '').trim();
            else if (line.startsWith('data:')) eventData = line.replace(/^data:\s?/, '');
          }
          if (!eventData) return;
          try {
            const data = JSON.parse(eventData);
            if (eventName === SSE_EVENTS.DELTA && data.content !== undefined) {
              appendStreamingContent(sessionId, data.content);
            } else if (eventName === SSE_EVENTS.STEP && data.title) {
              addStreamingStep(sessionId, data);
            } else if (eventName === 'turn_done') {
              finalizeTurn(sessionId);
            } else if (eventName === SSE_EVENTS.DONE) {
              receivedDone = true;
              onDone(data.session_name);
            } else if (eventName === SSE_EVENTS.ERROR) {
              receivedDone = true;
              setStreaming(sessionId, false);
              setAgentActive(sessionId, false);
            } else if (eventName === 'ask_user' && data.request_id) {
              setPendingAskUser(data as AskUserRequest);
              pendingRequestRef.current = { type: 'ask_user', requestId: data.request_id };
            } else if (eventName === 'elicitation' && data.request_id) {
              setPendingElicitation(data as ElicitationRequest);
              pendingRequestRef.current = { type: 'elicitation', requestId: data.request_id };
            }
          } catch { /* skip malformed event */ }
        };

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            sseBuffer += decoder.decode(value, { stream: true });
            const events = sseBuffer.split(/\r?\n\r?\n/);
            sseBuffer = events.pop() || '';

            for (const event of events) {
              processEvent(event);
            }
          }

          // Flush decoder and process any remaining buffered event
          sseBuffer += decoder.decode();
          if (sseBuffer.trim()) {
            processEvent(sseBuffer);
          }

          // Safety net: if DONE was never received but stream ended normally
          if (!receivedDone) {
            onDone();
          }
        } catch {
          // Stream interrupted — reload to get final state
          reloadMessages(sessionId);
        }
      }
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setSending(false);
    }
  };

  const handleAbort = async () => {
    if (!sessionId) return;
    try {
      await mobileApiClient.post(`/sessions/${sessionId}/abort`);
      eventSourceRef.current?.close();
      reloadMessages(sessionId);
    } catch (err) {
      console.error('Failed to abort:', err);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex flex-col bg-[#fafafa] dark:bg-[#1e1e2e]">
        <div className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-[#252536] border-b border-gray-200 dark:border-[#3a3a4e]">
          <button onClick={() => navigate('/mobile')} className="p-2 -ml-1 text-gray-600 dark:text-gray-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Loading...</h2>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full" />
        </div>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="h-full flex flex-col bg-[#fafafa] dark:bg-[#1e1e2e]">
        <div className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-[#252536] border-b border-gray-200 dark:border-[#3a3a4e]">
          <button onClick={() => navigate('/mobile')} className="p-2 -ml-1 text-gray-600 dark:text-gray-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Error</h2>
        </div>
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <div>
            <p className="text-4xl mb-3">⚠️</p>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{error || 'Could not load session'}</p>
            <button onClick={() => navigate('/mobile')} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg">
              Back to Sessions
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#fafafa] dark:bg-[#1e1e2e]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-[#252536] border-b border-gray-200 dark:border-[#3a3a4e]">
        <button
          onClick={() => navigate('/mobile')}
          className="p-2 -ml-1 text-gray-600 dark:text-gray-400"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
            {session?.session_name || 'Session'}
          </h2>
          <div className="text-xs text-gray-400 dark:text-gray-500">
            {session?.model}
            {streamingState.isStreaming && ' · Agent running...'}
          </div>
        </div>
        {streamingState.isStreaming && (
          <button
            onClick={handleAbort}
            className="px-3 py-1.5 text-xs bg-red-500 text-white rounded-lg"
          >
            Stop
          </button>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-3 py-2 relative">
        <div className="space-y-3 max-w-2xl mx-auto">
          {messages.map(msg => (
            <MobileMessageBubble key={msg.id} message={msg} />
          ))}
          {streamingState.isStreaming && streamingState.content && (
            <div className="flex justify-start">
              <div className="max-w-[85%] bg-white dark:bg-[#2a2a3c] rounded-2xl rounded-bl-md px-3 py-2 shadow-sm border border-gray-100 dark:border-[#3a3a4e]">
                <pre className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap font-sans break-words">
                  {streamingState.content}
                </pre>
                {streamingState.steps.length > 0 && (
                  <StepsAccordion steps={streamingState.steps} />
                )}
              </div>
            </div>
          )}
          {streamingState.isStreaming && !streamingState.content && (
            <div className="flex justify-start">
              <div className="bg-white dark:bg-[#2a2a3c] rounded-2xl px-4 py-3 shadow-sm border border-gray-100 dark:border-[#3a3a4e]">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}

          {/* Pending ask_user card */}
          {pendingAskUser && sessionId && (
            <MobileAskUserCard
              sessionId={sessionId}
              requestId={pendingAskUser.request_id}
              question={pendingAskUser.question}
              choices={pendingAskUser.choices}
              allowFreeform={pendingAskUser.allowFreeform}
              onResolved={() => {
                setPendingAskUser(null);
                pendingRequestRef.current = null;
                // Resume stream to receive agent's continued response
                resumeStream();
              }}
            />
          )}

          {/* Pending elicitation card */}
          {pendingElicitation && sessionId && (
            <MobileElicitationCard
              sessionId={sessionId}
              requestId={pendingElicitation.request_id}
              message={pendingElicitation.message}
              schema={pendingElicitation.schema}
              onResolved={() => {
                setPendingElicitation(null);
                pendingRequestRef.current = null;
                // Resume stream to receive agent's continued response
                resumeStream();
              }}
            />
          )}

          <div ref={messagesEndRef} />
        </div>
        <button
          onClick={scrollToBottom}
          className={`sticky bottom-2 left-1/2 -translate-x-1/2 bg-black/20 dark:bg-white/20 backdrop-blur-sm text-gray-800 dark:text-gray-100 w-10 h-10 rounded-full shadow-lg flex items-center justify-center z-10 transition-opacity duration-200 ${showScrollButton ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          aria-label="Scroll to bottom"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
        </button>
      </div>

      {/* Input */}
      <div className="px-3 py-2 bg-white dark:bg-[#252536] border-t border-gray-200 dark:border-[#3a3a4e] safe-bottom">
        <div className="flex items-end gap-2 max-w-2xl mx-auto">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={pendingAskUser || pendingElicitation ? 'Respond above ↑' : streamingState.isStreaming ? 'Agent is working...' : 'Type a message...'}
            rows={1}
            className="flex-1 resize-none rounded-xl border border-gray-200 dark:border-[#3a3a4e] bg-gray-50 dark:bg-[#2a2a3c] px-3 py-2.5 text-base text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            style={{ maxHeight: '120px' }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="p-2.5 bg-blue-600 text-white rounded-xl disabled:opacity-40 flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function MobileMessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-2xl px-3 py-2 shadow-sm ${
        isUser
          ? 'bg-blue-600 text-white rounded-br-md'
          : 'bg-white dark:bg-[#2a2a3c] text-gray-800 dark:text-gray-200 rounded-bl-md border border-gray-100 dark:border-[#3a3a4e]'
      }`}>
        <pre className="text-sm whitespace-pre-wrap font-sans break-words">{message.content}</pre>
        {message.steps && message.steps.length > 0 && !isUser && (
          <StepsAccordion steps={message.steps} />
        )}
      </div>
    </div>
  );
}

function StepsAccordion({ steps }: { steps: ChatStep[] }) {
  const [open, setOpen] = useState(false);
  const parsed = parseSteps(steps);
  const userInputs = countUserInputs(parsed);

  if (parsed.length === 0) return null;

  return (
    <div className="mt-2 border-t border-gray-200 dark:border-[#3a3a4e] pt-1.5">
      <button
        onClick={() => setOpen(!open)}
        className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1"
      >
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        {parsed.length} step{parsed.length !== 1 ? 's' : ''}
        {userInputs > 0 && <span className="text-amber-500"> · {userInputs} input{userInputs > 1 ? 's' : ''}</span>}
      </button>
      {open && (
        <div className="mt-1 space-y-0.5">
          {parsed.map((p, i) => {
            if (p.type === 'ask_user') {
              return (
                <div key={i} className="text-xs pl-3 py-0.5 border-l-2 border-amber-400 dark:border-amber-600">
                  <span className="text-amber-700 dark:text-amber-400">💬 {p.question}</span>
                  <br />
                  <span className="text-emerald-700 dark:text-emerald-400">→ {p.answer}</span>
                </div>
              );
            }
            if (p.type === 'elicitation') {
              return (
                <div key={i} className="text-xs pl-3 py-0.5 border-l-2 border-blue-400 dark:border-blue-600">
                  <span className="text-blue-700 dark:text-blue-400">📋 {p.message}</span>
                  <br />
                  <span className="text-emerald-700 dark:text-emerald-400">→ {p.response}</span>
                </div>
              );
            }
            return (
              <div key={i} className="text-xs text-gray-500 dark:text-gray-400 pl-3 truncate">
                ✓ {p.title}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
