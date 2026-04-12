import type { Session, SessionWithMessages, CreateSessionRequest, UpdateSessionRequest } from '../types/session';
import type { SessionsResponse } from '../types/api';

const API_BASE = '/api';

export interface ElicitationRequest {
  request_id: string;
  message: string;
  schema: Record<string, unknown>;
  source: string;
}

export interface AskUserRequest {
  request_id: string;
  question: string;
  choices?: string[] | null;
  allowFreeform: boolean;
}

export async function respondToElicitation(
  sessionId: string,
  requestId: string,
  action: 'accept' | 'decline' | 'cancel',
  content?: Record<string, unknown>,
): Promise<{ status: string; action: string }> {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/elicitation-response`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: requestId, action, content }),
  });
  if (!response.ok) {
    throw new Error(`Failed to respond to elicitation: ${response.statusText}`);
  }
  return response.json();
}

export async function respondToUserInput(
  sessionId: string,
  requestId: string,
  answer: string,
  wasFreeform: boolean,
  cancelled?: boolean,
): Promise<{ status: string }> {
  const body: Record<string, unknown> = { request_id: requestId };
  if (cancelled) {
    body.cancelled = true;
  } else {
    body.answer = answer;
    body.wasFreeform = wasFreeform;
  }
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/user-input-response`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Failed to respond to user input: ${response.statusText}`);
  }
  return response.json();
}

export async function createSession(request: CreateSessionRequest): Promise<Session> {
  const response = await fetch(`${API_BASE}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error('Failed to create session');
  }
  return response.json();
}

export async function listSessions(): Promise<Session[]> {
  const response = await fetch(`${API_BASE}/sessions`);
  if (!response.ok) {
    throw new Error('Failed to list sessions');
  }
  const data: SessionsResponse = await response.json();
  return data.sessions;
}

export async function getSession(sessionId: string): Promise<SessionWithMessages> {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}`);
  if (!response.ok) {
    throw new Error('Failed to get session');
  }
  return response.json();
}

export async function deleteSession(sessionId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete session');
  }
}

export async function updateSession(sessionId: string, request: UpdateSessionRequest): Promise<Session> {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error('Failed to update session');
  }
  return response.json();
}

export async function connectSession(sessionId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/connect`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error('Failed to connect session');
  }
}

export async function disconnectSession(sessionId: string): Promise<void> {
  await fetch(`${API_BASE}/sessions/${sessionId}/disconnect`, {
    method: 'POST',
  });
  // Ignore errors on disconnect (tab might be closing)
}

export async function setSessionMode(sessionId: string, mode: string): Promise<{ mode: string }> {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  if (!response.ok) {
    throw new Error(`Failed to set session mode: ${response.statusText}`);
  }
  return response.json();
}

export interface RuntimeSettings {
  mode?: string;
  model?: string;
  reasoning_effort?: string | null;
}

export async function updateRuntimeSettings(
  sessionId: string,
  settings: RuntimeSettings,
): Promise<RuntimeSettings> {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/runtime-settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    throw new Error(`Failed to update runtime settings: ${response.statusText}`);
  }
  return response.json();
}

// --- Slash Command APIs ---

export async function compactSession(sessionId: string): Promise<{ success: boolean; detail?: string; tokens_removed?: number }> {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/compact`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`Failed to compact session: ${response.statusText}`);
  }
  return response.json();
}

// --- Repo Agent APIs ---


export interface UploadedFile {
  path: string;
  originalName: string;
  size: number;
}

export async function uploadFile(file: File, sessionId: string): Promise<UploadedFile> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('session_id', sessionId);
  const response = await fetch(`${API_BASE}/sessions/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    throw new Error(`Upload failed: ${response.statusText}`);
  }
  return response.json();
}

export interface AttachmentRef {
  type: 'file';
  path: string;
  displayName?: string;
}

export async function sendMessage(
  sessionId: string,
  content: string,
  onDelta: (content: string) => void,
  onStep: (step: ChatStep) => void,
  onUsageInfo: (usage: { tokenLimit: number; currentTokens: number; messagesLength: number }) => void,
  onDone: (messageId: string, sessionName?: string) => void,
  onError: (error: string) => void,
  isNewSession: boolean = false,
  _onPendingMessages?: () => void,
  onTurnDone?: (messageId?: string) => void,
  attachments?: AttachmentRef[],
  onModeChanged?: (mode: string) => void,
  agentMode?: string,
  fleet?: boolean,
  onElicitation?: (data: ElicitationRequest) => void,
  onAskUser?: (data: AskUserRequest) => void,
): Promise<void> {
  const body: Record<string, unknown> = { content, is_new_session: isNewSession };
  if (attachments && attachments.length > 0) {
    body.attachments = attachments;
  }
  if (agentMode) {
    body.agent_mode = agentMode;
  }
  if (fleet) {
    body.fleet = true;
  }
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    onError(data.error || 'Failed to send message');
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    onError('No response body');
    return;
  }

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
        const lines = event.split(/\r?\n/);
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
        if (!eventData) continue;

        try {
          const data = JSON.parse(eventData);
          if (eventName === 'delta' && data.content !== undefined) {
            onDelta(data.content);
          } else if (eventName === 'step' && data.title) {
            onStep(data);
          } else if (eventName === 'usage_info' && data.tokenLimit !== undefined) {
            onUsageInfo(data);
          } else if (eventName === 'turn_done') {
            onTurnDone?.(data.messageId);
          } else if (eventName === 'done') {
            // message_id may be undefined for buffer-based responses
            // session_name is included when auto-naming kicks in
            onDone(data.message_id || '', data.session_name);
          } else if (eventName === 'error' && data.error !== undefined) {
            onError(data.error);
          } else if (eventName === 'mode_changed' && data.mode) {
            onModeChanged?.(data.mode);
          } else if (eventName === 'elicitation' && data.request_id) {
            onElicitation?.(data as ElicitationRequest);
          } else if (eventName === 'ask_user' && data.request_id) {
            onAskUser?.(data as AskUserRequest);
          }
        } catch (e) {
          console.error('Failed to parse SSE data:', eventData, e);
        }
      }
    }
    
    // Process any remaining buffer (best-effort)
    if (buffer.trim()) {
      const lines = buffer.split(/\r?\n/);
      let eventName = '';
      const dataLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith('event:')) eventName = line.replace(/^event:\s?/, '').trim();
        if (line.startsWith('data:')) dataLines.push(line.replace(/^data:\s?/, ''));
      }
      const eventData = dataLines.join('\n');
      if (eventData) {
        try {
          const data = JSON.parse(eventData);
          if (eventName === 'delta' && data.content !== undefined) onDelta(data.content);
          if (eventName === 'step' && data.title) onStep(data);
          if (eventName === 'turn_done') onTurnDone?.(data.messageId);
          if (eventName === 'done') onDone(data.message_id || '', data.session_name);
          if (eventName === 'elicitation' && data.request_id) onElicitation?.(data as ElicitationRequest);
          if (eventName === 'ask_user' && data.request_id) onAskUser?.(data as AskUserRequest);
        } catch {
          // ignore
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export interface ResponseStatus {
  active: boolean;
  status?: string;
  chunks_count?: number;
  steps_count?: number;
  error?: string | null;
}

/**
 * Enqueue a follow-up message while the agent is already running.
 * Returns immediately — the existing background task processes the queued message.
 */
export async function enqueueMessage(sessionId: string, content: string, attachments?: AttachmentRef[]): Promise<{ status: string; message_id: string }> {
  const body: Record<string, unknown> = { content };
  if (attachments && attachments.length > 0) {
    body.attachments = attachments;
  }
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/enqueue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || 'Failed to enqueue message');
  }
  return response.json();
}

/**
 * Abort the currently processing message in a session.
 * The session remains valid for new messages.
 */
export async function abortSession(sessionId: string): Promise<{ status: string }> {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/abort`, {
    method: 'POST',
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || 'Failed to abort session');
  }
  return response.json();
}

/**
 * Check if there's an active response being generated for a session.
 * Used to detect if agent is still running after reconnect.
 */
export async function getResponseStatus(sessionId: string): Promise<ResponseStatus> {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/response-status`);
  if (!response.ok) {
    return { active: false };
  }
  return response.json();
}

/**
 * Resume streaming a response that's still being generated.
 * Used when reconnecting to a session with an active agent.
 */
export async function resumeResponseStream(
  sessionId: string,
  fromChunk: number,
  fromStep: number,
  onDelta: (content: string) => void,
  onStep: (step: ChatStep) => void,
  onDone: () => void,
  onError: (error: string) => void,
): Promise<void> {
  const response = await fetch(
    `${API_BASE}/sessions/${sessionId}/response-stream?from_chunk=${fromChunk}&from_step=${fromStep}`
  );

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    onError(data.detail || 'Failed to resume stream');
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    onError('No response body');
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || '';

      for (const event of events) {
        const lines = event.split(/\r?\n/);
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
        if (!eventData) continue;

        try {
          const data = JSON.parse(eventData);
          if (eventName === 'delta' && data.content !== undefined) {
            onDelta(data.content);
          } else if (eventName === 'step' && data.title) {
            onStep(data);
          } else if (eventName === 'done') {
            onDone();
          } else if (eventName === 'error' && data.error !== undefined) {
            onError(data.error);
          }
        } catch (e) {
          console.error('Failed to parse SSE data:', eventData, e);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
