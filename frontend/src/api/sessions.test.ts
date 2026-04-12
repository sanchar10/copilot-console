/**
 * Characterization tests for SSE parsing logic in sessions.ts
 *
 * These pin the current behavior of sendMessage() and resumeResponseStream()
 * before Fenster restructures them. Any refactoring that changes how SSE events
 * are parsed or dispatched should break at least one of these tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendMessage, resumeResponseStream } from './sessions';

// ---------------------------------------------------------------------------
// Helpers — build a mock fetch that streams SSE chunks via ReadableStream
// ---------------------------------------------------------------------------

function sseChunk(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Encode a list of raw SSE text chunks into a ReadableStream of Uint8Array. */
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
// SSE parsing — sendMessage
// ---------------------------------------------------------------------------

describe('sendMessage SSE parsing', () => {
  let onDelta: ReturnType<typeof vi.fn>;
  let onStep: ReturnType<typeof vi.fn>;
  let onUsageInfo: ReturnType<typeof vi.fn>;
  let onDone: ReturnType<typeof vi.fn>;
  let onError: ReturnType<typeof vi.fn>;
  let onTurnDone: ReturnType<typeof vi.fn>;
  let onModeChanged: ReturnType<typeof vi.fn>;
  let onElicitation: ReturnType<typeof vi.fn>;
  let onAskUser: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onDelta = vi.fn();
    onStep = vi.fn();
    onUsageInfo = vi.fn();
    onDone = vi.fn();
    onError = vi.fn();
    onTurnDone = vi.fn();
    onModeChanged = vi.fn();
    onElicitation = vi.fn();
    onAskUser = vi.fn();
  });

  async function callSendMessage(chunks: string[], fetchOverrides?: Partial<Response>) {
    const stream = mockStream(chunks);
    globalThis.fetch = mockFetch(200, stream) as unknown as typeof fetch;
    await sendMessage(
      'sess-1', 'hello',
      onDelta, onStep, onUsageInfo, onDone, onError,
      false, undefined, onTurnDone, undefined, onModeChanged,
      undefined, undefined, onElicitation, onAskUser,
    );
  }

  // --- delta events ---

  it('dispatches delta events with content', async () => {
    await callSendMessage([
      sseChunk('delta', { content: 'Hello' }),
      sseChunk('delta', { content: ' world' }),
      sseChunk('done', { message_id: 'msg-1' }),
    ]);
    expect(onDelta).toHaveBeenCalledTimes(2);
    expect(onDelta).toHaveBeenNthCalledWith(1, 'Hello');
    expect(onDelta).toHaveBeenNthCalledWith(2, ' world');
  });

  // --- step events ---

  it('dispatches step events with title', async () => {
    await callSendMessage([
      sseChunk('step', { title: 'Thinking', detail: 'processing' }),
      sseChunk('done', { message_id: 'm1' }),
    ]);
    expect(onStep).toHaveBeenCalledWith({ title: 'Thinking', detail: 'processing' });
  });

  it('ignores step events without title', async () => {
    await callSendMessage([
      sseChunk('step', { detail: 'orphan detail' }),
      sseChunk('done', { message_id: 'm1' }),
    ]);
    expect(onStep).not.toHaveBeenCalled();
  });

  // --- done events ---

  it('dispatches done with message_id and session_name', async () => {
    await callSendMessage([
      sseChunk('done', { message_id: 'msg-42', session_name: 'My Chat' }),
    ]);
    expect(onDone).toHaveBeenCalledWith('msg-42', 'My Chat');
  });

  it('done falls back to empty string when message_id is missing', async () => {
    await callSendMessage([sseChunk('done', {})]);
    expect(onDone).toHaveBeenCalledWith('', undefined);
  });

  // --- usage_info events ---

  it('dispatches usage_info events', async () => {
    const usage = { tokenLimit: 128000, currentTokens: 5000, messagesLength: 10 };
    await callSendMessage([
      sseChunk('usage_info', usage),
      sseChunk('done', { message_id: 'm' }),
    ]);
    expect(onUsageInfo).toHaveBeenCalledWith(usage);
  });

  it('ignores usage_info without tokenLimit', async () => {
    await callSendMessage([
      sseChunk('usage_info', { currentTokens: 5000 }),
      sseChunk('done', { message_id: 'm' }),
    ]);
    expect(onUsageInfo).not.toHaveBeenCalled();
  });

  // --- turn_done events ---

  it('dispatches turn_done with messageId', async () => {
    await callSendMessage([
      sseChunk('turn_done', { messageId: 'turn-1' }),
      sseChunk('done', { message_id: 'm' }),
    ]);
    expect(onTurnDone).toHaveBeenCalledWith('turn-1');
  });

  // --- error events ---

  it('dispatches error events', async () => {
    await callSendMessage([
      sseChunk('error', { error: 'rate limited' }),
    ]);
    expect(onError).toHaveBeenCalledWith('rate limited');
  });

  // --- mode_changed events ---

  it('dispatches mode_changed events', async () => {
    await callSendMessage([
      sseChunk('mode_changed', { mode: 'agent' }),
      sseChunk('done', { message_id: 'm' }),
    ]);
    expect(onModeChanged).toHaveBeenCalledWith('agent');
  });

  // --- elicitation events ---

  it('dispatches elicitation events', async () => {
    const elicitation = { request_id: 'req-1', message: 'Confirm?', schema: {}, source: 'tool' };
    await callSendMessage([
      sseChunk('elicitation', elicitation),
      sseChunk('done', { message_id: 'm' }),
    ]);
    expect(onElicitation).toHaveBeenCalledWith(elicitation);
  });

  // --- ask_user events ---

  it('dispatches ask_user events', async () => {
    const askUser = { request_id: 'req-2', question: 'Which branch?', choices: ['main', 'dev'], allowFreeform: true };
    await callSendMessage([
      sseChunk('ask_user', askUser),
      sseChunk('done', { message_id: 'm' }),
    ]);
    expect(onAskUser).toHaveBeenCalledWith(askUser);
  });

  // --- multi-event stream ---

  it('handles a full lifecycle: delta → step → usage → done', async () => {
    await callSendMessage([
      sseChunk('delta', { content: 'A' }),
      sseChunk('step', { title: 'Tool: grep' }),
      sseChunk('usage_info', { tokenLimit: 128000, currentTokens: 100, messagesLength: 2 }),
      sseChunk('delta', { content: 'B' }),
      sseChunk('done', { message_id: 'msg-final', session_name: 'Named' }),
    ]);
    expect(onDelta).toHaveBeenCalledTimes(2);
    expect(onStep).toHaveBeenCalledTimes(1);
    expect(onUsageInfo).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith('msg-final', 'Named');
  });

  // --- edge: events split across chunks ---

  it('handles SSE events split across ReadableStream chunks', async () => {
    const encoder = new TextEncoder();
    // Split a single SSE event across two chunks
    const fullEvent = `event: delta\ndata: {"content":"split"}\n\n`;
    const half1 = fullEvent.slice(0, 15);
    const half2 = fullEvent.slice(15);
    const doneEvent = sseChunk('done', { message_id: 'm' });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(half1));
        controller.enqueue(encoder.encode(half2));
        controller.enqueue(encoder.encode(doneEvent));
        controller.close();
      },
    });

    globalThis.fetch = mockFetch(200, stream) as unknown as typeof fetch;
    await sendMessage(
      's1', 'hi', onDelta, onStep, onUsageInfo, onDone, onError,
      false, undefined, onTurnDone, undefined, onModeChanged,
      undefined, undefined, onElicitation, onAskUser,
    );
    expect(onDelta).toHaveBeenCalledWith('split');
  });

  // --- HTTP error handling ---

  it('calls onError when fetch returns non-OK status', async () => {
    globalThis.fetch = mockFetch(500, null, { error: 'server down' }) as unknown as typeof fetch;
    await sendMessage(
      's1', 'hi', onDelta, onStep, onUsageInfo, onDone, onError,
    );
    expect(onError).toHaveBeenCalledWith('server down');
    expect(onDelta).not.toHaveBeenCalled();
  });

  it('calls onError when response has no body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK', body: null,
      json: () => Promise.resolve({}),
    }) as unknown as typeof fetch;
    await sendMessage(
      's1', 'hi', onDelta, onStep, onUsageInfo, onDone, onError,
    );
    expect(onError).toHaveBeenCalledWith('No response body');
  });

  // --- fetch body construction ---

  it('sends attachments and agent_mode in the request body', async () => {
    const fetchSpy = mockFetch(200, mockStream([sseChunk('done', { message_id: 'm' })]));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    await sendMessage(
      's1', 'msg', onDelta, onStep, onUsageInfo, onDone, onError,
      true, undefined, undefined,
      [{ type: 'file' as const, path: '/a.txt' }],
      undefined, 'plan', false, undefined, undefined,
    );
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.content).toBe('msg');
    expect(body.is_new_session).toBe(true);
    expect(body.attachments).toEqual([{ type: 'file', path: '/a.txt' }]);
    expect(body.agent_mode).toBe('plan');
  });

  it('sends fleet flag in the request body', async () => {
    const fetchSpy = mockFetch(200, mockStream([sseChunk('done', { message_id: 'm' })]));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    await sendMessage(
      's1', 'msg', onDelta, onStep, onUsageInfo, onDone, onError,
      false, undefined, undefined, undefined, undefined, undefined, true,
    );
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.fleet).toBe(true);
  });

  // --- malformed JSON in SSE data ---

  it('silently ignores malformed JSON in SSE data lines', async () => {
    const encoder = new TextEncoder();
    const badEvent = `event: delta\ndata: {broken json\n\n`;
    const goodEvent = sseChunk('done', { message_id: 'ok' });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(badEvent + goodEvent));
        controller.close();
      },
    });
    globalThis.fetch = mockFetch(200, stream) as unknown as typeof fetch;
    await sendMessage(
      's1', 'hi', onDelta, onStep, onUsageInfo, onDone, onError,
    );
    // Should not throw; done event still fires
    expect(onDone).toHaveBeenCalledWith('ok', undefined);
    expect(onDelta).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SSE parsing — resumeResponseStream
// ---------------------------------------------------------------------------

describe('resumeResponseStream SSE parsing', () => {
  let onDelta: ReturnType<typeof vi.fn>;
  let onStep: ReturnType<typeof vi.fn>;
  let onDone: ReturnType<typeof vi.fn>;
  let onError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onDelta = vi.fn();
    onStep = vi.fn();
    onDone = vi.fn();
    onError = vi.fn();
  });

  it('dispatches delta, step, and done events', async () => {
    const stream = mockStream([
      sseChunk('delta', { content: 'resumed' }),
      sseChunk('step', { title: 'Resuming' }),
      sseChunk('done', {}),
    ]);
    globalThis.fetch = mockFetch(200, stream) as unknown as typeof fetch;
    await resumeResponseStream('s1', 0, 0, onDelta, onStep, onDone, onError);

    expect(onDelta).toHaveBeenCalledWith('resumed');
    expect(onStep).toHaveBeenCalledWith({ title: 'Resuming' });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('dispatches error events', async () => {
    const stream = mockStream([sseChunk('error', { error: 'timeout' })]);
    globalThis.fetch = mockFetch(200, stream) as unknown as typeof fetch;
    await resumeResponseStream('s1', 0, 0, onDelta, onStep, onDone, onError);
    expect(onError).toHaveBeenCalledWith('timeout');
  });

  it('calls onError on non-OK response', async () => {
    globalThis.fetch = mockFetch(500, null, { detail: 'session gone' }) as unknown as typeof fetch;
    await resumeResponseStream('s1', 0, 0, onDelta, onStep, onDone, onError);
    expect(onError).toHaveBeenCalledWith('session gone');
  });
});

// ---------------------------------------------------------------------------
// SSE parsing — subscribeToActiveAgents (from activeAgents.ts)
// ---------------------------------------------------------------------------
// Tested separately in activeAgents.test.ts
