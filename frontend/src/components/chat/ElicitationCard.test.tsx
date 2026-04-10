import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the API
const mockRespondToElicitation = vi.fn().mockResolvedValue({ status: 'resolved', action: 'accept' });

vi.mock('../../api/sessions', () => ({
  respondToElicitation: (...args: unknown[]) => mockRespondToElicitation(...args),
}));

// Mock chatStore
const mockResolveElicitation = vi.fn();
vi.mock('../../stores/chatStore', () => ({
  useChatStore: () => ({
    resolveElicitation: mockResolveElicitation,
  }),
}));

import { ElicitationCard, ResolvedElicitationCard } from './ElicitationCard';

describe('ElicitationCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseData = {
    request_id: 'req-789',
    message: 'Configure your project:',
    schema: {
      type: 'object',
      properties: {
        database: { type: 'string', title: 'Database', enum: ['PostgreSQL', 'MySQL', 'SQLite'] },
        port: { type: 'integer', title: 'Port', default: 5432 },
        enableCaching: { type: 'boolean', title: 'Enable Caching', default: true },
      },
      required: ['database'],
    },
    source: 'test',
  };

  it('renders the message', () => {
    render(<ElicitationCard sessionId="s1" data={baseData} />);
    expect(screen.getByText('Configure your project:')).toBeInTheDocument();
  });

  it('renders Agent needs your input header', () => {
    render(<ElicitationCard sessionId="s1" data={baseData} />);
    expect(screen.getByText('Agent needs your input')).toBeInTheDocument();
  });

  it('renders source when provided', () => {
    render(<ElicitationCard sessionId="s1" data={baseData} />);
    expect(screen.getByText('from test')).toBeInTheDocument();
  });

  it('renders form fields from schema', () => {
    render(<ElicitationCard sessionId="s1" data={baseData} />);
    expect(screen.getByText('Database')).toBeInTheDocument();
    expect(screen.getByText('Port')).toBeInTheDocument();
    expect(screen.getByText('Enable Caching')).toBeInTheDocument();
  });

  it('renders dropdown for enum field', () => {
    render(<ElicitationCard sessionId="s1" data={baseData} />);
    // Custom Dropdown renders a button trigger, not a native combobox
    expect(screen.getByText('Select...')).toBeInTheDocument();
  });

  it('renders required indicator for required fields', () => {
    render(<ElicitationCard sessionId="s1" data={baseData} />);
    const markers = screen.getAllByText('*');
    expect(markers.length).toBeGreaterThan(0);
  });

  it('Accept is disabled when required fields are empty', () => {
    render(<ElicitationCard sessionId="s1" data={baseData} />);
    const acceptBtn = screen.getByText('Accept ✓');
    expect(acceptBtn).toBeDisabled();
  });

  it('Accept is enabled after filling required fields', () => {
    render(<ElicitationCard sessionId="s1" data={baseData} />);
    // Open dropdown and select PostgreSQL
    fireEvent.click(screen.getByText('Select...'));
    fireEvent.click(screen.getByText('PostgreSQL'));
    const acceptBtn = screen.getByText('Accept ✓');
    expect(acceptBtn).not.toBeDisabled();
  });

  it('calls respondToElicitation on Accept', async () => {
    render(<ElicitationCard sessionId="s1" data={baseData} />);
    // Open dropdown and select MySQL
    fireEvent.click(screen.getByText('Select...'));
    fireEvent.click(screen.getByText('MySQL'));
    fireEvent.click(screen.getByText('Accept ✓'));

    await waitFor(() => {
      expect(mockRespondToElicitation).toHaveBeenCalledWith(
        's1', 'req-789', 'accept',
        expect.objectContaining({ database: 'MySQL' })
      );
    });
    expect(mockResolveElicitation).toHaveBeenCalled();
  });

  it('calls respondToElicitation on Decline', async () => {
    render(<ElicitationCard sessionId="s1" data={baseData} />);
    fireEvent.click(screen.getByText('Decline'));

    await waitFor(() => {
      expect(mockRespondToElicitation).toHaveBeenCalledWith('s1', 'req-789', 'decline', undefined);
    });
  });

  it('calls respondToElicitation on Cancel', async () => {
    render(<ElicitationCard sessionId="s1" data={baseData} />);
    fireEvent.click(screen.getByText('Cancel'));

    await waitFor(() => {
      expect(mockRespondToElicitation).toHaveBeenCalledWith('s1', 'req-789', 'cancel', undefined);
    });
  });

  it('has three action buttons', () => {
    render(<ElicitationCard sessionId="s1" data={baseData} />);
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('Decline')).toBeInTheDocument();
    expect(screen.getByText('Accept ✓')).toBeInTheDocument();
  });
});

describe('ResolvedElicitationCard', () => {
  it('renders accepted state with values', () => {
    render(
      <ResolvedElicitationCard
        resolved={{
          requestId: 'req-1',
          message: 'Config',
          action: 'accept',
          values: { database: 'PostgreSQL', port: 5432 },
        }}
        schema={{
          properties: {
            database: { type: 'string', title: 'Database' },
            port: { type: 'integer', title: 'Port' },
          },
        }}
      />
    );
    expect(screen.getByText('✓ You responded')).toBeInTheDocument();
    expect(screen.getByText(/Database:/)).toBeInTheDocument();
    expect(screen.getByText(/PostgreSQL/)).toBeInTheDocument();
    expect(screen.getByText(/Port:/)).toBeInTheDocument();
    expect(screen.getByText(/5432/)).toBeInTheDocument();
  });

  it('renders declined state', () => {
    render(
      <ResolvedElicitationCard
        resolved={{
          requestId: 'req-2',
          message: 'Config',
          action: 'decline',
        }}
      />
    );
    expect(screen.getByText(/Declined/)).toBeInTheDocument();
  });

  it('renders cancelled state', () => {
    render(
      <ResolvedElicitationCard
        resolved={{
          requestId: 'req-3',
          message: 'Config',
          action: 'cancel',
        }}
      />
    );
    expect(screen.getByText(/Cancelled/)).toBeInTheDocument();
  });
});
