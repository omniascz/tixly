// ---------------------------------------------------------------------------
// Auth Zustand store
// ---------------------------------------------------------------------------
import { create } from "zustand";

interface AuthState {
  deviceToken: string | null;
  operatorName: string | null;
  isAuthenticated: boolean;

  // Actions
  setCredentials: (deviceToken: string, operatorName: string) => void;
  clearCredentials: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  deviceToken: null,
  operatorName: null,
  isAuthenticated: false,

  setCredentials: (deviceToken, operatorName) =>
    set({ deviceToken, operatorName, isAuthenticated: true }),

  clearCredentials: () =>
    set({ deviceToken: null, operatorName: null, isAuthenticated: false }),
}));
