/**
 * MCP OAuth control endpoints — currently just the "retrigger" call used by
 * the Sign-in badge in the chat-header MCP picker.
 */

const API_BASE = '/api';

/**
 * Cancel any in-flight OAuth flow for ``serverName`` in ``sessionId`` and
 * start a fresh one. Resolves once the backend has accepted the request
 * (the actual auth URL arrives asynchronously on the global event bus as
 * an ``mcp_oauth_required`` event, which the existing bridge already
 * routes to a toast + auto-opens the browser tab).
 *
 * Throws if the session is unknown (404) or has no OAuth coordinator yet
 * (409 — cold session, no message sent yet).
 */
export async function retriggerMcpOAuth(
  sessionId: string,
  serverName: string,
): Promise<{ status: string; serverName: string }> {
  const url = `${API_BASE}/mcp/sessions/${encodeURIComponent(sessionId)}/${encodeURIComponent(serverName)}/oauth-retrigger`;
  const response = await fetch(url, { method: 'POST' });
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.detail ?? '';
    } catch {
      /* non-JSON body */
    }
    throw new Error(detail || `OAuth retrigger failed (${response.status})`);
  }
  return response.json();
}
