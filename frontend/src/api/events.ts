/**
 * Long-lived global SSE channel client.
 *
 * One ``EventSource`` per browser tab, opened on app mount. Carries
 * events that out-live a single chat turn — primarily MCP OAuth
 * (``mcp_oauth_required`` / ``mcp_oauth_completed`` / ``mcp_oauth_failed``)
 * and MCP status changes. Per-turn streaming continues to live on
 * ``/sessions/{id}/messages`` and is unrelated to this module.
 *
 * The browser handles ``Last-Event-ID`` automatically across reconnects
 * once the server has emitted ``id:`` lines, so missed events are
 * replayed transparently from the server's ring buffer. If the gap is
 * larger than the buffer, the server emits a synthetic ``replay_gap``
 * event that subscribers can listen for to resync their state.
 *
 * HMR-safe: a single module-level ``EventSource`` is reused across hot
 * reloads via ``import.meta.hot.dispose`` so handlers don't accumulate.
 */

const EVENTS_URL = '/api/events';

export interface EventEnvelope<T = unknown> {
  id: number;
  type: string;
  ts: number;
  sessionId: string | null;
  data: T;
}

type Handler = (env: EventEnvelope) => void;

interface EventChannel {
  source: EventSource | null;
  handlers: Map<string, Set<Handler>>;
  /** Handlers that fire for every event, regardless of type. */
  wildcard: Set<Handler>;
  /** Names of event types we've already wired into the EventSource. */
  wired: Set<string>;
  /** Reconnect attempt counter; resets on successful open. */
  reconnectAttempts: number;
  /** Pending reconnect timer (window.setTimeout id). */
  reconnectTimer: number | null;
}

declare global {
  interface Window {
    __copilotEventChannel?: EventChannel;
  }
}

function getChannel(): EventChannel {
  if (typeof window === 'undefined') {
    return {
      source: null, handlers: new Map(), wildcard: new Set(), wired: new Set(),
      reconnectAttempts: 0, reconnectTimer: null,
    };
  }
  if (!window.__copilotEventChannel) {
    window.__copilotEventChannel = {
      source: null,
      handlers: new Map(),
      wildcard: new Set(),
      wired: new Set(),
      reconnectAttempts: 0,
      reconnectTimer: null,
    };
  }
  return window.__copilotEventChannel;
}

/** Schedule a reconnect with exponential backoff (capped at 30s). */
function scheduleReconnect(channel: EventChannel): void {
  if (typeof window === 'undefined') return;
  if (channel.reconnectTimer !== null) return; // already pending
  const attempt = channel.reconnectAttempts + 1;
  channel.reconnectAttempts = attempt;
  const delay = Math.min(30_000, 500 * 2 ** Math.min(attempt - 1, 6));
  channel.reconnectTimer = window.setTimeout(() => {
    channel.reconnectTimer = null;
    ensureSource(channel);
  }, delay);
}

function parseEnvelope(raw: string): EventEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as EventEnvelope;
    if (typeof parsed === 'object' && parsed && typeof parsed.type === 'string') {
      return parsed;
    }
  } catch {
    /* malformed payload — drop quietly */
  }
  return null;
}

function dispatchToType(channel: EventChannel, env: EventEnvelope): void {
  const subs = channel.handlers.get(env.type);
  if (subs) {
    for (const h of subs) {
      try { h(env); } catch (e) { console.error(`event handler for "${env.type}" threw:`, e); }
    }
  }
  for (const h of channel.wildcard) {
    try { h(env); } catch (e) { console.error('wildcard event handler threw:', e); }
  }
}

function ensureWired(channel: EventChannel, type: string): void {
  if (!channel.source || channel.wired.has(type)) return;
  channel.source.addEventListener(type, (msgEvt: MessageEvent) => {
    const env = parseEnvelope(msgEvt.data);
    if (!env) return;
    dispatchToType(channel, env);
  });
  channel.wired.add(type);
}

function ensureSource(channel: EventChannel): void {
  if (typeof window === 'undefined') return;
  if (channel.source && channel.source.readyState !== EventSource.CLOSED) return;

  // Drop any stale closed source before opening a new one.
  if (channel.source) {
    try { channel.source.close(); } catch { /* noop */ }
    channel.source = null;
  }

  const src = new EventSource(EVENTS_URL);
  channel.source = src;
  channel.wired.clear();

  // Wire any pre-existing typed subscribers onto the new source.
  for (const type of channel.handlers.keys()) {
    ensureWired(channel, type);
  }

  // Default ``message`` event covers anything sent without an ``event:`` field.
  src.addEventListener('message', (msgEvt: MessageEvent) => {
    const env = parseEnvelope(msgEvt.data);
    if (env) dispatchToType(channel, env);
  });

  src.addEventListener('open', () => {
    channel.reconnectAttempts = 0;
  });

  src.addEventListener('error', () => {
    // The browser auto-reconnects EventSource for *transient* network
    // errors using the last-seen id. But when the server returns a
    // non-200 response (e.g. a 502 during a Vite/backend restart), the
    // browser permanently closes the connection and never retries.
    // Detect that case and reopen ourselves with backoff.
    if (src.readyState === EventSource.CLOSED) {
      console.warn('events: SSE channel closed; scheduling reconnect');
      // Drop reference so ensureSource recreates it.
      if (channel.source === src) channel.source = null;
      scheduleReconnect(channel);
    }
    // CONNECTING (0) is a normal native auto-reconnect — leave it alone.
  });
}

/** Open the global events channel. Idempotent — safe to call from many mount points. */
export function openEventsChannel(): void {
  ensureSource(getChannel());
}

/** Subscribe to events of ``type``. Returns an unsubscribe function. */
export function onEvent<T = unknown>(
  type: string,
  handler: (env: EventEnvelope<T>) => void,
): () => void {
  const channel = getChannel();
  let set = channel.handlers.get(type);
  if (!set) {
    set = new Set();
    channel.handlers.set(type, set);
  }
  set.add(handler as Handler);
  ensureSource(channel);
  ensureWired(channel, type);
  return () => {
    const s = channel.handlers.get(type);
    if (s) {
      s.delete(handler as Handler);
      if (s.size === 0) channel.handlers.delete(type);
    }
  };
}

/** Subscribe to every event, regardless of type. Returns an unsubscribe function. */
export function onAnyEvent(handler: (env: EventEnvelope) => void): () => void {
  const channel = getChannel();
  channel.wildcard.add(handler);
  ensureSource(channel);
  return () => { channel.wildcard.delete(handler); };
}

/** Test/HMR helper — close the channel and clear all subscriptions. */
export function closeEventsChannel(): void {
  const channel = getChannel();
  if (channel.source) {
    channel.source.close();
    channel.source = null;
  }
  channel.wired.clear();
}

// HMR cleanup: when this module is replaced, drop the EventSource and
// schedule an immediate reopen so handlers (which live on ``window`` and
// survive the dispose) attach to a fresh stream. Without this, a hot
// reload of events.ts would leave the channel permanently dead.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    const channel = getChannel();
    if (channel.source) {
      try { channel.source.close(); } catch { /* noop */ }
      channel.source = null;
      channel.wired.clear();
    }
    if (channel.reconnectTimer !== null) {
      window.clearTimeout(channel.reconnectTimer);
      channel.reconnectTimer = null;
    }
    channel.reconnectAttempts = 0;
    // Reopen on next tick so the new module instance owns the source.
    window.setTimeout(() => ensureSource(getChannel()), 0);
  });
}
