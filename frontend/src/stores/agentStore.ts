/**
 * Agent definition store.
 * Manages agent CRUD state for the Agent Library and Editor.
 */

import { create } from 'zustand';
import type { Agent, CreateAgentRequest, UpdateAgentRequest } from '../types/agent';
import * as agentsApi from '../api/agents';

interface AgentState {
  agents: Agent[];
  loading: boolean;
  error: string | null;

  // Actions
  fetchAgents: () => Promise<void>;
  createAgent: (request: CreateAgentRequest) => Promise<Agent>;
  updateAgent: (agentId: string, request: UpdateAgentRequest) => Promise<Agent>;
  deleteAgent: (agentId: string) => Promise<void>;
  clearError: () => void;
}

export const useAgentStore = create<AgentState>((set, _get) => ({
  agents: [],
  loading: false,
  error: null,

  fetchAgents: async () => {
    set({ loading: true, error: null });
    try {
      const agents = await agentsApi.listAgents();
      set({ agents, loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  createAgent: async (request) => {
    try {
      const agent = await agentsApi.createAgent(request);
      set((state) => ({ agents: [...state.agents, agent] }));
      return agent;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  },

  updateAgent: async (agentId, request) => {
    try {
      const updated = await agentsApi.updateAgent(agentId, request);
      set((state) => ({
        agents: state.agents.map((a) => (a.id === agentId ? updated : a)),
      }));
      return updated;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  },

  deleteAgent: async (agentId) => {
    try {
      await agentsApi.deleteAgent(agentId);
      set((state) => ({
        agents: state.agents.filter((a) => a.id !== agentId),
      }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  },

  clearError: () => set({ error: null }),
}));
