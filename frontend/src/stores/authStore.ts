import { create } from 'zustand';

export interface AuthStatus {
  authenticated: boolean;
  provider?: string;
  username?: string;
}

interface AuthState {
  status: AuthStatus;
  setStatus: (status: AuthStatus) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: { authenticated: false },
  setStatus: (status) => set({ status }),
}));
