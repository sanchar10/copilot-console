import { create } from 'zustand';
import type { Session } from '../types/session';
import type { MCPServer } from '../types/mcp';
import { listMCPServers, getMCPSettings } from '../api/mcp';
import type { AgentTools, SystemMessage } from '../types/agent';
import { getTools, type ToolInfo } from '../api/tools';
import { listSessions } from '../api/sessions';
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
  pendingCompact?: boolean;
  selectedAgent?: string;      // Agent to select on first message
  pendingAgent?: string;       // DEPRECATED: kept for backward compat, prefer selectedAgent
}

interface SessionState {
  sessions: Session[];
  isNewSession: boolean; // True when in "new session" mode (not yet created)
  newSessionSettings: NewSessionSettings | null; // Pending settings for new session
  availableMcpServers: MCPServer[]; // All available MCP servers from config
  /** Cached mcp_auto_enable map (server name -> enabled). Hydrated at app
   *  startup; written by MCPServersTab after every successful PATCH so the
   *  next new-session selector reflects the latest user choice without a
   *  refetch. */
  mcpAutoEnable: Record<string, boolean>;
  availableTools: ToolInfo[]; // All available local tools
  isLoading: boolean;
  error: string | null;

  setSessions: (sessions: Session[]) => void;
  addSession: (session: Session) => void;
  removeSession: (sessionId: string) => void;
  startNewSession: (defaultModel: string, defaultCwd: string, defaultReasoningEffort?: string | null) => Promise<void>;
  updateNewSessionSettings: (settings: Partial<NewSessionSettings>) => void;
  clearNewSession: () => void;
  moveSessionToTop: (sessionId: string) => void;
  updateSessionTimestamp: (sessionId: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setAvailableMcpServers: (servers: MCPServer[]) => void;
  /** Insert or replace a server in ``availableMcpServers`` (matched by name).
   *  Used after a successful CRUD create/update so the dropdown reflects the
   *  new state without a full refetch. */
  upsertAvailableMcpServer: (server: MCPServer) => void;
  /** Remove a server from ``availableMcpServers`` by name. Used after a
   *  successful CRUD delete. */
  removeAvailableMcpServer: (name: string) => void;
  setAvailableTools: (tools: ToolInfo[]) => void;
  updateSessionMcpServers: (sessionId: string, mcpServers: string[]) => void;
  updateSessionTools: (sessionId: string, tools: AgentTools) => void;
  updateSessionName: (sessionId: string, name: string) => void;
  updateSessionModel: (sessionId: string, model: string, reasoningEffort: string | null) => void;
  updateSessionField: (sessionId: string, field: keyof Session, value: unknown) => void;
  refreshMcpServers: () => Promise<MCPServer[]>;
  refreshMcpAutoEnable: () => Promise<Record<string, boolean>>;
  setMcpAutoEnable: (map: Record<string, boolean>) => void;
  refreshTools: () => Promise<ToolInfo[]>;
  clearError: () => void;
  fetchSessions: () => Promise<void>;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  isNewSession: false,
  newSessionSettings: null,
  availableMcpServers: [],
  mcpAutoEnable: {},
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
  startNewSession: async (defaultModel, defaultCwd, defaultReasoningEffort) => {
    // Refresh MCP servers and tools from disk when starting new session
    const state = useSessionStore.getState();
    const [servers, toolsConfig] = await Promise.all([
      state.refreshMcpServers(),
      state.refreshTools(),
    ]);
    void toolsConfig;

    // Default MCP selection = mcp_auto_enable ∩ available servers (uses cached
    // auto-enable map; do not refetch here).
    const autoEnable = useSessionStore.getState().mcpAutoEnable;
    const enabledNames = new Set(
      Object.entries(autoEnable).filter(([, on]) => on).map(([name]) => name)
    );
    const defaultMcpServers: string[] = servers
      .map((s) => s.name)
      .filter((name) => enabledNames.has(name));

    // Default tools: no custom selected, no builtin filter
    const defaultTools: AgentTools = { custom: [], builtin: [], excluded_builtin: [] };
    
    // Deactivate current tab so new-session view takes over
    useTabStore.setState({ activeTabId: null });
    
    set({ 
      isNewSession: true,
      newSessionSettings: {
        name: 'New Session',
        model: defaultModel,
        reasoningEffort: defaultReasoningEffort ?? null,
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
  upsertAvailableMcpServer: (server) =>
    set((state) => {
      const idx = state.availableMcpServers.findIndex((s) => s.name === server.name);
      if (idx === -1) {
        return { availableMcpServers: [...state.availableMcpServers, server] };
      }
      const next = state.availableMcpServers.slice();
      next[idx] = server;
      return { availableMcpServers: next };
    }),
  removeAvailableMcpServer: (name) =>
    set((state) => ({
      availableMcpServers: state.availableMcpServers.filter((s) => s.name !== name),
    })),
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
  updateSessionModel: (sessionId: string, model: string, reasoningEffort: string | null) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.session_id === sessionId
          ? { ...s, model, reasoning_effort: reasoningEffort }
          : s
      ),
    })),
  updateSessionField: (sessionId: string, field: keyof Session, value: unknown) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.session_id === sessionId
          ? { ...s, [field]: value }
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
  refreshMcpAutoEnable: async () => {
    try {
      const settings = await getMCPSettings();
      const map = settings.mcp_auto_enable ?? {};
      set({ mcpAutoEnable: map });
      return map;
    } catch (error) {
      console.error('Failed to refresh MCP auto-enable settings:', error);
      return {};
    }
  },
  setMcpAutoEnable: (map) => set({ mcpAutoEnable: map }),
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

  clearError: () => set({ error: null }),

  fetchSessions: async () => {
    set({ isLoading: true, error: null });
    try {
      const sessions = await listSessions();
      set({ sessions, isLoading: false });
    } catch (e) {
      set({ error: (e as Error).message, isLoading: false });
    }
  },
}));
