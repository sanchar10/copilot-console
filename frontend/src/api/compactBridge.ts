/**
 * Bridges session compaction events from the global ``/events`` SSE channel
 * into the chat UI. Imported once at app startup; subscribes for the
 * lifetime of the tab.
 *
 * Phase 5: compaction lifecycle is fire-and-forget RPC. The SDK fires
 * ``session.compaction_*`` events on its session listener regardless of
 * trigger (manual ``/compact`` POST or SDK auto-compact); the backend
 * ``SessionClient`` bridges those into ``session.compaction`` envelopes on
 * the global event bus, with a follow-up ``session.usage_info`` envelope
 * after a successful compact for immediate token-bar refresh.
 */

import { onEvent, openEventsChannel, type EventEnvelope } from './events';
import { useChatStore } from '../stores/chatStore';

interface CompactionEvent {
  phase: 'start' | 'complete';
  success?: boolean;
  error?: string | null;
  tokens_removed?: number | null;
  messages_removed?: number | null;
  pre_compaction_tokens?: number | null;
  post_compaction_tokens?: number | null;
  checkpoint_number?: number | null;
}

interface UsageInfoEvent {
  tokenLimit?: number | null;
  currentTokens?: number | null;
  messagesLength?: number | null;
}

function pushSystemMessage(sessionId: string, content: string): void {
  useChatStore.getState().addMessage(sessionId, {
    id: `system-compact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'system',
    content,
    timestamp: new Date().toISOString(),
  });
}

function renderStart(sessionId: string): void {
  // Clear any "📦 Compact: queued" pending flag now that it's actually running.
  try {
    useChatStore.getState().setPendingCompact(sessionId, false);
  } catch {
    /* best-effort */
  }
  pushSystemMessage(
    sessionId,
    '⟳ Compacting context — Background compaction started — summarizing older messages to free context space. You can continue chatting.',
  );
}

function renderComplete(sessionId: string, evt: CompactionEvent): void {
  if (evt.success === false) {
    const detail = evt.error ? ` ${evt.error}` : '';
    pushSystemMessage(sessionId, `✗ Compaction failed —${detail || ' Compaction did not succeed.'}`);
    return;
  }
  // Note: SDK fields measure only the conversation-history segment, not the
  // full context window. The header token bar (fed by session.usage_info from
  // context_window) is the source of truth for total context size — we
  // intentionally avoid restating it here to prevent two competing numbers.
  const parts: string[] = ['Compaction completed successfully.'];
  if (evt.tokens_removed != null) {
    if (evt.pre_compaction_tokens) {
      const pct = Math.round((evt.tokens_removed / evt.pre_compaction_tokens) * 100);
      parts.push(`Freed ${evt.tokens_removed.toLocaleString()} tokens from history (${pct}% of compacted segment).`);
    } else {
      parts.push(`Freed ${evt.tokens_removed.toLocaleString()} tokens from history.`);
    }
  }
  if (evt.messages_removed != null && evt.post_compaction_tokens != null) {
    parts.push(`${evt.messages_removed} messages summarized into ${evt.post_compaction_tokens.toLocaleString()} tokens.`);
  } else if (evt.messages_removed != null) {
    parts.push(`${evt.messages_removed} messages summarized.`);
  }
  if (evt.checkpoint_number != null) {
    parts.push(`Checkpoint #${evt.checkpoint_number} saved.`);
  }
  pushSystemMessage(sessionId, `✓ Context compacted — ${parts.join(' ')}`);
}

function applyUsageInfo(sessionId: string, evt: UsageInfoEvent): void {
  if (evt.tokenLimit == null || evt.currentTokens == null) return;
  try {
    useChatStore.getState().setTokenUsage(sessionId, {
      tokenLimit: evt.tokenLimit,
      currentTokens: evt.currentTokens,
      messagesLength: evt.messagesLength ?? 0,
    });
  } catch {
    /* token-bar refresh is best-effort */
  }
}

let initialized = false;
export function initCompactBridge(): void {
  if (initialized) return;
  initialized = true;
  openEventsChannel();
  onEvent<CompactionEvent>('session.compaction', (env: EventEnvelope<CompactionEvent>) => {
    const sid = env.sessionId;
    if (!sid) return;
    if (env.data.phase === 'start') {
      renderStart(sid);
    } else if (env.data.phase === 'complete') {
      renderComplete(sid, env.data);
    }
  });
  onEvent<UsageInfoEvent>('session.usage_info', (env: EventEnvelope<UsageInfoEvent>) => {
    const sid = env.sessionId;
    if (!sid) return;
    applyUsageInfo(sid, env.data);
  });
}
