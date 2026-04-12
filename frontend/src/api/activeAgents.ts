/**
 * API for monitoring active agent sessions.
 */

import { parseSSEStream } from '../utils/sseParser';

const API_BASE = '/api';

export interface ActiveAgentSession {
  session_id: string;
  status: string;
  chunks_count: number;
  steps_count: number;
  started_at: string | null;
  content_length?: number;
  content_tail?: string;
  current_step?: {
    title: string;
    status: string;
    [key: string]: unknown;
  };
}

export interface ActiveAgentsUpdate {
  count: number;
  sessions: ActiveAgentSession[];
}

/**
 * Get a snapshot of all active agent sessions.
 */
export async function getActiveAgents(): Promise<ActiveAgentsUpdate> {
  const response = await fetch(`${API_BASE}/sessions/active-agents`);
  if (!response.ok) {
    throw new Error('Failed to fetch active agents');
  }
  return response.json();
}

/** Max delay between reconnection attempts (30 seconds). */
const MAX_RECONNECT_DELAY_MS = 30_000;
/** Base delay for exponential backoff (1 second). */
const BASE_RECONNECT_DELAY_MS = 1_000;

/**
 * Subscribe to live updates of active agent sessions.
 * Automatically reconnects with exponential backoff on connection loss.
 * Returns an AbortController to stop the subscription.
 */
export function subscribeToActiveAgents(
  onUpdate: (data: ActiveAgentsUpdate) => void,
  onCompleted: (sessionId: string, updatedAt?: number) => void,
  onError: (error: string) => void
): AbortController {
  const controller = new AbortController();
  let attempt = 0;

  const connect = async () => {
    try {
      const response = await fetch(`${API_BASE}/sessions/active-agents/stream`, {
        signal: controller.signal,
      });
      
      if (!response.ok) {
        onError('Failed to connect to active agents stream');
        scheduleReconnect();
        return;
      }
      
      const reader = response.body?.getReader();
      if (!reader) {
        onError('No response body');
        scheduleReconnect();
        return;
      }

      // Connection succeeded — reset backoff
      attempt = 0;

      await parseSSEStream(reader, (eventName, data: any) => {
        if (eventName === 'update') {
          onUpdate(data);
        } else if (eventName === 'completed') {
          onCompleted(data.session_id, data.updated_at);
        }
      });

      // Stream ended normally — reconnect to keep listening
      scheduleReconnect();
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        return; // Normal cancellation
      }
      onError(e instanceof Error ? e.message : 'Unknown error');
      scheduleReconnect();
    }
  };

  const scheduleReconnect = () => {
    if (controller.signal.aborted) return;
    const delay = Math.min(BASE_RECONNECT_DELAY_MS * 2 ** attempt, MAX_RECONNECT_DELAY_MS);
    attempt++;
    setTimeout(() => {
      if (!controller.signal.aborted) connect();
    }, delay);
  };
  
  connect();
  return controller;
}
