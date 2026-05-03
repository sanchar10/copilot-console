import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: () => ({
    sessions: [
      { session_id: 's1', session_name: 'Session One' },
      { session_id: 's2', session_name: 'Session Two' },
    ],
    isNewSession: false,
  }),
}));

vi.mock('../../stores/tabStore', () => ({
  useTabStore: () => ({
    tabs: [
      { id: 'session:s1', type: 'session', label: 'Session One', sessionId: 's1' },
      { id: 'session:s2', type: 'session', label: 'Session Two', sessionId: 's2' },
    ],
    activeTabId: 'session:s1',
    switchTab: vi.fn(),
    closeTab: vi.fn(),
  }),
}));

vi.mock('../../stores/chatStore', () => ({
  useChatStore: Object.assign(
    () => ({
      messagesPerSession: {},
      setMessages: vi.fn(),
      clearSessionMessages: vi.fn(),
    }),
    {
      getState: () => ({
        messagesPerSession: {},
        setMessages: vi.fn(),
        clearSessionMessages: vi.fn(),
      }),
    },
  ),
}));

vi.mock('../../stores/viewedStore', () => ({
  useViewedStore: () => ({
    markViewed: vi.fn(),
  }),
}));


vi.mock('../../api/sessions', () => ({
  getSession: vi.fn(),
  disconnectSession: vi.fn(),
}));

import { TabBar } from './TabBar';

describe('TabBar', () => {
  it('renders tab names', () => {
    render(<TabBar />);
    expect(screen.getByText('Session One')).toBeInTheDocument();
    expect(screen.getByText('Session Two')).toBeInTheDocument();
  });

  it('renders close buttons for tabs', () => {
    render(<TabBar />);
    const closeButtons = screen.getAllByTitle('Close tab');
    expect(closeButtons).toHaveLength(2);
  });
});
