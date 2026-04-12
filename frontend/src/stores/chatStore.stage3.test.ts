/**
 * Stage 3 characterization tests for chatStore — elicitation, finalizeTurn,
 * latestIntent extraction, and setMessages.
 *
 * Complements the existing chatStore.test.ts with gaps identified during
 * the pre-restructuring audit. These pin behavior that must survive Fenster's
 * decomposition of ChatPane and InputBox.
 */
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

describe('chatStore — Stage 3 characterization', () => {
  beforeEach(resetStore);

  // --- setMessages ---
  describe('setMessages', () => {
    it('replaces all messages for a session', () => {
      const { addMessage, setMessages } = useChatStore.getState();
      addMessage('s1', makeMsg({ id: 'old' }));
      setMessages('s1', [makeMsg({ id: 'new-a' }), makeMsg({ id: 'new-b' })]);
      const msgs = useChatStore.getState().messagesPerSession['s1'];
      expect(msgs).toHaveLength(2);
      expect(msgs[0].id).toBe('new-a');
    });

    it('does not affect other sessions', () => {
      const { addMessage, setMessages } = useChatStore.getState();
      addMessage('s2', makeMsg({ id: 'keep-me' }));
      setMessages('s1', [makeMsg({ id: 'x' })]);
      expect(useChatStore.getState().messagesPerSession['s2'][0].id).toBe('keep-me');
    });
  });

  // --- finalizeTurn ---
  describe('finalizeTurn', () => {
    it('converts streaming content to message and resets streaming buffer', () => {
      const s = useChatStore.getState();
      s.setStreaming('s1', true);
      s.appendStreamingContent('s1', 'turn output');
      s.addStreamingStep('s1', { title: 'step1' });
      useChatStore.getState().finalizeTurn('s1', 'turn-msg-1');

      const msgs = useChatStore.getState().messagesPerSession['s1'];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].content).toBe('turn output');
      expect(msgs[0].role).toBe('assistant');
      expect(msgs[0].steps).toEqual([{ title: 'step1' }]);

      // Streaming buffer should be reset but still active
      const stream = useChatStore.getState().streamingPerSession['s1'];
      expect(stream.content).toBe('');
      expect(stream.steps).toEqual([]);
      expect(stream.isStreaming).toBe(true);
    });

    it('does nothing when streaming content is empty/whitespace', () => {
      useChatStore.getState().setStreaming('s1', true);
      useChatStore.getState().appendStreamingContent('s1', '   ');
      useChatStore.getState().finalizeTurn('s1');

      expect(useChatStore.getState().messagesPerSession['s1']).toBeUndefined();
    });

    it('inserts assistant message before queued user messages', () => {
      const s = useChatStore.getState();
      s.addMessage('s1', makeMsg({ id: 'user-1', role: 'user' }));
      s.addMessage('s1', makeMsg({ id: 'queued-1', role: 'user', mode: 'enqueue' }));
      s.setStreaming('s1', true);
      s.appendStreamingContent('s1', 'response');
      useChatStore.getState().finalizeTurn('s1', 'asst-1');

      const msgs = useChatStore.getState().messagesPerSession['s1'];
      // Order should be: user-1, asst-1, queued-1 (with mode cleared)
      expect(msgs[0].id).toBe('user-1');
      expect(msgs[1].id).toBe('asst-1');
      expect(msgs[1].role).toBe('assistant');
      expect(msgs[2].id).toBe('queued-1');
      expect(msgs[2].mode).toBeUndefined();
    });
  });

  // --- latestIntent extraction ---
  describe('latestIntent via addStreamingStep', () => {
    it('extracts intent from report_intent tool call', () => {
      useChatStore.getState().setStreaming('s1', true);
      useChatStore.getState().addStreamingStep('s1', {
        title: 'Tool: report_intent',
        detail: '{"intent": "Exploring codebase"}',
      });
      expect(useChatStore.getState().streamingPerSession['s1'].latestIntent).toBe('Exploring codebase');
    });

    it('does not extract intent from non-report_intent steps', () => {
      useChatStore.getState().setStreaming('s1', true);
      useChatStore.getState().addStreamingStep('s1', {
        title: 'Tool: grep',
        detail: '{"intent": "should not match"}',
      });
      expect(useChatStore.getState().streamingPerSession['s1'].latestIntent).toBeNull();
    });

    it('updates latestIntent on subsequent report_intent calls', () => {
      useChatStore.getState().setStreaming('s1', true);
      useChatStore.getState().addStreamingStep('s1', {
        title: 'Tool: report_intent',
        detail: '{"intent": "First"}',
      });
      useChatStore.getState().addStreamingStep('s1', {
        title: 'Tool: report_intent',
        detail: '{"intent": "Second"}',
      });
      expect(useChatStore.getState().streamingPerSession['s1'].latestIntent).toBe('Second');
    });
  });

  // --- elicitation ---
  describe('elicitation lifecycle', () => {
    it('sets and clears pending elicitation', () => {
      const data = { request_id: 'r1', message: 'Approve?', schema: {}, source: 'tool' };
      useChatStore.getState().setElicitation('s1', data);
      expect(useChatStore.getState().pendingElicitation['s1']).toEqual(data);

      useChatStore.getState().clearElicitation('s1');
      expect(useChatStore.getState().pendingElicitation['s1']).toBeUndefined();
    });

    it('resolveElicitation moves pending to resolved', () => {
      const data = { request_id: 'r1', message: 'Approve?', schema: { foo: 'bar' }, source: 'tool' };
      useChatStore.getState().setElicitation('s1', data);
      useChatStore.getState().resolveElicitation('s1', 'accept', { result: true });

      expect(useChatStore.getState().pendingElicitation['s1']).toBeUndefined();
      const resolved = useChatStore.getState().resolvedElicitations['s1'];
      expect(resolved).toHaveLength(1);
      expect(resolved[0]).toEqual({
        requestId: 'r1',
        message: 'Approve?',
        schema: { foo: 'bar' },
        action: 'accept',
        values: { result: true },
      });
    });

    it('accumulates multiple resolutions for the same session', () => {
      const s = useChatStore.getState();
      s.setElicitation('s1', { request_id: 'r1', message: 'First?', schema: {}, source: 'a' });
      useChatStore.getState().resolveElicitation('s1', 'accept');

      useChatStore.getState().setElicitation('s1', { request_id: 'r2', message: 'Second?', schema: {}, source: 'b' });
      useChatStore.getState().resolveElicitation('s1', 'decline');

      expect(useChatStore.getState().resolvedElicitations['s1']).toHaveLength(2);
    });
  });

  // --- askUser ---
  describe('askUser lifecycle', () => {
    it('sets and clears pending ask user', () => {
      const data = { request_id: 'r1', question: 'Branch?', choices: ['main', 'dev'], allowFreeform: true };
      useChatStore.getState().setAskUser('s1', data);
      expect(useChatStore.getState().pendingAskUser['s1']).toEqual(data);

      useChatStore.getState().clearAskUser('s1');
      expect(useChatStore.getState().pendingAskUser['s1']).toBeUndefined();
    });
  });

  // --- clearSessionMessages cleans up elicitation + askUser ---
  describe('clearSessionMessages cleans up all state', () => {
    it('removes elicitation, resolved, and askUser state', () => {
      const s = useChatStore.getState();
      s.setElicitation('s1', { request_id: 'r1', message: 'x', schema: {}, source: 's' });
      s.setAskUser('s1', { request_id: 'r2', question: 'y', allowFreeform: false });
      s.addMessage('s1', makeMsg());
      useChatStore.getState().clearSessionMessages('s1');

      const state = useChatStore.getState();
      expect(state.pendingElicitation['s1']).toBeUndefined();
      expect(state.pendingAskUser['s1']).toBeUndefined();
      expect(state.messagesPerSession['s1']).toBeUndefined();
    });
  });
});
