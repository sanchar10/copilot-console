import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { retriggerMcpOAuth } from './mcpOAuth';

describe('retriggerMcpOAuth', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('POSTs to the correct URL and returns the parsed body', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'accepted', serverName: 'srv-1' }),
    });

    const result = await retriggerMcpOAuth('sess-abc', 'srv-1');
    expect(result).toEqual({ status: 'accepted', serverName: 'srv-1' });

    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('/api/mcp/sessions/sess-abc/srv-1/oauth-retrigger');
    expect(call[1]).toEqual({ method: 'POST' });
  });

  it('URL-encodes session and server name', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'accepted', serverName: 'a b' }),
    });

    await retriggerMcpOAuth('sess/with slash', 'name with space');
    const url = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(url).toBe('/api/mcp/sessions/sess%2Fwith%20slash/name%20with%20space/oauth-retrigger');
  });

  it('throws with detail from JSON error body', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ detail: 'Session has no active OAuth coordinator' }),
    });

    await expect(retriggerMcpOAuth('s', 'srv')).rejects.toThrow(
      'Session has no active OAuth coordinator',
    );
  });

  it('falls back to status code when error body is not JSON', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not json');
      },
    });

    await expect(retriggerMcpOAuth('s', 'srv')).rejects.toThrow(/500/);
  });

  it('falls back to status code when detail is missing', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    });

    await expect(retriggerMcpOAuth('s', 'srv')).rejects.toThrow(/404/);
  });
});
