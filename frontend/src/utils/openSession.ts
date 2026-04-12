/**
 * Shared session-opening logic.
 *
 * Extracted from SessionItem so that SearchModal (and any future caller)
 * can open a session tab with the full flow: MCP merge, session adoption,
 * streaming resume, viewed tracking, and error handling.
 */

import { useSessionStore } from '../stores/sessionStore';
import { useChatStore } from '../stores/chatStore';
import { useViewedStore } from '../stores/viewedStore';
import { useTabStore, tabId } from '../stores/tabStore';
import { getSession, connectSession, getResponseStatus, resumeResponseStream } from '../api/sessions';
import { markSessionReady } from '../components/chat/InputBox';
import type { Session } from '../types/session';

/**
 * Open a session tab with full initialization.
 *
 * Replicates the exact flow from SessionItem's click handler:
 * 1. Refresh & merge MCP servers
 * 2. Open tab
 * 3. Load messages via SDK (getSession)
 * 4. Update session store with adopted metadata
 * 5. Check/resume active streaming response
 * 6. Mark viewed
 */
export async function openSessionTab(session: Session): Promise<void> {
  const sessionId = session.session_id;
  const sessionTabId = tabId.session(sessionId);

  const { refreshMcpServers, updateSessionMcpServers, setSessions, updateSessionTimestamp, clearNewSession } = useSessionStore.getState();
  const { messagesPerSession, setMessages, setStreaming, appendStreamingContent, addStreamingStep, finalizeStreaming } = useChatStore.getState();
  const { setAgentActive } = useViewedStore.getState();
  const { openTab } = useTabStore.getState();

  // Clear new-session mode when switching to an existing session
  clearNewSession();

  // Always refresh MCP servers from disk when opening a session
  const freshServers = await refreshMcpServers();

  // Helper to merge MCP servers — keep saved selections that still exist, add new servers
  const mergeMcpServers = (savedSelections: string[] | undefined) => {
    const freshNames = new Set(freshServers.map(s => s.name));
    if (savedSelections !== undefined && savedSelections !== null) {
      // User has configured selections (may be empty = chose none)
      return savedSelections.filter(name => freshNames.has(name));
    }
    // Never configured — default to all servers enabled
    return freshServers.map(s => s.name);
  };

  // Helper to check and resume active response stream
  const checkAndResumeActiveResponse = async () => {
    try {
      await connectSession(sessionId);
      const status = await getResponseStatus(sessionId);

      if (status.active) {

        setStreaming(sessionId, true);
        setAgentActive(sessionId, true);
        // Session is active — mark ready so next message skips "Activating session"
        markSessionReady(sessionId);

        // Restore pending ask_user/elicitation card if present
        if (status.pending_input) {
          const evt = status.pending_input;
          if (evt.event === 'ask_user') {
            useChatStore.getState().setAskUser(sessionId, evt.data);
          } else if (evt.event === 'elicitation') {
            useChatStore.getState().setElicitation(sessionId, evt.data);
          }
        }

        // Resume streaming from where we left off
        await resumeResponseStream(
          sessionId,
          status.chunks_count || 0,
          status.steps_count || 0,
          (content) => appendStreamingContent(sessionId, content),
          (step) => addStreamingStep(sessionId, step),
          () => {
            // On done
            finalizeStreaming(sessionId, '');
            setAgentActive(sessionId, false);
            updateSessionTimestamp(sessionId);
            // Refresh messages to get the saved response from SDK
            getSession(sessionId).then(s => setMessages(sessionId, s.messages)).catch(() => {});
          },
          (error) => {
            console.error('[openSessionTab] Resume stream error:', error);
            setStreaming(sessionId, false);
            setAgentActive(sessionId, false);
          },
        );
        return true; // Active response found and resumed
      }

      // No active response — clear any stale ask_user/elicitation from memory
      useChatStore.getState().clearAskUser(sessionId);
      return false; // No active response
    } catch (err) {
      console.error('Failed to check response status:', err);
      return false;
    }
  };

  // If already cached, just open tab but check for active response
  if (messagesPerSession[sessionId]) {
    const mergedSelections = mergeMcpServers(session.mcp_servers);
    updateSessionMcpServers(sessionId, mergedSelections);
    openTab({ id: sessionTabId, type: 'session', label: session.session_name, sessionId });

    // Check if there's an active response we need to resume
    await checkAndResumeActiveResponse();
    return;
  }

  // Open tab immediately for visual feedback, then load in background
  openTab({ id: sessionTabId, type: 'session', label: session.session_name, sessionId });

  try {
    // Load session with messages
    const sessionData = await getSession(sessionId);
    setMessages(sessionId, sessionData.messages);

    const mergedSelections = mergeMcpServers(sessionData.mcp_servers);

    // Update session in store with adopted data (cwd, model, name, mcp_servers)
    const currentSessions = useSessionStore.getState().sessions;
    setSessions(currentSessions.map(s =>
      s.session_id === sessionId
        ? { ...s, cwd: sessionData.cwd, model: sessionData.model, session_name: sessionData.session_name, mcp_servers: mergedSelections }
        : s
    ));

    // Check if there's an active response we need to resume
    await checkAndResumeActiveResponse();
  } catch (err) {
    console.error('Failed to load session:', err);
    setMessages(sessionId, [{
      id: 'error',
      role: 'assistant',
      content: `⚠️ Could not load this session.\n\nError: ${err instanceof Error ? err.message : String(err)}`,
      timestamp: new Date().toISOString(),
    }]);
  }
}
