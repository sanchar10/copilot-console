import { useCallback } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { useChatStore } from '../stores/chatStore';
import { useViewedStore } from '../stores/viewedStore';
import { useTabStore, tabId } from '../stores/tabStore';
import { getSession, connectSession, disconnectSession, getResponseStatus, resumeResponseStream } from '../api/sessions';

/**
 * Hook for managing session lifecycle.
 */
export function useSession(sessionId: string | null) {
  const updateSessionTimestamp = useSessionStore((s) => s.updateSessionTimestamp);
  const { switchTab } = useTabStore();
  const { setMessages, appendStreamingContent, addStreamingStep, addMessage, setStreaming, finalizeStreaming } = useChatStore();
  const { setAgentActive, markViewed } = useViewedStore();

  const loadSession = useCallback(async (id: string) => {
    try {
      const session = await getSession(id);
      setMessages(id, session.messages);
      await connectSession(id);
      
      // Check if there's an active response being generated (agent still running)
      const status = await getResponseStatus(id);
      if (status.active) {

        setStreaming(id, true);
        setAgentActive(id, true);
        
        // Resume streaming from where we left off
        await resumeResponseStream(
          id,
          status.chunks_count || 0,
          status.steps_count || 0,
          (content) => appendStreamingContent(id, content),
          (step) => {
            if (step.title?.startsWith('⟳ Compacting') || step.title?.startsWith('✓ Context compacted') || step.title?.startsWith('✗ Compaction')) {
              const detail = step.detail ? ` — ${step.detail}` : '';
              addMessage(id, { id: `system-${Date.now()}`, role: 'system', content: `${step.title}${detail}`, timestamp: new Date().toISOString() });
            } else {
              addStreamingStep(id, step);
            }
          },
          () => {
            // On done - finalize without message ID (SDK already saved it)
            finalizeStreaming(id, '');
            setAgentActive(id, false);
            // Update the session timestamp in the store
            updateSessionTimestamp(id);
            // Mark as viewed since user is watching this session
            markViewed(id);
            // Refresh messages to get the saved response from SDK
            getSession(id).then(s => setMessages(id, s.messages)).catch(() => {});
          },
          (error) => {
            console.error('[Session] Resume stream error:', error);
            setStreaming(id, false);
            setAgentActive(id, false);
          },
          (data) => {
            const { setElicitation } = useChatStore.getState();
            setElicitation(id, data);
          },
        );
      }
      
      return session;
    } catch (err) {
      console.error('Failed to load session:', err);
      throw err;
    }
  }, [setMessages, appendStreamingContent, addStreamingStep, addMessage, setStreaming, finalizeStreaming, setAgentActive, markViewed, updateSessionTimestamp]);

  const switchSession = useCallback(async (newSessionId: string | null) => {
    // Disconnect current session
    if (sessionId) {
      await disconnectSession(sessionId).catch(() => {});
    }

    if (newSessionId) {
      await loadSession(newSessionId);
      switchTab(tabId.session(newSessionId));
    }
  }, [sessionId, switchTab, loadSession]);

  return { loadSession, switchSession };
}
