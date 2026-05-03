import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockSwitchTab = vi.fn();
const mockClearNewSession = vi.fn();
const mockMarkViewed = vi.fn();

vi.mock('../../utils/formatters', () => ({
  formatSmartDate: (d: string) => 'smart-' + d,
  formatDateTime: (d: string) => 'dt-' + d,
}));

const mockSessionStoreState = {
  removeSession: vi.fn(),
  setSessions: vi.fn(),
  sessions: [],
  availableMcpServers: [],
  updateSessionMcpServers: vi.fn(),
  updateSessionTimestamp: vi.fn(),
  clearNewSession: mockClearNewSession,
};

vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: Object.assign(
    () => mockSessionStoreState,
    { getState: () => mockSessionStoreState }
  ),
}));

const mockChatStoreState = {
  messagesPerSession: {},
  setMessages: vi.fn(),
  clearSessionMessages: vi.fn(),
  setStreaming: vi.fn(),
  appendStreamingContent: vi.fn(),
  addStreamingStep: vi.fn(),
  finalizeStreaming: vi.fn(),
};

vi.mock('../../stores/chatStore', () => ({
  useChatStore: Object.assign(
    () => mockChatStoreState,
    { getState: () => mockChatStoreState }
  ),
}));

const mockViewedStoreState = {
  isAgentActive: () => false,
  setAgentActive: vi.fn(),
  markViewed: mockMarkViewed,
  hasUnread: () => false,
};

vi.mock('../../stores/viewedStore', () => ({
  useViewedStore: Object.assign(
    () => mockViewedStoreState,
    { getState: () => mockViewedStoreState }
  ),
}));

const mockTabStoreState = {
  tabs: [],
  activeTabId: null,
  openTab: vi.fn(),
  switchTab: mockSwitchTab,
  closeTab: vi.fn(),
};

vi.mock('../../stores/tabStore', () => ({
  useTabStore: Object.assign(
    () => mockTabStoreState,
    { getState: () => mockTabStoreState }
  ),
  tabId: { session: (id: string) => `session:${id}` },
}));

vi.mock('../../api/sessions', () => ({
  getSession: vi.fn(),
  deleteSession: vi.fn(),
  connectSession: vi.fn(),
  getResponseStatus: vi.fn().mockResolvedValue({ active: false }),
  resumeResponseStream: vi.fn(),
}));

import { SessionItem } from './SessionItem';
import type { Session } from '../../types/session';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    session_id: 'sess-1',
    session_name: 'My Session',
    model: 'gpt-4',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-02T00:00:00Z',
    ...overrides,
  };
}

describe('SessionItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders session name', () => {
    render(<SessionItem session={makeSession()} />);
    expect(screen.getByText('My Session')).toBeInTheDocument();
  });

  it('renders smart date from updated_at', () => {
    render(<SessionItem session={makeSession()} />);
    expect(screen.getByText('smart-2025-01-02T00:00:00Z')).toBeInTheDocument();
  });

  it('truncates long session names via CSS class', () => {
    render(<SessionItem session={makeSession({ session_name: 'A very long session name that should be truncated' })} />);
    const el = screen.getByText('A very long session name that should be truncated');
    expect(el).toHaveClass('truncate');
  });

  it('fires click handler on click', () => {
    render(<SessionItem session={makeSession()} />);
    const item = screen.getByText('My Session').closest('[class*="cursor-pointer"]');
    expect(item).not.toBeNull();
    fireEvent.click(item!);
    // Since it's not active and not open, it should try to open the session
    // The click handler is async, so we just verify no crash
  });

  it('does not show agent spinner when agent is inactive', () => {
    render(<SessionItem session={makeSession()} />);
    // By default isAgentActive returns false, so spinner should NOT be present
    expect(screen.queryByTitle('Agent is processing...')).not.toBeInTheDocument();
  });

  it('shows delete button on hover group', () => {
    render(<SessionItem session={makeSession()} />);
    expect(screen.getByTitle('Delete session')).toBeInTheDocument();
  });

  it('shows info button', () => {
    render(<SessionItem session={makeSession()} />);
    expect(screen.getByTitle('Session info')).toBeInTheDocument();
  });
});
