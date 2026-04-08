import { create } from 'zustand';
import type { Model } from '../api/models';

interface UIState {
  isSidebarCollapsed: boolean;
  isSettingsModalOpen: boolean;
  availableModels: Model[];
  defaultModel: string;
  defaultReasoningEffort: string | null;
  defaultCwd: string;
  searchHighlightTerm: string | null;

  toggleSidebar: () => void;
  openSettingsModal: () => void;
  closeSettingsModal: () => void;
  setAvailableModels: (models: Model[]) => void;
  setDefaultModel: (model: string) => void;
  setDefaultReasoningEffort: (effort: string | null) => void;
  setDefaultCwd: (cwd: string) => void;
  setSearchHighlight: (term: string | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  isSidebarCollapsed: false,
  isSettingsModalOpen: false,
  availableModels: [],
  defaultModel: 'gpt-4.1',
  defaultReasoningEffort: null,
  defaultCwd: '',
  searchHighlightTerm: null,

  toggleSidebar: () =>
    set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),
  openSettingsModal: () => set({ isSettingsModalOpen: true }),
  closeSettingsModal: () => set({ isSettingsModalOpen: false }),
  setAvailableModels: (models) => set({ availableModels: models }),
  setDefaultModel: (model) => set({ defaultModel: model }),
  setDefaultReasoningEffort: (effort) => set({ defaultReasoningEffort: effort }),
  setDefaultCwd: (cwd) => set({ defaultCwd: cwd }),
  setSearchHighlight: (term) => set({ searchHighlightTerm: term }),
}));
