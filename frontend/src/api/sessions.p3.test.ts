/**
 * P3-1 Tests — sendMessage Options Object Refactor
 *
 * These tests pin the expected behavior of the new options-object signature
 * for sendMessage(). Fenster will refactor the 15-positional-parameter
 * sendMessage() into a clean options-object shape.
 *
 * Tests will FAIL until the refactor lands — that's intentional.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We import the module so we can reference the future type.
// After refactor, sendMessage should accept (sessionId, content, options).
import * as sessionsModule from './sessions';

// ---------------------------------------------------------------------------
// Helpers — reused from sessions.test.ts
// ---------------------------------------------------------------------------

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

function mockFetch(status: number, body: ReadableStream<Uint8Array> | null, jsonBody?: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    body,
    json: () => Promise.resolve(jsonBody ?? {}),
  });
}

// ---------------------------------------------------------------------------
// P3-1: sendMessage should accept an options object
// ---------------------------------------------------------------------------

/**
 * Expected new signature (Fenster will implement):
 *
 *   sendMessage(sessionId: string, content: string, options: SendMessageOptions): Promise<void>
 *
 * Where SendMessageOptions contains:
 *   - model?: string              (required-ish — for future model override)
 *   - onDelta: (content: string) => void
 *   - onStep: (step: ChatStep) => void
 *   - onUsageInfo: (usage: {...}) => void
 *   - onDone: (messageId: string, sessionName?: string) => void
 *   - onError: (error: string) => void
 *   - isNewSession?: boolean
 *   - onTurnDone?: (messageId?: string) => void
 *   - attachments?: AttachmentRef[]
 *   - onModeChanged?: (mode: string) => void
 *   - agentMode?: string
 *   - fleet?: boolean
 *   - onElicitation?: (data: ElicitationRequest) => void
 *   - onAskUser?: (data: AskUserRequest) => void
 */

describe('P3-1: sendMessage options object', () => {
  let callbacks: {
    onDelta: ReturnType<typeof vi.fn>;
    onStep: ReturnType<typeof vi.fn>;
    onUsageInfo: ReturnType<typeof vi.fn>;
    onDone: ReturnType<typeof vi.fn>;
    onError: ReturnType<typeof vi.fn>;
    onTurnDone: ReturnType<typeof vi.fn>;
    onModeChanged: ReturnType<typeof vi.fn>;
    onElicitation: ReturnType<typeof vi.fn>;
    onAskUser: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    callbacks = {
      onDelta: vi.fn(),
      onStep: vi.fn(),
      onUsageInfo: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
      onTurnDone: vi.fn(),
      onModeChanged: vi.fn(),
      onElicitation: vi.fn(),
      onAskUser: vi.fn(),
    };
  });

  it('accepts required callbacks via options object', async () => {
    const stream = mockStream([
      sseChunk('delta', { content: 'Hi' }),
      sseChunk('done', { message_id: 'msg-1', session_name: 'Chat' }),
    ]);
    globalThis.fetch = mockFetch(200, stream) as unknown as typeof fetch;

    // New call shape: sendMessage(sessionId, content, options)
    await sessionsModule.sendMessage('sess-1', 'hello', {
      onDelta: callbacks.onDelta,
      onStep: callbacks.onStep,
      onUsageInfo: callbacks.onUsageInfo,
      onDone: callbacks.onDone,
      onError: callbacks.onError,
    });

    expect(callbacks.onDelta).toHaveBeenCalledWith('Hi');
    expect(callbacks.onDone).toHaveBeenCalledWith('msg-1', 'Chat');
  });

  it('works with all optional callbacks provided', async () => {
    const stream = mockStream([
      sseChunk('delta', { content: 'A' }),
      sseChunk('step', { title: 'Tool: grep' }),
      sseChunk('turn_done', { messageId: 'turn-1' }),
      sseChunk('mode_changed', { mode: 'agent' }),
      sseChunk('done', { message_id: 'msg-2' }),
    ]);
    globalThis.fetch = mockFetch(200, stream) as unknown as typeof fetch;

    await sessionsModule.sendMessage('sess-1', 'test', {
      onDelta: callbacks.onDelta,
      onStep: callbacks.onStep,
      onUsageInfo: callbacks.onUsageInfo,
      onDone: callbacks.onDone,
      onError: callbacks.onError,
      onTurnDone: callbacks.onTurnDone,
      onModeChanged: callbacks.onModeChanged,
      onElicitation: callbacks.onElicitation,
      onAskUser: callbacks.onAskUser,
      isNewSession: true,
      agentMode: 'plan',
      fleet: true,
    });

    expect(callbacks.onDelta).toHaveBeenCalledWith('A');
    expect(callbacks.onStep).toHaveBeenCalledWith({ title: 'Tool: grep' });
    expect(callbacks.onTurnDone).toHaveBeenCalledWith('turn-1');
    expect(callbacks.onModeChanged).toHaveBeenCalledWith('agent');
    expect(callbacks.onDone).toHaveBeenCalledWith('msg-2', undefined);
  });

  it('works when optional callbacks are omitted', async () => {
    const stream = mockStream([
      sseChunk('turn_done', { messageId: 'turn-1' }),
      sseChunk('mode_changed', { mode: 'agent' }),
      sseChunk('elicitation', { request_id: 'r1', message: 'ok?', schema: {}, source: 'tool' }),
      sseChunk('ask_user', { request_id: 'r2', question: 'Which?', allowFreeform: true }),
      sseChunk('done', { message_id: 'msg-3' }),
    ]);
    globalThis.fetch = mockFetch(200, stream) as unknown as typeof fetch;

    // Only required callbacks — no onTurnDone, onModeChanged, etc.
    await sessionsModule.sendMessage('sess-1', 'msg', {
      onDelta: callbacks.onDelta,
      onStep: callbacks.onStep,
      onUsageInfo: callbacks.onUsageInfo,
      onDone: callbacks.onDone,
      onError: callbacks.onError,
    });

    // Should not throw — optional callbacks are safely skipped
    expect(callbacks.onDone).toHaveBeenCalledWith('msg-3', undefined);
  });

  it('passes attachments and agentMode to the fetch body', async () => {
    const fetchSpy = mockFetch(200, mockStream([sseChunk('done', { message_id: 'm' })]));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await sessionsModule.sendMessage('sess-1', 'attached', {
      onDelta: callbacks.onDelta,
      onStep: callbacks.onStep,
      onUsageInfo: callbacks.onUsageInfo,
      onDone: callbacks.onDone,
      onError: callbacks.onError,
      isNewSession: true,
      attachments: [{ type: 'file' as const, path: '/readme.md' }],
      agentMode: 'plan',
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.content).toBe('attached');
    expect(body.is_new_session).toBe(true);
    expect(body.attachments).toEqual([{ type: 'file', path: '/readme.md' }]);
    expect(body.agent_mode).toBe('plan');
  });

  it('passes fleet flag to the fetch body', async () => {
    const fetchSpy = mockFetch(200, mockStream([sseChunk('done', { message_id: 'm' })]));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await sessionsModule.sendMessage('sess-1', 'fleet-msg', {
      onDelta: callbacks.onDelta,
      onStep: callbacks.onStep,
      onUsageInfo: callbacks.onUsageInfo,
      onDone: callbacks.onDone,
      onError: callbacks.onError,
      fleet: true,
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.fleet).toBe(true);
  });

  it('calls onError for non-OK HTTP response', async () => {
    globalThis.fetch = mockFetch(500, null, { error: 'server crash' }) as unknown as typeof fetch;

    await sessionsModule.sendMessage('sess-1', 'fail', {
      onDelta: callbacks.onDelta,
      onStep: callbacks.onStep,
      onUsageInfo: callbacks.onUsageInfo,
      onDone: callbacks.onDone,
      onError: callbacks.onError,
    });

    expect(callbacks.onError).toHaveBeenCalledWith('server crash');
    expect(callbacks.onDelta).not.toHaveBeenCalled();
  });
});
