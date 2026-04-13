/**
 * Automation store.
 * Manages automation state for the Sidebar count and Automation Manager.
 */

import { create } from 'zustand';
import type { AutomationWithNextRun } from '../types/automation';
import { listAutomations } from '../api/automations';

interface AutomationState {
  automations: AutomationWithNextRun[];
  loading: boolean;
  error: string | null;

  fetchAutomations: () => Promise<void>;
  setAutomations: (automations: AutomationWithNextRun[]) => void;
  clearError: () => void;
}

export const useAutomationStore = create<AutomationState>((set) => ({
  automations: [],
  loading: false,
  error: null,

  fetchAutomations: async () => {
    set({ loading: true, error: null });
    try {
      const automations = await listAutomations();
      set({ automations, loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  setAutomations: (automations) => set({ automations }),

  clearError: () => set({ error: null }),
}));
