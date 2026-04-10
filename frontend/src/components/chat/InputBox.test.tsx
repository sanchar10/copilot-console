import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// --- Mutable mock state ---
let mockChatState: Record<string, unknown> = {};

vi.mock('../../stores/chatStore', () => ({
  useChatStore: () => mockChatState,
}));

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
    { getState: () => ({ currentSessionId: 'test-session' }) },
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

vi.mock('../../api/sessions', () => ({
  sendMessage: vi.fn(),
  createSession: vi.fn(),
  connectSession: vi.fn(),
  enqueueMessage: vi.fn(),
  abortSession: vi.fn(),
}));

import { InputBox, clearReadySession, isSessionReady, markSessionReady } from './InputBox';

function setupChat(overrides?: Partial<typeof mockChatState>) {
  mockChatState = {
    sendingSessionId: null,
    getStreamingState: () => ({ isStreaming: false }),
    setSending: vi.fn(),
    setStreaming: vi.fn(),
    addMessage: vi.fn(),
    appendStreamingContent: vi.fn(),
    addStreamingStep: vi.fn(),
    setTokenUsage: vi.fn(),
    finalizeStreaming: vi.fn(),
    finalizeTurn: vi.fn(),
    ...overrides,
  };
}

describe('InputBox', () => {
  beforeEach(() => setupChat());

  it('renders a textarea', () => {
    render(<InputBox sessionId="test-session" />);
    expect(screen.getByPlaceholderText(/Type a message/)).toBeInTheDocument();
  });

  it('accepts user input', () => {
    render(<InputBox sessionId="test-session" />);
    const textarea = screen.getByPlaceholderText(/Type a message/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hello' } });
    expect(textarea.value).toBe('hello');
  });

  it('has a send button', () => {
    render(<InputBox sessionId="test-session" />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });
});

describe('InputBox — per-session sending lock', () => {
  it('is disabled when sendingSessionId matches this session', () => {
    setupChat({ sendingSessionId: 'session-A' });
    render(<InputBox sessionId="session-A" />);

    // Textarea stays enabled (editable) but shows activating placeholder
    const textarea = screen.getByPlaceholderText(/Activating session/);
    expect(textarea).not.toBeDisabled();
  });

  it('is NOT disabled when sendingSessionId is a different session', () => {
    setupChat({ sendingSessionId: 'session-OTHER' });
    render(<InputBox sessionId="session-A" />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    expect(textarea).not.toBeDisabled();
  });

  it('is NOT disabled when sendingSessionId is null', () => {
    setupChat({ sendingSessionId: null });
    render(<InputBox sessionId="session-A" />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    expect(textarea).not.toBeDisabled();
  });

  it('shows "Activating session" placeholder only for the locked session', () => {
    setupChat({ sendingSessionId: 'session-A' });

    const { unmount } = render(<InputBox sessionId="session-A" />);
    expect(screen.getByPlaceholderText(/Activating session, please wait/)).toBeInTheDocument();
    unmount();

    // Different session should NOT show the activating message
    render(<InputBox sessionId="session-B" />);
    expect(screen.queryByPlaceholderText(/Activating session/)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Type a message/)).toBeInTheDocument();
  });

  it('shows enqueue placeholder when streaming (not sending)', () => {
    setupChat({
      sendingSessionId: null,
      getStreamingState: () => ({ isStreaming: true, content: 'hi', steps: [] }),
    });
    render(<InputBox sessionId="session-A" />);

    const textarea = screen.getByPlaceholderText(/Agent is responding/);
    expect(textarea).not.toBeDisabled();
  });
});

describe('clearReadySession', () => {
  beforeEach(() => {
    // Ensure clean state — clear any leftovers from prior tests
    clearReadySession('sess-1');
    clearReadySession('sess-2');
  });

  it('removes a session from the ready set', () => {
    markSessionReady('sess-1');
    expect(isSessionReady('sess-1')).toBe(true);

    clearReadySession('sess-1');
    expect(isSessionReady('sess-1')).toBe(false);
  });

  it('is a no-op for sessions not in the set', () => {
    expect(isSessionReady('sess-2')).toBe(false);
    clearReadySession('sess-2'); // should not throw
    expect(isSessionReady('sess-2')).toBe(false);
  });

  it('does not affect other sessions', () => {
    markSessionReady('sess-1');
    markSessionReady('sess-2');

    clearReadySession('sess-1');

    expect(isSessionReady('sess-1')).toBe(false);
    expect(isSessionReady('sess-2')).toBe(true);

    // Cleanup
    clearReadySession('sess-2');
  });
});
