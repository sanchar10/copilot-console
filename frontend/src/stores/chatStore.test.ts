import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from './chatStore';
import type { Message } from '../types/message';

const initialState = useChatStore.getState();

function resetStore() {
  useChatStore.setState(initialState, true);
}

function makeMsg(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    role: 'user',
    content: 'hello',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('chatStore', () => {
  beforeEach(resetStore);

  // --- addMessage ---
  describe('addMessage', () => {
    it('adds a message to an empty session', () => {
      const { addMessage } = useChatStore.getState();
      addMessage('s1', makeMsg());
      expect(useChatStore.getState().messagesPerSession['s1']).toHaveLength(1);
    });

    it('appends to existing messages for the same session', () => {
      const { addMessage } = useChatStore.getState();
      addMessage('s1', makeMsg({ id: 'a' }));
      addMessage('s1', makeMsg({ id: 'b' }));
      const msgs = useChatStore.getState().messagesPerSession['s1'];
      expect(msgs).toHaveLength(2);
      expect(msgs[1].id).toBe('b');
    });

    it('keeps sessions isolated', () => {
      const { addMessage } = useChatStore.getState();
      addMessage('s1', makeMsg({ id: 'a' }));
      addMessage('s2', makeMsg({ id: 'b' }));
      expect(useChatStore.getState().messagesPerSession['s1']).toHaveLength(1);
      expect(useChatStore.getState().messagesPerSession['s2']).toHaveLength(1);
    });
  });

  // --- setStreaming / clearStreaming ---
  describe('setStreaming', () => {
    it('initializes streaming state when set to true', () => {
      useChatStore.getState().setStreaming('s1', true);
      const streaming = useChatStore.getState().streamingPerSession['s1'];
      expect(streaming).toEqual({ content: '', steps: [], isStreaming: true, latestIntent: null });
    });

    it('removes streaming state when set to false', () => {
      useChatStore.getState().setStreaming('s1', true);
      useChatStore.getState().setStreaming('s1', false);
      expect(useChatStore.getState().streamingPerSession['s1']).toBeUndefined();
    });
  });

  // --- getStreamingState ---
  describe('getStreamingState', () => {
    it('returns empty streaming state for null sessionId', () => {
      const result = useChatStore.getState().getStreamingState(null);
      expect(result).toEqual({ content: '', steps: [], isStreaming: false, latestIntent: null });
    });

    it('returns empty streaming state for unknown session', () => {
      const result = useChatStore.getState().getStreamingState('unknown');
      expect(result).toEqual({ content: '', steps: [], isStreaming: false, latestIntent: null });
    });

    it('returns active streaming state', () => {
      useChatStore.getState().setStreaming('s1', true);
      useChatStore.getState().appendStreamingContent('s1', 'hello');
      const result = useChatStore.getState().getStreamingState('s1');
      expect(result.content).toBe('hello');
      expect(result.isStreaming).toBe(true);
    });

    it('returns the same object reference for consecutive calls when inputs are unchanged (snapshot stability)', () => {
      useChatStore.getState().setStreaming('s1', true);
      useChatStore.getState().appendStreamingContent('s1', 'hello');
      const a = useChatStore.getState().getStreamingState('s1');
      const b = useChatStore.getState().getStreamingState('s1');
      expect(a).toBe(b);
    });

    it('returns a new object reference after appendStreamingContent', () => {
      useChatStore.getState().setStreaming('s1', true);
      useChatStore.getState().appendStreamingContent('s1', 'a');
      const a = useChatStore.getState().getStreamingState('s1');
      useChatStore.getState().appendStreamingContent('s1', 'b');
      const b = useChatStore.getState().getStreamingState('s1');
      expect(a).not.toBe(b);
      expect(b.content).toBe('ab');
    });

    it('returns stable reference for empty buffer (no merge needed)', () => {
      useChatStore.getState().setStreaming('s1', true);
      const a = useChatStore.getState().getStreamingState('s1');
      const b = useChatStore.getState().getStreamingState('s1');
      expect(a).toBe(b);
    });
  });

  // --- appendStreamingContent ---
  describe('appendStreamingContent', () => {
    it('appends content cumulatively', () => {
      useChatStore.getState().setStreaming('s1', true);
      useChatStore.getState().appendStreamingContent('s1', 'a');
      useChatStore.getState().appendStreamingContent('s1', 'b');
      expect(useChatStore.getState().getStreamingState('s1').content).toBe('ab');
    });
  });

  // --- addStreamingStep ---
  describe('addStreamingStep', () => {
    it('adds steps to streaming state', () => {
      useChatStore.getState().setStreaming('s1', true);
      useChatStore.getState().addStreamingStep('s1', { title: 'step1' });
      useChatStore.getState().addStreamingStep('s1', { title: 'step2', detail: 'info' });
      const steps = useChatStore.getState().streamingPerSession['s1'].steps;
      expect(steps).toHaveLength(2);
      expect(steps[1]).toEqual({ title: 'step2', detail: 'info' });
    });
  });

  // --- finalizeStreaming ---
  describe('finalizeStreaming', () => {
    it('converts streaming content into a message and clears streaming', () => {
      useChatStore.getState().setStreaming('s1', true);
      useChatStore.getState().appendStreamingContent('s1', 'response');
      useChatStore.getState().addStreamingStep('s1', { title: 'done' });
      useChatStore.getState().finalizeStreaming('s1', 'final-msg');

      const msgs = useChatStore.getState().messagesPerSession['s1'];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].id).toBe('final-msg');
      expect(msgs[0].role).toBe('assistant');
      expect(msgs[0].content).toBe('response');
      expect(msgs[0].steps).toEqual([{ title: 'done' }]);
      expect(useChatStore.getState().streamingPerSession['s1']).toBeUndefined();
    });
  });

  // --- setSending ---
  describe('setSending', () => {
    it('tracks sendingSessionId', () => {
      useChatStore.getState().setSending('session-1');
      expect(useChatStore.getState().sendingSessionId).toBe('session-1');
      useChatStore.getState().setSending(null);
      expect(useChatStore.getState().sendingSessionId).toBeNull();
    });
  });

  // --- clearSessionMessages ---
  describe('clearSessionMessages', () => {
    it('removes messages, streaming, and token usage for a session', () => {
      const s = useChatStore.getState();
      s.addMessage('s1', makeMsg());
      s.setStreaming('s1', true);
      s.setTokenUsage('s1', { tokenLimit: 100, currentTokens: 50, messagesLength: 1 });
      useChatStore.getState().clearSessionMessages('s1');

      const state = useChatStore.getState();
      expect(state.messagesPerSession['s1']).toBeUndefined();
      expect(state.streamingPerSession['s1']).toBeUndefined();
      expect(state.tokenUsagePerSession['s1']).toBeUndefined();
    });
  });

  // --- clearAllMessages ---
  describe('clearAllMessages', () => {
    it('resets all per-session data', () => {
      useChatStore.getState().addMessage('s1', makeMsg());
      useChatStore.getState().addMessage('s2', makeMsg());
      useChatStore.getState().clearAllMessages();

      const state = useChatStore.getState();
      expect(state.messagesPerSession).toEqual({});
      expect(state.streamingPerSession).toEqual({});
      expect(state.tokenUsagePerSession).toEqual({});
    });
  });

  // --- tokenUsage ---
  describe('tokenUsage', () => {
    it('set and get token usage', () => {
      const usage = { tokenLimit: 128000, currentTokens: 5000, messagesLength: 10 };
      useChatStore.getState().setTokenUsage('s1', usage);
      expect(useChatStore.getState().getTokenUsage('s1')).toEqual(usage);
    });

    it('returns null for unknown session', () => {
      expect(useChatStore.getState().getTokenUsage('nope')).toBeNull();
    });

    it('returns null for null sessionId', () => {
      expect(useChatStore.getState().getTokenUsage(null)).toBeNull();
    });

    it('clearTokenUsage removes entry', () => {
      useChatStore.getState().setTokenUsage('s1', { tokenLimit: 1, currentTokens: 0, messagesLength: 0 });
      useChatStore.getState().clearTokenUsage('s1');
      expect(useChatStore.getState().getTokenUsage('s1')).toBeNull();
    });
  });
});
