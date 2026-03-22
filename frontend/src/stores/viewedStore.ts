import { create } from 'zustand';
import { getViewedTimestamps, markSessionViewed as apiMarkViewed } from '../api/viewed';
import { getActiveAgents } from '../api/activeAgents';

interface ViewedState {
  // Map of sessionId -> Unix timestamp (seconds) when last viewed
  lastViewed: Record<string, number>;
  // Set of session IDs with actively running agents
  activeAgents: Set<string>;
  // Loading state
  isLoaded: boolean;

  // Load timestamps from backend (called on app init)
  loadViewedTimestamps: () => Promise<void>;
  
  // Load active agents from backend (called on app init)
  loadActiveAgents: () => Promise<void>;
  
  // Mark a session as viewed (updates memory + calls API)
  markViewed: (sessionId: string) => void;
  
  // Check if session has unread content
  hasUnread: (sessionId: string, sessionUpdatedAt: string, sessionCreatedAt?: string) => boolean;
  
  // Track active agents
  setAgentActive: (sessionId: string, active: boolean) => void;
  setActiveAgentIds: (ids: Set<string>) => void;
  isAgentActive: (sessionId: string) => boolean;
}

export const useViewedStore = create<ViewedState>((set, get) => ({
  lastViewed: {},
  activeAgents: new Set(),
  isLoaded: false,

  loadViewedTimestamps: async () => {
    try {
      const timestamps = await getViewedTimestamps();
      set({ lastViewed: timestamps, isLoaded: true });
    } catch (error) {
      console.error('[ViewedStore] Failed to load viewed timestamps:', error);
      set({ isLoaded: true }); // Still mark as loaded so UI doesn't wait forever
    }
  },

  loadActiveAgents: async () => {
    try {
      const data = await getActiveAgents();
      const activeIds = new Set(data.sessions.map(s => s.session_id));
      set({ activeAgents: activeIds });
    } catch (error) {
      console.error('[ViewedStore] Failed to load active agents:', error);
    }
  },

  markViewed: (sessionId: string) => {
    const now = Date.now() / 1000; // Convert to Unix timestamp (seconds)
    set((state) => ({
      lastViewed: { ...state.lastViewed, [sessionId]: now },
    }));
    // Fire-and-forget API call
    apiMarkViewed(sessionId);
  },

  hasUnread: (sessionId: string, sessionUpdatedAt: string, sessionCreatedAt?: string) => {
    const state = get();
    
    if (!state.isLoaded) {
      return false;
    }
    
    const lastViewed = state.lastViewed[sessionId];
    const updatedAtSeconds = new Date(sessionUpdatedAt).getTime() / 1000;
    
    // If never viewed, check if session has activity since creation
    if (!lastViewed) {
      if (!sessionCreatedAt) return false;
      const createdAtSeconds = new Date(sessionCreatedAt).getTime() / 1000;
      return updatedAtSeconds > createdAtSeconds + 1;
    }
    
    // Has unread if updated after last viewed
    return updatedAtSeconds > lastViewed;
  },

  setAgentActive: (sessionId: string, active: boolean) => {
    set((state) => {
      const newActiveAgents = new Set(state.activeAgents);
      if (active) {
        newActiveAgents.add(sessionId);
      } else {
        newActiveAgents.delete(sessionId);
      }
      return { activeAgents: newActiveAgents };
    });
  },

  setActiveAgentIds: (ids: Set<string>) => {
    set({ activeAgents: ids });
  },

  isAgentActive: (sessionId: string) => {
    return get().activeAgents.has(sessionId);
  },
}));
