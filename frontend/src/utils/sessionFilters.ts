/**
 * Sidebar / related-sessions / mobile-list filter:
 * hide sessions that were not started by the user from a chat tab.
 *
 * - trigger === 'automation' — created by Automations (TaskBoard)
 * - trigger === 'workflow'   — created by a Workflow run on the user's behalf
 * - trigger === 'help'       — backing session for /help (in-app docs Q&A)
 *
 * All three are reachable from their own UI surfaces (TaskBoard,
 * WorkflowRunView, /help) so they would only pollute the sidebar.
 */
import type { Session } from '../types/session';

export function isUserSession(s: { trigger?: string | null }): boolean {
  return s.trigger !== 'automation' && s.trigger !== 'workflow' && s.trigger !== 'help';
}

// Re-export for callers that pass a full Session and want type narrowing.
export type { Session };
