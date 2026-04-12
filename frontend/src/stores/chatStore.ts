import { create } from 'zustand';
import type { Message } from '../types/message';
import type { ElicitationRequest, AskUserRequest } from '../api/sessions';

export interface ChatStep {
  title: string;
  detail?: string;
}

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

  // Getters
  getStreamingState: (sessionId: string | null) => StreamingState;
  getTokenUsage: (sessionId: string | null) => TokenUsage | null;

  // Setters
  setMessages: (sessionId: string, messages: Message[]) => void;
  addMessage: (sessionId: string, message: Message) => void;
  appendStreamingContent: (sessionId: string, content: string) => void;
  addStreamingStep: (sessionId: string, step: ChatStep) => void;
  setTokenUsage: (sessionId: string, usage: TokenUsage) => void;
  clearTokenUsage: (sessionId: string) => void;
  finalizeStreaming: (sessionId: string, messageId: string) => void;
  finalizeTurn: (sessionId: string, messageId?: string) => void;
  setStreaming: (sessionId: string, isStreaming: boolean) => void;
  setSending: (sessionId: string | null) => void;
  clearSessionMessages: (sessionId: string) => void;
  clearAllMessages: () => void;

  // Elicitation
  setElicitation: (sessionId: string, data: ElicitationRequest) => void;
  clearElicitation: (sessionId: string) => void;
  resolveElicitation: (sessionId: string, action: 'accept' | 'decline' | 'cancel', values?: Record<string, unknown>) => void;

  // Ask user
  setAskUser: (sessionId: string, data: AskUserRequest) => void;
  clearAskUser: (sessionId: string) => void;
}

const emptyStreamingState: StreamingState = { content: '', steps: [], isStreaming: false, latestIntent: null };

export const useChatStore = create<ChatState>((set, get) => ({
  messagesPerSession: {},
  streamingPerSession: {},
  tokenUsagePerSession: {},
  sendingSessionId: null,
  pendingElicitation: {},
  resolvedElicitations: {},
  pendingAskUser: {},

  getStreamingState: (sessionId) => {
    if (!sessionId) return emptyStreamingState;
    return get().streamingPerSession[sessionId] || emptyStreamingState;
  },

  getTokenUsage: (sessionId) => {
    if (!sessionId) return null;
    return get().tokenUsagePerSession[sessionId] || null;
  },

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

  appendStreamingContent: (sessionId, content) =>
    set((state) => {
      const current = state.streamingPerSession[sessionId] || emptyStreamingState;
      return {
        streamingPerSession: {
          ...state.streamingPerSession,
          [sessionId]: { ...current, content: current.content + content },
        },
      };
    }),

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

  finalizeStreaming: (sessionId, messageId) =>
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
              role: 'assistant' as const,
              content: streaming.content,
              steps: streaming.steps,
              timestamp: new Date().toISOString(),
            },
          ],
        },
        streamingPerSession: newStreamingPerSession,
      };
    }),

  finalizeTurn: (sessionId, messageId) =>
    set((state) => {
      const streaming = state.streamingPerSession[sessionId] || emptyStreamingState;
      if (!streaming.content.trim()) return state;

      const messages = [...(state.messagesPerSession[sessionId] || [])];
      const resolvedId = messageId || `turn-${Date.now()}`;
      const assistantMsg = {
        id: resolvedId,
        sdk_message_id: messageId || undefined,
        role: 'assistant' as const,
        content: streaming.content,
        steps: streaming.steps,
        timestamp: new Date().toISOString(),
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
    }),

  setStreaming: (sessionId, isStreaming) =>
    set((state) => {
      if (isStreaming) {
        return {
          streamingPerSession: {
            ...state.streamingPerSession,
            [sessionId]: { content: '', steps: [], isStreaming: true, latestIntent: null },
          },
        };
      } else {
        const newStreamingPerSession = { ...state.streamingPerSession };
        delete newStreamingPerSession[sessionId];
        return { streamingPerSession: newStreamingPerSession };
      }
    }),

  setSending: (sessionId) => set({ sendingSessionId: sessionId }),

  clearSessionMessages: (sessionId) =>
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
      return {
        messagesPerSession: newMessages,
        streamingPerSession: newStreaming,
        tokenUsagePerSession: newTokenUsage,
        pendingElicitation: newPendingElicitation,
        resolvedElicitations: newResolvedElicitations,
        pendingAskUser: newPendingAskUser,
      };
    }),

  clearAllMessages: () => set({ messagesPerSession: {}, streamingPerSession: {}, tokenUsagePerSession: {} }),

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
