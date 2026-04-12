/**
 * Shared SSE (Server-Sent Events) stream parser.
 *
 * Eliminates the 3× copy-paste SSE parsing logic across
 * api/sessions.ts and api/activeAgents.ts.
 */

export interface SSEEvent {
  event: string;
  data: unknown;
}

export type SSEEventHandler = (event: string, data: unknown) => void;

/**
 * Parse an SSE stream from a ReadableStreamDefaultReader,
 * dispatching each parsed event to the handler.
 *
 * Handles:
 * - Multi-line `data:` fields
 * - Both LF and CRLF line endings
 * - Trailing buffer flush on stream end
 */
export async function parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: SSEEventHandler,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line; handle both LF and CRLF
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || '';

      for (const event of events) {
        dispatchSSEBlock(event, onEvent);
      }
    }

    // Flush remaining buffer (best-effort)
    if (buffer.trim()) {
      dispatchSSEBlock(buffer, onEvent);
    }
  } finally {
    reader.releaseLock();
  }
}

/** Parse a single SSE text block into event name + JSON data, then dispatch. */
function dispatchSSEBlock(block: string, onEvent: SSEEventHandler): void {
  const lines = block.split(/\r?\n/);
  let eventName = '';
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventName = line.replace(/^event:\s?/, '').trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.replace(/^data:\s?/, ''));
    }
  }

  const eventData = dataLines.join('\n');
  if (!eventData) return;

  try {
    const data = JSON.parse(eventData);
    onEvent(eventName, data);
  } catch (e) {
    console.error('Failed to parse SSE data:', eventData, e);
  }
}
