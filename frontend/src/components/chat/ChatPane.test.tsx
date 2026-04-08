import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// jsdom doesn't implement scrollIntoView — stub it globally
Element.prototype.scrollIntoView = vi.fn();

// --- Mutable store state for per-test customisation ---
let mockSessionState: Record<string, unknown> = {};
let mockChatState: Record<string, unknown> = {};
let mockTabState: Record<string, unknown> = {};

vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: () => mockSessionState,
}));

vi.mock('../../stores/chatStore', () => ({
  useChatStore: Object.assign(() => mockChatState, {
    getState: () => mockChatState,
  }),
}));

vi.mock('../../stores/tabStore', () => ({
  useTabStore: Object.assign(() => mockTabState, {
    getState: () => mockTabState,
  }),
}));

vi.mock('../../stores/uiStore', () => ({
  useUIStore: () => ({
    availableModels: ['gpt-4'],
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

// Stub child components to isolate ChatPane logic.
// InputBox is named-exported alongside clearReadySession, so mock the module.
vi.mock('./InputBox', () => ({
  InputBox: ({ sessionId }: { sessionId?: string }) => (
    <div data-testid={`inputbox-${sessionId ?? 'new'}`}>InputBox:{sessionId ?? 'new'}</div>
  ),
  clearReadySession: vi.fn(),
}));

vi.mock('./TabBar', () => ({
  TabBar: () => <div data-testid="tabbar">TabBar</div>,
}));

vi.mock('../layout/Header', () => ({
  Header: () => <div data-testid="header">Header</div>,
}));

vi.mock('./MessageBubble', () => ({
  MessageBubble: ({ message }: { message: { id: string; content: string } }) => (
    <div data-testid={`msg-${message.id}`}>{message.content}</div>
  ),
}));

vi.mock('./StreamingMessage', () => ({
  StreamingMessage: () => <div data-testid="streaming">streaming…</div>,
}));

vi.mock('../../api/sessions', () => ({
  updateSession: vi.fn(),
}));

import { ChatPane } from './ChatPane';

// Helpers
const baseSessions = [
  { session_id: 'A', session_name: 'Session A', model: 'gpt-4', cwd: '/a', mcp_servers: [], tools: [] },
  { session_id: 'B', session_name: 'Session B', model: 'gpt-4', cwd: '/b', mcp_servers: [], tools: [] },
];

function setupStores(overrides?: { openTabs?: string[]; currentSessionId?: string | null; messages?: Record<string, unknown[]> }) {
  const openTabs = overrides?.openTabs ?? ['A', 'B'];
  const currentSessionId = overrides?.currentSessionId ?? 'A';
  const activeTabId = currentSessionId ? `session:${currentSessionId}` : null;
  const messages = overrides?.messages ?? {};

  const tabs = openTabs.map((id) => ({
    id: `session:${id}`,
    type: 'session',
    label: `Session ${id}`,
    sessionId: id,
  }));

  mockTabState = {
    tabs,
    activeTabId,
    openTab: vi.fn(),
    closeTab: vi.fn(),
    switchTab: vi.fn(),
    getActiveSessionId: () => currentSessionId,
    getOpenSessionIds: () => openTabs,
    isTabOpen: (tabId: string) => tabs.some((t: { id: string }) => t.id === tabId),
  };

  mockSessionState = {
    sessions: baseSessions,
    isNewSession: false,
    newSessionSettings: null,
    availableMcpServers: [],
    availableTools: [],
    setSessions: vi.fn(),
    updateNewSessionSettings: vi.fn(),
    updateSessionMcpServers: vi.fn(),
    updateSessionTools: vi.fn(),
  };

  mockChatState = {
    messagesPerSession: messages,
    getStreamingState: () => ({ content: '', steps: [], isStreaming: false }),
    getTokenUsage: () => null,
    clearTokenUsage: vi.fn(),
    sendingSessionId: null,
    pendingElicitation: {},
    resolvedElicitations: {},
    setSending: vi.fn(),
    setStreaming: vi.fn(),
    addMessage: vi.fn(),
    appendStreamingContent: vi.fn(),
    addStreamingStep: vi.fn(),
    setTokenUsage: vi.fn(),
    finalizeStreaming: vi.fn(),
    finalizeTurn: vi.fn(),
  };
}

describe('ChatPane — tab persistence', () => {
  beforeEach(() => setupStores());

  it('renders all open tabs in the DOM simultaneously', () => {
    render(<ChatPane />);

    // Both InputBox instances should be in the DOM — not just the active one
    expect(screen.getByTestId('inputbox-A')).toBeInTheDocument();
    expect(screen.getByTestId('inputbox-B')).toBeInTheDocument();
  });

  it('active tab is visible (display:flex), inactive tab is hidden (display:none)', () => {
    render(<ChatPane />);

    // SessionTabContent renders a wrapper div with style={{ display: ... }}
    // The InputBox testid lets us find their parent containers.
    const inputA = screen.getByTestId('inputbox-A');
    const inputB = screen.getByTestId('inputbox-B');

    // Walk up to the SessionTabContent wrapper (the div with explicit display style)
    const wrapperA = inputA.closest('[style]') as HTMLElement;
    const wrapperB = inputB.closest('[style]') as HTMLElement;

    expect(wrapperA).not.toBeNull();
    expect(wrapperB).not.toBeNull();

    // Tab A is active (currentSessionId = 'A')
    expect(wrapperA!.style.display).toBe('flex');
    // Tab B is inactive
    expect(wrapperB!.style.display).toBe('none');
  });

  it('switching active tab flips visibility', () => {
    // First render with A active
    setupStores({ currentSessionId: 'A' });
    const { rerender } = render(<ChatPane />);

    const getWrapper = (testId: string) =>
      screen.getByTestId(testId).closest('[style]') as HTMLElement;

    expect(getWrapper('inputbox-A').style.display).toBe('flex');
    expect(getWrapper('inputbox-B').style.display).toBe('none');

    // "Switch" to B by updating store state and re-rendering
    setupStores({ currentSessionId: 'B' });
    rerender(<ChatPane />);

    expect(getWrapper('inputbox-A').style.display).toBe('none');
    expect(getWrapper('inputbox-B').style.display).toBe('flex');
  });

  it('each tab gets its own InputBox with the correct sessionId', () => {
    render(<ChatPane />);

    expect(screen.getByText('InputBox:A')).toBeInTheDocument();
    expect(screen.getByText('InputBox:B')).toBeInTheDocument();
  });

  it('messages from both sessions are in the DOM', () => {
    setupStores({
      messages: {
        A: [{ id: 'a1', role: 'user', content: 'Hello from A', timestamp: '2026-01-01' }],
        B: [{ id: 'b1', role: 'user', content: 'Hello from B', timestamp: '2026-01-01' }],
      },
    });

    render(<ChatPane />);

    // Both messages should be in the DOM (even though B's tab is hidden)
    expect(screen.getByTestId('msg-a1')).toBeInTheDocument();
    expect(screen.getByTestId('msg-b1')).toBeInTheDocument();
  });
});
