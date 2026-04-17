import { create } from 'zustand';

export interface AuthStatus {
  authenticated: boolean | null;
  provider?: string;
  username?: string;
}

interface AuthState {
  status: AuthStatus;
  setStatus: (status: AuthStatus) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: { authenticated: null },
  setStatus: (status) => set({ status }),
}));
