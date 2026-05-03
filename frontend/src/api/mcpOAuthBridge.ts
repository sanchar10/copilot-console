/**
 * Bridges MCP OAuth events from the global ``/events`` SSE channel into
 * toast UI. Imported once at app startup; subscribes for the lifetime
 * of the tab.
 *
 * Why this lives apart from per-turn streaming: OAuth events are
 * account-scoped (the auth flow is per server, not per session) and
 * routinely arrive AFTER the per-turn SSE has already closed (the
 * agent gives up on the failed tool in ~0.2s but ``oauth.login()``
 * round-trips in ~1s). Wiring them through the long-lived global
 * channel removes the race entirely — no polling, no grace periods.
 */

import { onEvent, openEventsChannel, type EventEnvelope } from './events';
import { useToastStore } from '../stores/toastStore';
import type {
  MCPOAuthRequiredEvent,
  MCPOAuthCompletedEvent,
  MCPOAuthFailedEvent,
} from './sessions';

function mcpOAuthToastId(serverName: string): string {
  // Auth is account-scoped (one set of tokens per server URL), so the
  // toast key is keyed on server name only — multiple sessions hitting
  // the same server share one toast.
  return `mcp-oauth:${serverName}`;
}

function surfaceRequired(evt: MCPOAuthRequiredEvent) {
  if (!evt.authorizationUrl) return;
  try {
    window.open(evt.authorizationUrl, '_blank', 'noopener,noreferrer');
  } catch {
    /* popup blocked — toast below is the fallback */
  }
  const toastId = mcpOAuthToastId(evt.serverName);
  useToastStore.getState().addToast(
    `${evt.serverName} needs sign-in`,
    'warning',
    {
      id: toastId,
      duration: 0,
      action: {
        label: 'Sign in',
        href: evt.authorizationUrl,
        onClick: () => {
          // The auth flow happens in another tab — replace the sticky
          // toast with a transient hint so the user knows we're now
          // waiting on them. The completed/failed event from the
          // global bus will replace this with the final state.
          useToastStore.getState().removeToast(toastId);
          useToastStore.getState().addToast(
            `Complete sign-in for ${evt.serverName} in the new tab.`,
            'info',
            6000,
          );
        },
      },
    },
  );
}

function surfaceCompleted(evt: MCPOAuthCompletedEvent) {
  // Id-keyed: replaces the sticky 'required'/'failed' toast for the same
  // server, so the user sees a single transition rather than a stack.
  useToastStore.getState().addToast(`${evt.serverName} signed in`, 'success', {
    id: mcpOAuthToastId(evt.serverName),
    duration: 4000,
  });
}

function surfaceFailed(evt: MCPOAuthFailedEvent) {
  // Sticky + id-keyed: collapses any duplicate 'failed' events from
  // backend retries into a single toast that the user must dismiss.
  // Backend backoff ought to prevent the dupes in the first place, but
  // this is defense-in-depth and also makes failures visible until
  // acknowledged (e.g. EACCES on the OAuth callback port).
  useToastStore.getState().addToast(
    `${evt.serverName} sign-in failed${evt.reason ? `: ${evt.reason}` : ''}`,
    'error',
    {
      id: mcpOAuthToastId(evt.serverName),
      duration: 0,
    },
  );
}

let initialized = false;

/** Open the global events channel and route MCP OAuth events to toasts. */
export function initMcpOAuthBridge(): void {
  if (initialized) return;
  initialized = true;
  openEventsChannel();
  onEvent<MCPOAuthRequiredEvent>('mcp_oauth_required', (env: EventEnvelope<MCPOAuthRequiredEvent>) => {
    surfaceRequired(env.data);
  });
  onEvent<MCPOAuthCompletedEvent>('mcp_oauth_completed', (env) => {
    surfaceCompleted(env.data);
  });
  onEvent<MCPOAuthFailedEvent>('mcp_oauth_failed', (env) => {
    surfaceFailed(env.data);
  });
}
