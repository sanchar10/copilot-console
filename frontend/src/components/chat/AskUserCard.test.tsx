import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the API
const mockRespondToUserInput = vi.fn().mockResolvedValue({ status: 'resolved' });

vi.mock('../../api/sessions', () => ({
  respondToUserInput: (...args: unknown[]) => mockRespondToUserInput(...args),
}));

// Mock chatStore
const mockClearAskUser = vi.fn();
vi.mock('../../stores/chatStore', () => ({
  useChatStore: () => ({
    clearAskUser: mockClearAskUser,
  }),
}));

import { AskUserCard } from './AskUserCard';

describe('AskUserCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseData = {
    request_id: 'req-123',
    question: 'Which database?',
    choices: ['PostgreSQL', 'MySQL', 'SQLite'],
    allowFreeform: true,
  };

  it('renders the question text', () => {
    render(<AskUserCard sessionId="s1" data={baseData} />);
    expect(screen.getByText('Which database?')).toBeInTheDocument();
  });

  it('renders all choices as buttons', () => {
    render(<AskUserCard sessionId="s1" data={baseData} />);
    expect(screen.getByText(/PostgreSQL/)).toBeInTheDocument();
    expect(screen.getByText(/MySQL/)).toBeInTheDocument();
    expect(screen.getByText(/SQLite/)).toBeInTheDocument();
  });

  it('renders Other option when allowFreeform is true', () => {
    render(<AskUserCard sessionId="s1" data={baseData} />);
    expect(screen.getByText(/Other/)).toBeInTheDocument();
  });

  it('does not render Other option when allowFreeform is false', () => {
    render(<AskUserCard sessionId="s1" data={{ ...baseData, allowFreeform: false }} />);
    expect(screen.queryByText(/Other/)).not.toBeInTheDocument();
  });

  it('renders text input when no choices provided', () => {
    const data = { request_id: 'req-456', question: 'Enter your name:', choices: null, allowFreeform: true };
    render(<AskUserCard sessionId="s1" data={data} />);
    expect(screen.getByPlaceholderText('Type your answer...')).toBeInTheDocument();
  });

  it('submit is disabled until a choice is selected', () => {
    render(<AskUserCard sessionId="s1" data={baseData} />);
    const submitBtn = screen.getByText('Submit ✓');
    expect(submitBtn).toBeDisabled();
  });

  it('submit is enabled after selecting a choice', () => {
    render(<AskUserCard sessionId="s1" data={baseData} />);
    fireEvent.click(screen.getByText(/PostgreSQL/));
    const submitBtn = screen.getByText('Submit ✓');
    expect(submitBtn).not.toBeDisabled();
  });

  it('calls respondToUserInput with selected choice on submit', async () => {
    render(<AskUserCard sessionId="s1" data={baseData} />);
    fireEvent.click(screen.getByText(/MySQL/));
    fireEvent.click(screen.getByText('Submit ✓'));

    await waitFor(() => {
      expect(mockRespondToUserInput).toHaveBeenCalledWith('s1', 'req-123', 'MySQL', false);
    });
    expect(mockClearAskUser).toHaveBeenCalledWith('s1');
  });

  it('calls respondToUserInput with cancelled flag on skip', async () => {
    render(<AskUserCard sessionId="s1" data={baseData} />);
    fireEvent.click(screen.getByText('Skip'));

    await waitFor(() => {
      expect(mockRespondToUserInput).toHaveBeenCalledWith('s1', 'req-123', '', true, true);
    });
    expect(mockClearAskUser).toHaveBeenCalledWith('s1');
  });

  it('submits freeform text when Other is selected', async () => {
    render(<AskUserCard sessionId="s1" data={baseData} />);
    fireEvent.click(screen.getByText(/Other/));
    const input = screen.getByPlaceholderText('Type your answer...');
    fireEvent.change(input, { target: { value: 'MongoDB' } });
    fireEvent.click(screen.getByText('Submit ✓'));

    await waitFor(() => {
      expect(mockRespondToUserInput).toHaveBeenCalledWith('s1', 'req-123', 'MongoDB', true);
    });
  });

  it('renders Agent is asking header', () => {
    render(<AskUserCard sessionId="s1" data={baseData} />);
    expect(screen.getByText('Agent is asking')).toBeInTheDocument();
  });
});
