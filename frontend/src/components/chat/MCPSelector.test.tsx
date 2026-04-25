import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MCPSelector } from './MCPSelector';
import type { MCPServer } from '../../types/mcp';
import type { EventEnvelope } from '../../api/events';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Capture handlers per event type so tests can drive them directly.
const handlers: Record<string, Array<(env: EventEnvelope<unknown>) => void>> = {};

vi.mock('../../api/events', () => ({
  openEventsChannel: vi.fn(),
  onEvent: vi.fn(<T,>(type: string, handler: (env: EventEnvelope<T>) => void) => {
    if (!handlers[type]) handlers[type] = [];
    handlers[type].push(handler as (env: EventEnvelope<unknown>) => void);
    return () => {
      const idx = handlers[type].indexOf(handler as (env: EventEnvelope<unknown>) => void);
      if (idx >= 0) handlers[type].splice(idx, 1);
    };
  }),
}));

const retriggerMock = vi.fn();
vi.mock('../../api/mcpOAuth', () => ({
  retriggerMcpOAuth: (...args: unknown[]) => retriggerMock(...args),
}));

const addToastMock = vi.fn();
vi.mock('../../stores/toastStore', () => ({
  useToastStore: {
    getState: () => ({ addToast: addToastMock }),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emit(type: string, sessionId: string | null, data: Record<string, unknown>) {
  const env: EventEnvelope<unknown> = {
    id: 1,
    type,
    ts: Date.now(),
    sessionId,
    data: { sessionId, ...data },
  };
  for (const h of handlers[type] || []) h(env);
}

const SERVERS: MCPServer[] = [
  { name: 'github', source: 'global', command: 'node', args: [], tools: ['*'] } as MCPServer,
  { name: 'bluebird', source: 'agent-only', type: 'http', url: 'https://x', tools: ['*'] } as MCPServer,
];

function setup(props: {
  sessionId?: string;
  readOnly?: boolean;
  selections?: Record<string, boolean>;
} = {}) {
  const onSelectionsChange = vi.fn();
  const utils = render(
    <MCPSelector
      availableServers={SERVERS}
      selections={props.selections ?? { github: true, bluebird: true }}
      onSelectionsChange={onSelectionsChange}
      sessionId={props.sessionId}
      readOnly={props.readOnly}
    />,
  );
  // Open the dropdown so badge rows are visible.
  fireEvent.click(screen.getByRole('button', { name: /MCP/ }));
  return { ...utils, onSelectionsChange };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCPSelector — badges', () => {
  beforeEach(() => {
    for (const k of Object.keys(handlers)) delete handlers[k];
    retriggerMock.mockReset();
    addToastMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not subscribe to bus events when sessionId is undefined', () => {
    setup({ sessionId: undefined });
    expect(handlers['mcp_server_status']).toBeUndefined();
  });

  it('subscribes to status events when sessionId is provided', () => {
    setup({ sessionId: 'sess-1' });
    expect(handlers['mcp_server_status']).toHaveLength(1);
    expect(handlers['mcp_oauth_required']).toHaveLength(1);
    expect(handlers['mcp_oauth_completed']).toHaveLength(1);
    expect(handlers['mcp_oauth_failed']).toHaveLength(1);
  });

  it('renders connected badge when status event arrives for matching session', async () => {
    setup({ sessionId: 'sess-1' });
    emit('mcp_server_status', 'sess-1', {
      statuses: [{ serverName: 'github', status: 'connected' }],
    });
    await waitFor(() => {
      expect(screen.getAllByLabelText('Connected').length).toBeGreaterThan(0);
    });
  });

  it('ignores events for other sessions', () => {
    setup({ sessionId: 'sess-1' });
    emit('mcp_server_status', 'sess-2', {
      statuses: [{ serverName: 'github', status: 'needs-auth' }],
    });
    expect(screen.queryByText('Sign in')).not.toBeInTheDocument();
  });

  it('shows "Sign in" button on needs-auth row', async () => {
    setup({ sessionId: 'sess-1' });
    emit('mcp_oauth_required', 'sess-1', {
      serverName: 'bluebird',
      authorizationUrl: 'https://example/oauth',
    });
    await waitFor(() => {
      expect(screen.getByText('Sign in')).toBeInTheDocument();
    });
  });

  it('does not flip a connected server back to needs-auth on stale failed event', async () => {
    setup({ sessionId: 'sess-1' });
    emit('mcp_server_status', 'sess-1', {
      statuses: [{ serverName: 'bluebird', status: 'connected' }],
    });
    await waitFor(() => {
      expect(screen.getAllByLabelText('Connected').length).toBeGreaterThan(0);
    });
    emit('mcp_oauth_failed', 'sess-1', {
      serverName: 'bluebird',
      reason: 'poll timeout',
    });
    // Still no Sign-in button — the connected status is preserved.
    expect(screen.queryByText('Sign in')).not.toBeInTheDocument();
  });

  it('mcp_oauth_failed flips a pending/needs-auth server to needs-auth (with retrigger button)', async () => {
    setup({ sessionId: 'sess-1' });
    emit('mcp_server_status', 'sess-1', {
      statuses: [{ serverName: 'bluebird', status: 'pending' }],
    });
    emit('mcp_oauth_failed', 'sess-1', {
      serverName: 'bluebird',
      reason: 'timeout',
    });
    await waitFor(() => {
      expect(screen.getByText('Sign in')).toBeInTheDocument();
    });
  });

  it('clicking "Sign in" calls retriggerMcpOAuth and optimistically flips badge to pending', async () => {
    retriggerMock.mockResolvedValue({ status: 'accepted', serverName: 'bluebird' });
    setup({ sessionId: 'sess-1' });
    emit('mcp_oauth_required', 'sess-1', {
      serverName: 'bluebird',
      authorizationUrl: 'https://x',
    });
    await waitFor(() => screen.getByText('Sign in'));
    fireEvent.click(screen.getByText('Sign in'));
    await waitFor(() => {
      expect(retriggerMock).toHaveBeenCalledWith('sess-1', 'bluebird');
    });
    // Optimistic flip — connecting badge should appear (or sign-in button gone).
    await waitFor(() => {
      expect(screen.queryByText('Sign in')).not.toBeInTheDocument();
    });
  });

  it('shows error toast when retrigger fails', async () => {
    retriggerMock.mockRejectedValue(new Error('Session has no active OAuth coordinator'));
    setup({ sessionId: 'sess-1' });
    emit('mcp_oauth_required', 'sess-1', {
      serverName: 'bluebird',
      authorizationUrl: 'https://x',
    });
    await waitFor(() => screen.getByText('Sign in'));
    fireEvent.click(screen.getByText('Sign in'));
    await waitFor(() => {
      expect(addToastMock).toHaveBeenCalled();
      const msg = addToastMock.mock.calls[0][0] as string;
      expect(msg).toContain('bluebird');
      expect(msg).toContain('Session has no active OAuth coordinator');
    });
  });

  it('Sign in button is enabled even when readOnly=true (mid-turn)', async () => {
    retriggerMock.mockResolvedValue({ status: 'accepted', serverName: 'bluebird' });
    setup({ sessionId: 'sess-1', readOnly: true });
    emit('mcp_oauth_required', 'sess-1', {
      serverName: 'bluebird',
      authorizationUrl: 'https://x',
    });
    await waitFor(() => screen.getByText('Sign in'));
    const btn = screen.getByText('Sign in') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(retriggerMock).toHaveBeenCalled());
  });

  it('aggregate badge on the picker button reflects worst status (needs-auth wins)', async () => {
    setup({ sessionId: 'sess-1' });
    emit('mcp_server_status', 'sess-1', {
      statuses: [
        { serverName: 'github', status: 'connected' },
        { serverName: 'bluebird', status: 'needs-auth' },
      ],
    });
    await waitFor(() => {
      expect(screen.getAllByLabelText(/Sign-in required/).length).toBeGreaterThan(0);
    });
  });

  it('aggregate badge ignores disabled (deselected) servers', async () => {
    setup({ sessionId: 'sess-1', selections: { github: true, bluebird: false } });
    emit('mcp_server_status', 'sess-1', {
      statuses: [
        { serverName: 'github', status: 'connected' },
        { serverName: 'bluebird', status: 'needs-auth' },
      ],
    });
    await waitFor(() => {
      // The connected badge for github should appear on the picker button
      // (only enabled servers count toward aggregate).
      expect(screen.getAllByLabelText('Connected').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByLabelText(/Sign-in required/).length).toBeLessThanOrEqual(1);
  });

  it('clears badge state when sessionId changes', async () => {
    const { rerender } = render(
      <MCPSelector
        availableServers={SERVERS}
        selections={{ github: true, bluebird: true }}
        onSelectionsChange={vi.fn()}
        sessionId="sess-1"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /MCP/ }));
    emit('mcp_server_status', 'sess-1', {
      statuses: [{ serverName: 'github', status: 'connected' }],
    });
    await waitFor(() => expect(screen.getAllByLabelText('Connected').length).toBeGreaterThan(0));

    // Switch session → state should reset, no badges.
    rerender(
      <MCPSelector
        availableServers={SERVERS}
        selections={{ github: true, bluebird: true }}
        onSelectionsChange={vi.fn()}
        sessionId="sess-2"
      />,
    );
    await waitFor(() => {
      // After session change, no statuses observed yet, no Connected badge in dropdown rows.
      // (The picker button itself also has no aggregate badge.)
      expect(screen.queryByLabelText('Connected')).not.toBeInTheDocument();
    });
  });
});
