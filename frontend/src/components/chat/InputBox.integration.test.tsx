/**
 * Integration-style test for InputBox.
 *
 * Uses the REAL chatStore (Zustand) so we can observe state transitions
 * (locked → unlocked) driven by mock SSE callbacks.
 *
 * Mock boundary: useSessionStore, useUIStore, useViewedStore, and api/sessions.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useChatStore } from '../../stores/chatStore';

// --- Mock non-chat stores ---

vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: Object.assign(
    () => ({
      isNewSession: false,
      newSessionSettings: null,
      addSession: vi.fn(),
      setCurrentSessionId: vi.fn(),
      moveSessionToTop: vi.fn(),
      updateSessionTimestamp: vi.fn(),
      updateSessionName: vi.fn(),
      openTab: vi.fn(),
    }),
    { getState: () => ({ currentSessionId: 'session-1', sessions: [] }) },
  ),
}));

vi.mock('../../stores/uiStore', () => ({
  useUIStore: () => ({
    defaultModel: 'gpt-4',
    defaultCwd: '/tmp',
  }),
}));

vi.mock('../../stores/viewedStore', () => ({
  useViewedStore: () => ({
    setAgentActive: vi.fn(),
    markViewed: vi.fn(),
  }),
}));

// --- Mock API layer with controllable sendMessage ---

// Captured callbacks from the most recent sendMessage call
let captured: {
  onDelta: (content: string) => void;
  onStep: (step: any) => void;
  onDone: (messageId: string, sessionName?: string) => void;
  onError: (error: string) => void;
  resolve: () => void;
} | null = null;

const mockSendMessage = vi.fn(
  async (_sid: string, _content: string, options: any) => {
    // Store callbacks so the test can trigger them manually.
    // The promise stays open until the test calls captured.resolve()
    // (simulates an ongoing SSE stream).
    await new Promise<void>((resolve) => {
      captured = {
        onDelta: options.onDelta,
        onStep: options.onStep,
        onDone: options.onDone,
        onError: options.onError,
        resolve,
      };
    });
  },
);

vi.mock('../../api/sessions', () => ({
  sendMessage: (...args: unknown[]) => mockSendMessage(...args as [string, string, any]),
  createSession: vi.fn(),
  connectSession: vi.fn(),
  enqueueMessage: vi.fn(),
  abortSession: vi.fn(),
}));

import { InputBox, clearReadySession, markSessionReady, isSessionReady } from './InputBox';

// ---------------------------------------------------------------------------

describe('InputBox integration — activation lock lifecycle', () => {
  beforeEach(() => {
    captured = null;
    mockSendMessage.mockClear();
    // Reset chatStore to defaults
    useChatStore.setState({
      sendingSessionId: null,
      streamingPerSession: {},
      messagesPerSession: {},
    });
    // Ensure session starts as "ready" (previously activated)
    markSessionReady('session-1');
  });

  it('locks input after clearReadySession + send, unlocks on first SSE delta', async () => {
    // 1. Mark session as no longer ready (simulates CWD change)
    clearReadySession('session-1');
    expect(isSessionReady('session-1')).toBe(false);

    // 2. Render InputBox for this session
    render(<InputBox sessionId="session-1" />);

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;

    // 3. Initially the textarea is enabled (no message sent yet)
    expect(textarea).not.toBeDisabled();
    expect(textarea.placeholder).toMatch(/Type a message/);

    // 4. Type and send a message
    fireEvent.change(textarea, { target: { value: 'Hello after CWD change' } });
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      // Let handleSubmit run through its synchronous path
      await new Promise((r) => setTimeout(r, 0));
    });

    // 5. Textarea stays enabled but placeholder changes; submit is locked
    await waitFor(() => {
      expect(textarea).not.toBeDisabled();
      expect(textarea.placeholder).toBe('Activating session, please wait...');
    });

    // 6. Simulate first SSE delta arriving (proves backend client is alive)
    expect(captured).not.toBeNull();
    act(() => {
      captured!.onDelta('Hi there!');
    });

    // 7. Textarea should now be UNLOCKED
    await waitFor(() => {
      expect(textarea).not.toBeDisabled();
    });

    // 8. Session should be back in the ready set
    expect(isSessionReady('session-1')).toBe(true);

    // 9. The store reflects the streaming content (via getter which includes buffered deltas)
    const state = useChatStore.getState();
    expect(state.sendingSessionId).toBeNull();
    expect(state.getStreamingState('session-1').content).toBe('Hi there!');

    // Cleanup: finish the held promise so handleSubmit completes
    act(() => {
      captured!.onDone('msg-1');
      captured!.resolve();
    });
  });

  it('shows activation state after clearReadySession + send, clears on first SSE step', async () => {
    clearReadySession('session-1');

    render(<InputBox sessionId="session-1" />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: 'Step test' } });
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      await new Promise((r) => setTimeout(r, 0));
    });

    // Textarea stays enabled but placeholder indicates activation
    await waitFor(() => {
      expect(textarea.placeholder).toBe('Activating session, please wait...');
    });

    // First event is a step, not a delta — should still clear activation state
    act(() => {
      captured!.onStep({ title: 'Thinking...' });
    });

    await waitFor(() => {
      expect(useChatStore.getState().sendingSessionId).toBeNull();
    });

    expect(isSessionReady('session-1')).toBe(true);

    act(() => {
      captured!.onDone('msg-2');
      captured!.resolve();
    });
  });

  it('skips lock entirely when session is already ready', async () => {
    // Session is already in readySessions (from beforeEach markSessionReady)
    expect(isSessionReady('session-1')).toBe(true);

    render(<InputBox sessionId="session-1" />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: 'Quick message' } });
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      await new Promise((r) => setTimeout(r, 0));
    });

    // Should NOT be disabled — session was already ready, no lock needed
    expect(textarea).not.toBeDisabled();
    expect(textarea.placeholder).not.toMatch(/Activating session/);

    // But streaming should be active (message was sent)
    const state = useChatStore.getState();
    expect(state.streamingPerSession['session-1']?.isStreaming).toBe(true);

    act(() => {
      captured!.onDone('msg-3');
      captured!.resolve();
    });
  });

  it('does not lock other sessions when one session is activating', async () => {
    clearReadySession('session-1');
    markSessionReady('session-2');

    // Render InputBox for session-1 (will lock)
    const { unmount } = render(<InputBox sessionId="session-1" />);
    const textarea1 = screen.getByRole('textbox') as HTMLTextAreaElement;

    fireEvent.change(textarea1, { target: { value: 'Lock session 1' } });
    await act(async () => {
      fireEvent.keyDown(textarea1, { key: 'Enter', shiftKey: false });
      await new Promise((r) => setTimeout(r, 0));
    });

    // Session-1 textarea stays enabled but shows activation placeholder
    await waitFor(() => {
      expect(textarea1.placeholder).toBe('Activating session, please wait...');
    });

    // Now render InputBox for session-2 alongside
    unmount();
    render(<InputBox sessionId="session-2" />);
    const textarea2 = screen.getByRole('textbox') as HTMLTextAreaElement;

    // Session-2's input should NOT be locked
    expect(textarea2).not.toBeDisabled();
    expect(textarea2.placeholder).toMatch(/Type a message/);

    // Cleanup
    act(() => {
      captured!.onDone('msg-4');
      captured!.resolve();
    });
    clearReadySession('session-2');
  });
});
