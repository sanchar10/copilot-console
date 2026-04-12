/**
 * Characterization tests for SSE parsing in activeAgents.ts
 *
 * Pins the current behavior of subscribeToActiveAgents() before restructuring.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { subscribeToActiveAgents } from './activeAgents';

function sseChunk(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function mockStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]));
        i++;
      } else {
        controller.close();
      }
    },
  });
}

describe('subscribeToActiveAgents SSE parsing', () => {
  let onUpdate: ReturnType<typeof vi.fn>;
  let onCompleted: ReturnType<typeof vi.fn>;
  let onError: ReturnType<typeof vi.fn>;
  let origFetch: typeof fetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
    onUpdate = vi.fn();
    onCompleted = vi.fn();
    onError = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('dispatches update events', async () => {
    const updateData = { count: 2, sessions: [{ session_id: 's1', status: 'running', chunks_count: 5, steps_count: 1, started_at: null }] };
    const stream = mockStream([sseChunk('update', updateData)]);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, body: stream,
    }) as unknown as typeof fetch;

    subscribeToActiveAgents(onUpdate, onCompleted, onError);

    // Wait for stream to be consumed
    await new Promise((r) => setTimeout(r, 50));

    expect(onUpdate).toHaveBeenCalledWith(updateData);
  });

  it('dispatches completed events with session_id and updated_at', async () => {
    const stream = mockStream([
      sseChunk('completed', { session_id: 's1', updated_at: 1700000000 }),
    ]);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, body: stream,
    }) as unknown as typeof fetch;

    subscribeToActiveAgents(onUpdate, onCompleted, onError);
    await new Promise((r) => setTimeout(r, 50));

    expect(onCompleted).toHaveBeenCalledWith('s1', 1700000000);
  });

  it('calls onError on non-OK response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 500,
    }) as unknown as typeof fetch;

    subscribeToActiveAgents(onUpdate, onCompleted, onError);
    await new Promise((r) => setTimeout(r, 50));

    expect(onError).toHaveBeenCalledWith('Failed to connect to active agents stream');
  });

  it('returns an AbortController for cancellation', () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, body: mockStream([]),
    }) as unknown as typeof fetch;

    const controller = subscribeToActiveAgents(onUpdate, onCompleted, onError);
    expect(controller).toBeInstanceOf(AbortController);
    controller.abort(); // should not throw
  });
});
