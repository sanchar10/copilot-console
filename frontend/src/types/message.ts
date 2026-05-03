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
  /** SDK event UUID for truncate/fork operations. */
  event_id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  steps?: ChatStep[];
  mode?: 'enqueue' | 'immediate';
  attachments?: MessageAttachment[];
  /**
   * Side-channel marker. Messages with `kind === 'help'` are rendered with a
   * distinct visual identity (amber ❓ avatar, "Help Agent" label, badge) to
   * make clear they are NOT part of the primary agent's conversation context.
   */
  kind?: 'help';
}

export interface StreamingMessage {
  id: string;
  role: 'assistant';
  content: string;
  isStreaming: boolean;
  steps?: ChatStep[];
}
