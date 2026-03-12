export interface ChatStep {
  title: string;
  detail?: string;
}

export interface MessageAttachment {
  type: string;
  path?: string;
  displayName?: string;
}

export interface Message {
  id: string;
  /** Durable SDK anchor when available (used for pins/permalinks). */
  sdk_message_id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  steps?: ChatStep[];
  mode?: 'enqueue' | 'immediate';
  attachments?: MessageAttachment[];
}

export interface StreamingMessage {
  id: string;
  role: 'assistant';
  content: string;
  isStreaming: boolean;
  steps?: ChatStep[];
}
