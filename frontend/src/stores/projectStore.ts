import { create } from 'zustand';
import { fetchProjects, saveProject as apiSaveProject, type ProjectMapping } from '../api/projects';

/** Extract last folder segment from a path. */
function folderName(cwd: string): string {
  const normalized = cwd.replace(/\\/g, '/').replace(/\/+$/, '');
  const last = normalized.split('/').pop();
  return last || cwd;
}

interface ProjectState {
  /** User-defined cwd→name overrides (loaded from backend). */
  projects: ProjectMapping;
  /** Currently selected project filter (null = all). */
  selectedProject: string | null;

  /** Load overrides from backend. */
  loadProjects: () => Promise<void>;
  /** Save/update a project name. */
  setProject: (cwd: string, name: string) => Promise<void>;
  /** Remove a project name override. */
  removeProject: (cwd: string) => void;
  /** Set the sidebar project filter. */
  selectProject: (name: string | null) => void;

  /** Resolve a display name for a cwd (override → folder name). */
  getProjectName: (cwd: string) => string;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: {},
  selectedProject: localStorage.getItem('selectedProject') || null,

  loadProjects: async () => {
    try {
      const mapping = await fetchProjects();
      set({ projects: mapping });
    } catch {
      // Ignore — projects are optional
    }
  },

  setProject: async (cwd, name) => {
    // Optimistic update — UI reflects immediately
    set(state => ({ projects: { ...state.projects, [cwd]: name } }));
    try {
      await apiSaveProject(cwd, name);
    } catch {
      // Revert on failure
      get().loadProjects();
    }
  },

  removeProject: (cwd) => {
    set(state => {
      const { [cwd]: _, ...rest } = state.projects;
      // Also try normalized key removal
      const norm = cwd.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
      const filtered: ProjectMapping = {};
      for (const [k, v] of Object.entries(rest)) {
        if (k.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() !== norm) {
          filtered[k] = v;
        }
      }
      return { projects: filtered };
    });
  },

  selectProject: (name) => {
    set({ selectedProject: name });
    if (name) {
      localStorage.setItem('selectedProject', name);
    } else {
      localStorage.removeItem('selectedProject');
    }
  },

  getProjectName: (cwd) => {
    if (!cwd) return '';
    const { projects } = get();
    // Check overrides (case-insensitive normalized match)
    const norm = cwd.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    for (const [storedCwd, name] of Object.entries(projects)) {
      if (storedCwd.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === norm) {
        return name;
      }
    }
    return folderName(cwd);
  },
}));
