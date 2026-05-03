import { create } from 'zustand';
import type { Message, ChatStep } from '../types/message';
import type { ElicitationRequest, AskUserRequest } from '../api/sessions';

export type { ChatStep };

export interface TokenUsage {
  tokenLimit: number;
  currentTokens: number;
  messagesLength: number;
}

interface StreamingState {
  content: string;
  steps: ChatStep[];
  isStreaming: boolean;
  latestIntent: string | null;
}

export interface ResolvedElicitation {
  requestId: string;
  message: string;
  schema?: Record<string, unknown>;
  action: 'accept' | 'decline' | 'cancel';
  values?: Record<string, unknown>;
}

/** Batch window for SSE delta updates (ms). */
export const DELTA_BATCH_MS = 50;

// --- SSE delta buffer (module-level, NOT in Zustand state) ---
const deltaBuffers: Record<string, string[]> = {};
const flushTimers: Record<string, ReturnType<typeof setTimeout>> = {};

interface ChatState {
  // Messages stored per session
  messagesPerSession: Record<string, Message[]>;

  // Streaming state per session - key is session ID
  streamingPerSession: Record<string, StreamingState>;
  tokenUsagePerSession: Record<string, TokenUsage | null>;
  sendingSessionId: string | null;

  // Elicitation state per session
  pendingElicitation: Record<string, ElicitationRequest | null>;
  resolvedElicitations: Record<string, ResolvedElicitation[]>;

  // Ask user state per session
  pendingAskUser: Record<string, AskUserRequest | null>;

  // Session readiness & mode tracking (moved from module-level singletons)
  readySessions: Set<string>;
  sessionModes: Record<string, string>;
  pendingCompact: Record<string, boolean>;
  pendingAgent: Record<string, string>;

  // Per-session load errors (e.g. SDK couldn't resume due to CLI schema mismatch).
  // When non-null, UI should show a banner instead of treating as empty.
  loadErrors: Record<string, string | null>;

  // Getters
  getStreamingState: (sessionId: string | null) => StreamingState;
  getTokenUsage: (sessionId: string | null) => TokenUsage | null;
  isSessionReady: (sessionId: string) => boolean;
  getSessionMode: (sessionId: string) => string | undefined;
  hasPendingCompact: (sessionId: string) => boolean;
  getPendingAgent: (sessionId: string) => string | undefined;

  // Setters
  setMessages: (sessionId: string, messages: Message[]) => void;
  addMessage: (sessionId: string, message: Message) => void;
  appendStreamingContent: (sessionId: string, content: string) => void;
  addStreamingStep: (sessionId: string, step: ChatStep) => void;
  setTokenUsage: (sessionId: string, usage: TokenUsage) => void;
  clearTokenUsage: (sessionId: string) => void;
  finalizeStreaming: (sessionId: string, messageId: string, eventId?: string, sdkTimestamp?: string) => void;
  finalizeTurn: (sessionId: string, messageId?: string, eventId?: string, sdkTimestamp?: string) => void;
  setStreaming: (sessionId: string, isStreaming: boolean) => void;
  setSending: (sessionId: string | null) => void;
  clearSessionMessages: (sessionId: string) => void;
  clearAllMessages: () => void;
  setLoadError: (sessionId: string, error: string | null) => void;

  // Session readiness & mode
  markSessionReady: (sessionId: string) => void;
  setSessionMode: (sessionId: string, mode: string) => void;
  setPendingCompact: (sessionId: string, pending: boolean) => void;
  consumePendingCompact: (sessionId: string) => boolean;
  setPendingAgent: (sessionId: string, agent: string) => void;
  consumePendingAgent: (sessionId: string) => string | undefined;
  clearSessionState: (sessionId: string) => void;

  // SSE delta batching
  flushStreamingBuffer: (sessionId: string) => void;

  // Elicitation
  setElicitation: (sessionId: string, data: ElicitationRequest) => void;
  clearElicitation: (sessionId: string) => void;
  resolveElicitation: (sessionId: string, action: 'accept' | 'decline' | 'cancel', values?: Record<string, unknown>) => void;

  // Ask user
  setAskUser: (sessionId: string, data: AskUserRequest) => void;
  clearAskUser: (sessionId: string) => void;
}

const emptyStreamingState: StreamingState = { content: '', steps: [], isStreaming: false, latestIntent: null };

/**
 * Flush buffered SSE deltas for a session into a single Zustand setState call.
 * Called automatically after DELTA_BATCH_MS, or immediately on 'done' / cleanup.
 */
export function flushStreamingBuffer(sessionId: string): void {
  const timer = flushTimers[sessionId];
  if (timer) {
    clearTimeout(timer);
    delete flushTimers[sessionId];
  }
  const buf = deltaBuffers[sessionId];
  if (!buf || buf.length === 0) return;
  const flushed = buf.join('');
  deltaBuffers[sessionId] = [];
  useChatStore.setState((state) => {
    const current = state.streamingPerSession[sessionId] || emptyStreamingState;
    return {
      streamingPerSession: {
        ...state.streamingPerSession,
        [sessionId]: { ...current, content: current.content + flushed },
      },
    };
  });
}

/** Clear any pending delta buffer and timer for a session (cleanup). */
function clearDeltaBuffer(sessionId: string): void {
  if (flushTimers[sessionId]) {
    clearTimeout(flushTimers[sessionId]);
    delete flushTimers[sessionId];
  }
  delete deltaBuffers[sessionId];
  delete mergedStreamingCache[sessionId];
}

/**
 * Per-session memoization for getStreamingState's merged result.
 *
 * When the delta buffer has unflushed content, getStreamingState must combine
 * `stored.content` with the buffer. Without caching, every invocation returns a
 * new object literal. Zustand selectors backed by useSyncExternalStore call
 * getSnapshot multiple times per render — an unstable snapshot triggers React's
 * "Maximum update depth exceeded" guard.
 *
 * The cache key is (stored ref, buf length, total chars). Any state change
 * invalidates: flushStreamingBuffer rotates `stored` (new ref), and pushes to
 * the buf grow length/chars. Same inputs → same returned object reference.
 */
const mergedStreamingCache: Record<
  string,
  { stored: StreamingState; bufLen: number; bufChars: number; result: StreamingState }
> = {};

function getMergedStreamingState(
  sessionId: string,
  stored: StreamingState,
  buf: string[]
): StreamingState {
  let bufChars = 0;
  for (let i = 0; i < buf.length; i++) bufChars += buf[i].length;
  const cached = mergedStreamingCache[sessionId];
  if (
    cached &&
    cached.stored === stored &&
    cached.bufLen === buf.length &&
    cached.bufChars === bufChars
  ) {
    return cached.result;
  }
  const result = { ...stored, content: stored.content + buf.join('') };
  mergedStreamingCache[sessionId] = { stored, bufLen: buf.length, bufChars, result };
  return result;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messagesPerSession: {},
  streamingPerSession: {},
  tokenUsagePerSession: {},
  sendingSessionId: null,
  pendingElicitation: {},
  resolvedElicitations: {},
  pendingAskUser: {},
  readySessions: new Set<string>(),
  sessionModes: {},
  pendingCompact: {},
  pendingAgent: {},
  loadErrors: {},

  getStreamingState: (sessionId) => {
    if (!sessionId) return emptyStreamingState;
    const stored = get().streamingPerSession[sessionId] || emptyStreamingState;
    const buf = deltaBuffers[sessionId];
    if (!buf || buf.length === 0) return stored;
    // Memoize merged result so consecutive calls with identical inputs return
    // the same object reference (required for useSyncExternalStore stability).
    return getMergedStreamingState(sessionId, stored, buf);
  },

  getTokenUsage: (sessionId) => {
    if (!sessionId) return null;
    return get().tokenUsagePerSession[sessionId] || null;
  },

  isSessionReady: (sessionId) => get().readySessions.has(sessionId),

  getSessionMode: (sessionId) => get().sessionModes[sessionId],
  hasPendingCompact: (sessionId) => !!get().pendingCompact[sessionId],
  getPendingAgent: (sessionId) => get().pendingAgent[sessionId],

  setMessages: (sessionId, messages) =>
    set((state) => ({
      messagesPerSession: {
        ...state.messagesPerSession,
        [sessionId]: messages,
      },
    })),

  addMessage: (sessionId, message) =>
    set((state) => ({
      messagesPerSession: {
        ...state.messagesPerSession,
        [sessionId]: [...(state.messagesPerSession[sessionId] || []), message],
      },
    })),

  appendStreamingContent: (sessionId, content) => {
    // Buffer deltas and flush on a timer for batching
    if (!deltaBuffers[sessionId]) deltaBuffers[sessionId] = [];
    deltaBuffers[sessionId].push(content);
    if (!flushTimers[sessionId]) {
      flushTimers[sessionId] = setTimeout(() => flushStreamingBuffer(sessionId), DELTA_BATCH_MS);
    }
  },

  addStreamingStep: (sessionId, step) =>
    set((state) => {
      const current = state.streamingPerSession[sessionId] || emptyStreamingState;
      // Extract intent from report_intent tool calls
      let latestIntent = current.latestIntent;
      if (step.title === 'Tool: report_intent' && step.detail) {
        const match = step.detail.match(/"intent":\s*"([^"]+)"/);
        if (match) latestIntent = match[1];
      }
      return {
        streamingPerSession: {
          ...state.streamingPerSession,
          [sessionId]: { ...current, steps: [...current.steps, step], latestIntent },
        },
      };
    }),

  setTokenUsage: (sessionId, usage) =>
    set((state) => ({
      tokenUsagePerSession: {
        ...state.tokenUsagePerSession,
        [sessionId]: usage,
      },
    })),

  clearTokenUsage: (sessionId) =>
    set((state) => {
      const newTokenUsage = { ...state.tokenUsagePerSession };
      delete newTokenUsage[sessionId];
      return { tokenUsagePerSession: newTokenUsage };
    }),

  finalizeStreaming: (sessionId, messageId, eventId, sdkTimestamp) => {
    flushStreamingBuffer(sessionId);
    set((state) => {
      const streaming = state.streamingPerSession[sessionId] || emptyStreamingState;
      const newStreamingPerSession = { ...state.streamingPerSession };
      delete newStreamingPerSession[sessionId];

      const resolvedId = messageId || `turn-${Date.now()}`;

      return {
        messagesPerSession: {
          ...state.messagesPerSession,
          [sessionId]: [
            ...(state.messagesPerSession[sessionId] || []),
            {
              id: resolvedId,
              sdk_message_id: messageId || undefined,
              event_id: eventId || undefined,
              role: 'assistant' as const,
              content: streaming.content,
              steps: streaming.steps,
              timestamp: sdkTimestamp || new Date().toISOString(),
            },
          ],
        },
        streamingPerSession: newStreamingPerSession,
      };
    });
  },

  finalizeTurn: (sessionId, messageId, eventId, sdkTimestamp) => {
    flushStreamingBuffer(sessionId);
    set((state) => {
      const streaming = state.streamingPerSession[sessionId] || emptyStreamingState;
      if (!streaming.content.trim()) return state;

      const messages = [...(state.messagesPerSession[sessionId] || [])];
      const resolvedId = messageId || `turn-${Date.now()}`;
      const assistantMsg = {
        id: resolvedId,
        sdk_message_id: messageId || undefined,
        event_id: eventId || undefined,
        role: 'assistant' as const,
        content: streaming.content,
        steps: streaming.steps,
        timestamp: sdkTimestamp || new Date().toISOString(),
      };

      // Insert assistant response BEFORE the first queued user message
      // so the chat shows the correct interleaved order.
      const queuedIdx = messages.findIndex((m) => m.mode === 'enqueue');
      if (queuedIdx >= 0) {
        messages.splice(queuedIdx, 0, assistantMsg);
        // The queued message right after is now being processed — clear its flag
        const nextMsg = messages[queuedIdx + 1];
        if (nextMsg?.mode === 'enqueue') {
          messages[queuedIdx + 1] = { ...nextMsg, mode: undefined };
        }
      } else {
        messages.push(assistantMsg);
      }

      return {
        messagesPerSession: {
          ...state.messagesPerSession,
          [sessionId]: messages,
        },
        streamingPerSession: {
          ...state.streamingPerSession,
          [sessionId]: { content: '', steps: [], isStreaming: true, latestIntent: null },
        },
      };
    });
  },

  setStreaming: (sessionId, isStreaming) =>
    set((state) => {
      if (isStreaming) {
        clearDeltaBuffer(sessionId);
        return {
          streamingPerSession: {
            ...state.streamingPerSession,
            [sessionId]: { content: '', steps: [], isStreaming: true, latestIntent: null },
          },
        };
      } else {
        clearDeltaBuffer(sessionId);
        const newStreamingPerSession = { ...state.streamingPerSession };
        delete newStreamingPerSession[sessionId];
        return { streamingPerSession: newStreamingPerSession };
      }
    }),

  setSending: (sessionId) => set({ sendingSessionId: sessionId }),

  clearSessionMessages: (sessionId) => {
    clearDeltaBuffer(sessionId);
    set((state) => {
      const newMessages = { ...state.messagesPerSession };
      delete newMessages[sessionId];
      const newStreaming = { ...state.streamingPerSession };
      delete newStreaming[sessionId];
      const newTokenUsage = { ...state.tokenUsagePerSession };
      delete newTokenUsage[sessionId];
      const newPendingElicitation = { ...state.pendingElicitation };
      delete newPendingElicitation[sessionId];
      const newResolvedElicitations = { ...state.resolvedElicitations };
      delete newResolvedElicitations[sessionId];
      const newPendingAskUser = { ...state.pendingAskUser };
      delete newPendingAskUser[sessionId];
      const newReadySessions = new Set(state.readySessions);
      newReadySessions.delete(sessionId);
      const newSessionModes = { ...state.sessionModes };
      delete newSessionModes[sessionId];
      return {
        messagesPerSession: newMessages,
        streamingPerSession: newStreaming,
        tokenUsagePerSession: newTokenUsage,
        pendingElicitation: newPendingElicitation,
        resolvedElicitations: newResolvedElicitations,
        pendingAskUser: newPendingAskUser,
        readySessions: newReadySessions,
        sessionModes: newSessionModes,
      };
    });
  },

  clearAllMessages: () => set({ messagesPerSession: {}, streamingPerSession: {}, tokenUsagePerSession: {} }),

  setLoadError: (sessionId, error) =>
    set((state) => ({
      loadErrors: { ...state.loadErrors, [sessionId]: error },
    })),

  markSessionReady: (sessionId) =>
    set((state) => {
      const updated = new Set(state.readySessions);
      updated.add(sessionId);
      return { readySessions: updated };
    }),

  setSessionMode: (sessionId, mode) =>
    set((state) => ({
      sessionModes: { ...state.sessionModes, [sessionId]: mode },
    })),

  setPendingCompact: (sessionId, pending) =>
    set((state) => ({
      pendingCompact: { ...state.pendingCompact, [sessionId]: pending },
    })),

  consumePendingCompact: (sessionId) => {
    const had = !!get().pendingCompact[sessionId];
    if (had) {
      set((state) => {
        const updated = { ...state.pendingCompact };
        delete updated[sessionId];
        return { pendingCompact: updated };
      });
    }
    return had;
  },

  setPendingAgent: (sessionId, agent) =>
    set((state) => ({
      pendingAgent: { ...state.pendingAgent, [sessionId]: agent },
    })),

  consumePendingAgent: (sessionId) => {
    const agent = get().pendingAgent[sessionId];
    if (agent) {
      set((state) => {
        const updated = { ...state.pendingAgent };
        delete updated[sessionId];
        return { pendingAgent: updated };
      });
    }
    return agent;
  },

  clearSessionState: (sessionId) => {
    clearDeltaBuffer(sessionId);
    set((state) => {
      const newReadySessions = new Set(state.readySessions);
      newReadySessions.delete(sessionId);
      const newSessionModes = { ...state.sessionModes };
      delete newSessionModes[sessionId];
      const newPendingCompact = { ...state.pendingCompact };
      delete newPendingCompact[sessionId];
      const newPendingAgent = { ...state.pendingAgent };
      delete newPendingAgent[sessionId];
      return { readySessions: newReadySessions, sessionModes: newSessionModes, pendingCompact: newPendingCompact, pendingAgent: newPendingAgent };
    });
  },

  flushStreamingBuffer: (sessionId) => {
    flushStreamingBuffer(sessionId);
  },

  setElicitation: (sessionId, data) =>
    set((state) => ({
      pendingElicitation: { ...state.pendingElicitation, [sessionId]: data },
    })),

  clearElicitation: (sessionId) =>
    set((state) => {
      const updated = { ...state.pendingElicitation };
      delete updated[sessionId];
      return { pendingElicitation: updated };
    }),

  resolveElicitation: (sessionId, action, values) =>
    set((state) => {
      const pending = state.pendingElicitation[sessionId];
      const resolved: ResolvedElicitation = {
        requestId: pending?.request_id || '',
        message: pending?.message || '',
        schema: pending?.schema,
        action,
        values,
      };
      const updatedPending = { ...state.pendingElicitation };
      delete updatedPending[sessionId];
      return {
        pendingElicitation: updatedPending,
        resolvedElicitations: {
          ...state.resolvedElicitations,
          [sessionId]: [...(state.resolvedElicitations[sessionId] || []), resolved],
        },
      };
    }),

  setAskUser: (sessionId, data) =>
    set((state) => ({
      pendingAskUser: { ...state.pendingAskUser, [sessionId]: data },
    })),

  clearAskUser: (sessionId) =>
    set((state) => {
      const updated = { ...state.pendingAskUser };
      delete updated[sessionId];
      return { pendingAskUser: updated };
    }),
}));
