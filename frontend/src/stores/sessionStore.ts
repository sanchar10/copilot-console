import { create } from 'zustand';
import type { Session } from '../types/session';
import type { MCPServer } from '../types/mcp';
import { listMCPServers } from '../api/mcp';
import type { AgentTools, SystemMessage } from '../types/agent';
import { getTools, type ToolInfo } from '../api/tools';
import { useTabStore } from './tabStore';

interface NewSessionSettings {
  name: string;
  model: string;
  reasoningEffort: string | null;
  cwd: string;
  mcpServers: string[];
  tools: AgentTools;
  systemMessage?: SystemMessage | null;
  agentId?: string;
  subAgents?: string[];
  agentMode: string;
}

interface SessionState {
  sessions: Session[];
  isNewSession: boolean; // True when in "new session" mode (not yet created)
  newSessionSettings: NewSessionSettings | null; // Pending settings for new session
  availableMcpServers: MCPServer[]; // All available MCP servers from config
  availableTools: ToolInfo[]; // All available local tools
  isLoading: boolean;
  error: string | null;

  setSessions: (sessions: Session[]) => void;
  addSession: (session: Session) => void;
  removeSession: (sessionId: string) => void;
  startNewSession: (defaultModel: string, defaultCwd: string) => Promise<void>;
  updateNewSessionSettings: (settings: Partial<NewSessionSettings>) => void;
  clearNewSession: () => void;
  moveSessionToTop: (sessionId: string) => void;
  updateSessionTimestamp: (sessionId: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setAvailableMcpServers: (servers: MCPServer[]) => void;
  setAvailableTools: (tools: ToolInfo[]) => void;
  updateSessionMcpServers: (sessionId: string, mcpServers: string[]) => void;
  updateSessionTools: (sessionId: string, tools: AgentTools) => void;
  updateSessionName: (sessionId: string, name: string) => void;
  refreshMcpServers: () => Promise<MCPServer[]>;
  refreshTools: () => Promise<ToolInfo[]>;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  isNewSession: false,
  newSessionSettings: null,
  availableMcpServers: [],
  availableTools: [],
  isLoading: false,
  error: null,

  setSessions: (sessions) => set({ sessions }),
  addSession: (session) =>
    set((state) => ({ 
      sessions: [session, ...state.sessions],
      isNewSession: false,
      newSessionSettings: null,
    })),
  removeSession: (sessionId) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.session_id !== sessionId),
    })),
  startNewSession: async (defaultModel, defaultCwd) => {
    // Refresh MCP servers and tools from disk when starting new session
    const state = useSessionStore.getState();
    const [servers, toolsConfig] = await Promise.all([
      state.refreshMcpServers(),
      state.refreshTools(),
    ]);
    // servers/toolsConfig refresh the store's available lists;
    // new sessions start with none selected
    void servers; void toolsConfig;
    
    // Default: no servers or custom tools selected, no builtin filter
    const defaultMcpServers: string[] = [];
    const defaultTools: AgentTools = { custom: [], builtin: [], excluded_builtin: [] };
    
    // Deactivate current tab so new-session view takes over
    useTabStore.setState({ activeTabId: null });
    
    set({ 
      isNewSession: true,
      newSessionSettings: {
        name: 'New Session',
        model: defaultModel,
        reasoningEffort: null,
        cwd: defaultCwd,
        mcpServers: defaultMcpServers,
        tools: defaultTools,
        agentMode: 'interactive',
      }
    });
  },
  updateNewSessionSettings: (settings) =>
    set((state) => ({
      newSessionSettings: state.newSessionSettings 
        ? { ...state.newSessionSettings, ...settings }
        : null,
    })),
  clearNewSession: () => set({ isNewSession: false, newSessionSettings: null }),
  moveSessionToTop: (sessionId) =>
    set((state) => {
      const session = state.sessions.find((s) => s.session_id === sessionId);
      if (!session) return state;
      return {
        sessions: [session, ...state.sessions.filter((s) => s.session_id !== sessionId)],
      };
    }),
  updateSessionTimestamp: (sessionId) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.session_id === sessionId
          ? { ...s, updated_at: new Date().toISOString() }
          : s
      ),
    })),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setAvailableMcpServers: (servers) => set({ availableMcpServers: servers }),
  setAvailableTools: (tools) => set({ availableTools: tools }),
  updateSessionMcpServers: (sessionId, mcpServers) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.session_id === sessionId
          ? { ...s, mcp_servers: mcpServers }
          : s
      ),
    })),
  updateSessionTools: (sessionId, tools) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.session_id === sessionId
          ? { ...s, tools }
          : s
      ),
    })),
  updateSessionName: (sessionId, name) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.session_id === sessionId
          ? { ...s, session_name: name }
          : s
      ),
    })),
  refreshMcpServers: async () => {
    try {
      const config = await listMCPServers();
      set({ availableMcpServers: config.servers });
      return config.servers;
    } catch (error) {
      console.error('Failed to refresh MCP servers:', error);
      return [];
    }
  },
  refreshTools: async () => {
    try {
      const config = await getTools();
      set({ availableTools: config.tools });
      return config.tools;
    } catch (error) {
      console.error('Failed to refresh tools:', error);
      return [];
    }
  },
}));
