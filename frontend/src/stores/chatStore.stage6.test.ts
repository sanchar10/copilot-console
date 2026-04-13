/**
 * Stage 6 P1 tests — State Cleanup + SSE Delta Batching
 *
 * These tests validate two P1 changes from Stage 6:
 *
 * Item 1 — State Cleanup:
 *   readySessions and sessionModes move from module-level variables in
 *   InputBox.tsx into the chatStore. A new clearSessionState(sessionId)
 *   method removes a session from both collections.
 *
 * Item 2 — SSE Delta Batching:
 *   appendStreamingContent buffers rapid deltas and flushes them in a
 *   single setState call via setTimeout (~50ms). flushStreamingBuffer
 *   forces an immediate flush. The 'done' path (finalizeStreaming /
 *   finalizeTurn) flushes immediately without waiting for the timer.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useChatStore } from './chatStore';

const initialState = useChatStore.getState();

function resetStore() {
  useChatStore.setState(initialState, true);
}

// ────────────────────────────────────────────────────────────
// Item 1 — State Cleanup
// ────────────────────────────────────────────────────────────
describe('chatStore — State Cleanup (Stage 6 P1)', () => {
  beforeEach(resetStore);

  describe('readySessions and sessionModes in store', () => {
    it('readySessions is initialized as an empty set/collection in the store', () => {
      const state = useChatStore.getState();
      // readySessions should exist on the store (Set, Map, or record)
      expect(state).toHaveProperty('readySessions');
      // Should be empty at init
      const rs = state.readySessions;
      if (rs instanceof Set) {
        expect(rs.size).toBe(0);
      } else if (rs instanceof Map) {
        expect(rs.size).toBe(0);
      } else {
        // plain object
        expect(Object.keys(rs as Record<string, unknown>)).toHaveLength(0);
      }
    });

    it('sessionModes is initialized as an empty map/collection in the store', () => {
      const state = useChatStore.getState();
      expect(state).toHaveProperty('sessionModes');
      const sm = state.sessionModes;
      if (sm instanceof Map) {
        expect(sm.size).toBe(0);
      } else {
        expect(Object.keys(sm as Record<string, unknown>)).toHaveLength(0);
      }
    });
  });

  describe('clearSessionState', () => {
    it('is a function on the store', () => {
      expect(typeof useChatStore.getState().clearSessionState).toBe('function');
    });

    it('removes the session from readySessions and sessionModes', () => {
      const state = useChatStore.getState();

      // Populate readySessions & sessionModes via whatever setter Fenster exposes
      // We'll use setState to seed them since the setters may vary.
      const rs = state.readySessions;
      const sm = state.sessionModes;

      if (rs instanceof Set) {
        rs.add('s1');
      } else {
        (rs as Record<string, boolean>)['s1'] = true;
      }

      if (sm instanceof Map) {
        sm.set('s1', 'agent');
      } else {
        (sm as Record<string, string>)['s1'] = 'agent';
      }

      // Force store to recognise the mutation (Zustand immutability)
      useChatStore.setState({ readySessions: rs, sessionModes: sm } as Partial<ReturnType<typeof useChatStore.getState>>);

      // Act
      useChatStore.getState().clearSessionState('s1');

      // Assert — s1 is gone
      const after = useChatStore.getState();
      if (after.readySessions instanceof Set) {
        expect(after.readySessions.has('s1')).toBe(false);
      } else {
        expect((after.readySessions as Record<string, unknown>)['s1']).toBeUndefined();
      }

      if (after.sessionModes instanceof Map) {
        expect(after.sessionModes.has('s1')).toBe(false);
      } else {
        expect((after.sessionModes as Record<string, unknown>)['s1']).toBeUndefined();
      }
    });

    it('clearing one session does not affect other sessions', () => {
      // Seed two sessions using the store's own methods
      const s = useChatStore.getState();
      s.markSessionReady('s1');
      s.markSessionReady('s2');
      s.setSessionMode('s1', 'agent');
      s.setSessionMode('s2', 'interactive');

      useChatStore.getState().clearSessionState('s1');

      const after = useChatStore.getState();
      // s2 must survive
      if (after.readySessions instanceof Set) {
        expect(after.readySessions.has('s2')).toBe(true);
      } else {
        expect((after.readySessions as Record<string, unknown>)['s2']).toBeDefined();
      }

      if (after.sessionModes instanceof Map) {
        expect(after.sessionModes.get('s2')).toBe('interactive');
      } else {
        expect((after.sessionModes as Record<string, string>)['s2']).toBe('interactive');
      }
    });
  });
});

// ────────────────────────────────────────────────────────────
// Item 2 — SSE Delta Batching
// ────────────────────────────────────────────────────────────
describe('chatStore — SSE Delta Batching (Stage 6 P1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('multiple rapid deltas are batched into a single state update', () => {
    const store = useChatStore.getState();
    store.setStreaming('s1', true);

    // Track how many times setState is called
    const setStateSpy = vi.spyOn(useChatStore, 'setState');
    const callsBefore = setStateSpy.mock.calls.length;

    // Rapid-fire 10 deltas
    for (let i = 0; i < 10; i++) {
      useChatStore.getState().appendStreamingContent('s1', `chunk${i}`);
    }

    // Before timer fires, content may not be visible yet (buffered)
    // After timer fires, all content should be applied in ≤ 2 setState calls
    // (the batching implementation might do 1 or 2)
    vi.advanceTimersByTime(100);

    const content = useChatStore.getState().getStreamingState('s1').content;
    expect(content).toBe('chunk0chunk1chunk2chunk3chunk4chunk5chunk6chunk7chunk8chunk9');

    // The key invariant: fewer setState calls than deltas
    const callsAfter = setStateSpy.mock.calls.length;
    const stateUpdates = callsAfter - callsBefore;
    expect(stateUpdates).toBeLessThan(10);

    setStateSpy.mockRestore();
  });

  it('flushStreamingBuffer immediately applies buffered content', () => {
    const store = useChatStore.getState();
    store.setStreaming('s1', true);

    // Buffer some content
    useChatStore.getState().appendStreamingContent('s1', 'hello');
    useChatStore.getState().appendStreamingContent('s1', ' world');

    // Flush without waiting for timer
    useChatStore.getState().flushStreamingBuffer('s1');

    // Content should be visible immediately
    const content = useChatStore.getState().getStreamingState('s1').content;
    expect(content).toBe('hello world');
  });

  it('done path (finalizeStreaming) flushes immediately without 50ms delay', () => {
    const store = useChatStore.getState();
    store.setStreaming('s1', true);

    // Buffer content
    useChatStore.getState().appendStreamingContent('s1', 'final answer');

    // Finalize without advancing timers — should flush internally
    useChatStore.getState().finalizeStreaming('s1', 'msg-1');

    // The message should contain the buffered content
    const msgs = useChatStore.getState().messagesPerSession['s1'];
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('final answer');
    expect(msgs[0].id).toBe('msg-1');
  });

  it('done path (finalizeTurn) flushes immediately without 50ms delay', () => {
    const store = useChatStore.getState();
    store.setStreaming('s1', true);

    // Buffer content
    useChatStore.getState().appendStreamingContent('s1', 'turn answer');

    // finalizeTurn should also flush
    useChatStore.getState().finalizeTurn('s1', 'turn-1');

    const msgs = useChatStore.getState().messagesPerSession['s1'];
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('turn answer');
  });

  it('buffer cleanup happens on clearSessionState (no dangling timers)', () => {
    const store = useChatStore.getState();
    store.setStreaming('s1', true);

    // Buffer content that hasn't flushed
    useChatStore.getState().appendStreamingContent('s1', 'pending');

    // Clear the session — should cancel any pending timer
    useChatStore.getState().clearSessionState('s1');

    // Advance timers — the buffered content should NOT flush
    vi.advanceTimersByTime(200);

    // Streaming state exists (setStreaming created it) but content should be empty
    // because the buffer was cleared before the timer could flush
    const streaming = useChatStore.getState().streamingPerSession['s1'];
    expect(streaming?.content ?? '').toBe('');
  });

  it('buffer cleanup happens on clearSessionMessages (no dangling timers)', () => {
    const store = useChatStore.getState();
    store.setStreaming('s1', true);

    useChatStore.getState().appendStreamingContent('s1', 'pending');

    // clearSessionMessages should also clean up buffers
    useChatStore.getState().clearSessionMessages('s1');

    vi.advanceTimersByTime(200);

    const streaming = useChatStore.getState().streamingPerSession['s1'];
    expect(streaming).toBeUndefined();
  });

  it('final content is identical whether batched or unbatched (correctness)', () => {
    // Simulate unbatched: apply all at once
    const chunks = ['The ', 'quick ', 'brown ', 'fox ', 'jumps.'];
    const expectedContent = chunks.join('');

    const store = useChatStore.getState();
    store.setStreaming('s1', true);

    // Feed chunks rapidly (batched path)
    for (const chunk of chunks) {
      useChatStore.getState().appendStreamingContent('s1', chunk);
    }

    // Flush
    if (typeof useChatStore.getState().flushStreamingBuffer === 'function') {
      useChatStore.getState().flushStreamingBuffer('s1');
    } else {
      vi.advanceTimersByTime(100);
    }

    const content = useChatStore.getState().getStreamingState('s1').content;
    expect(content).toBe(expectedContent);
  });
});
