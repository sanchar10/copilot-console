/**
 * Tests for the desktop apiClient's network-error toast behavior.
 *
 * Pins:
 * - TypeError from fetch (server unreachable) fires a single dedup'd toast.
 * - AbortError from fetch is silent (not a connectivity failure).
 * - Successful responses do not toast.
 * - Multiple concurrent failures collapse into one toast via the fixed id.
 * - Original errors are always re-thrown unchanged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiClient, ApiError } from './client';
import { useToastStore } from '../stores/toastStore';

describe('apiClient — server-down toast', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fires a dedup\'d server-down toast when fetch throws TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));

    await expect(apiClient.get('/sessions')).rejects.toThrow(TypeError);

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].id).toBe('server-down');
    expect(toasts[0].type).toBe('error');
    expect(toasts[0].message).toMatch(/server unreachable/i);
  });

  it('does NOT toast on AbortError', async () => {
    const abortErr = new DOMException('Aborted', 'AbortError');
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(abortErr)));

    await expect(apiClient.get('/sessions')).rejects.toBe(abortErr);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('does NOT toast on successful response', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )));

    await apiClient.get('/sessions');
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('does NOT toast on non-network HTTP errors (5xx) — handleResponse owns those', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
      new Response(JSON.stringify({ error: 'boom' }), { status: 500 }),
    )));

    await expect(apiClient.get('/sessions')).rejects.toBeInstanceOf(ApiError);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('coalesces multiple concurrent network failures into a single toast', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));

    await Promise.all([
      apiClient.get('/sessions').catch(() => {}),
      apiClient.get('/agents').catch(() => {}),
      apiClient.post('/sessions', {}).catch(() => {}),
    ]);

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].id).toBe('server-down');
  });

  it('re-throws the original error unchanged on TypeError', async () => {
    const original = new TypeError('Failed to fetch');
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(original)));

    await expect(apiClient.get('/sessions')).rejects.toBe(original);
  });
});
