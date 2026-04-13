/**
 * Workflow definition store.
 * Manages workflow CRUD state for the Workflow Library and Editor.
 */

import { create } from 'zustand';
import type { WorkflowMetadata, WorkflowCreate, WorkflowUpdate } from '../types/workflow';
import * as workflowsApi from '../api/workflows';

interface WorkflowState {
  workflows: WorkflowMetadata[];
  loading: boolean;
  error: string | null;

  // Actions
  fetchWorkflows: () => Promise<void>;
  createWorkflow: (request: WorkflowCreate) => Promise<WorkflowMetadata>;
  updateWorkflow: (workflowId: string, request: WorkflowUpdate) => Promise<WorkflowMetadata>;
  deleteWorkflow: (workflowId: string) => Promise<void>;
  clearError: () => void;
}

export const useWorkflowStore = create<WorkflowState>((set) => ({
  workflows: [],
  loading: false,
  error: null,

  fetchWorkflows: async () => {
    set({ loading: true, error: null });
    try {
      const workflows = await workflowsApi.listWorkflows();
      set({ workflows, loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  createWorkflow: async (request) => {
    try {
      const workflow = await workflowsApi.createWorkflow(request);
      set((state) => ({ workflows: [...state.workflows, workflow] }));
      return workflow;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  },

  updateWorkflow: async (workflowId, request) => {
    try {
      const updated = await workflowsApi.updateWorkflow(workflowId, request);
      set((state) => ({
        workflows: state.workflows.map((w) => (w.id === workflowId ? updated : w)),
      }));
      return updated;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  },

  deleteWorkflow: async (workflowId) => {
    try {
      await workflowsApi.deleteWorkflow(workflowId);
      set((state) => ({
        workflows: state.workflows.filter((w) => w.id !== workflowId),
      }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  },

  clearError: () => set({ error: null }),
}));
