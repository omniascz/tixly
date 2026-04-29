import { create } from 'zustand';
import { User, AuthTokens } from '@/types/index';

interface AuthState {
  user: User | null;
  tokens: AuthTokens | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  setUser: (user: User | null) => void;
  setTokens: (tokens: AuthTokens | null) => void;
  setLoading: (loading: boolean) => void;
  login: (user: User, tokens: AuthTokens) => void;
  logout: () => void;
  refresh: (tokens: AuthTokens) => void;
  hydrate: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  tokens: null,
  isLoading: true,
  isAuthenticated: false,
  setUser: (user) => {
    set({ user, isAuthenticated: user !== null });
  },
  setTokens: (tokens) => {
    set({ tokens });
    if (tokens) {
      typeof window !== 'undefined' &&
        localStorage.setItem('accessToken', tokens.accessToken);
      typeof window !== 'undefined' &&
        localStorage.setItem('refreshToken', tokens.refreshToken);
    } else {
      typeof window !== 'undefined' && localStorage.removeItem('accessToken');
      typeof window !== 'undefined' && localStorage.removeItem('refreshToken');
    }
  },
  setLoading: (loading) => {
    set({ isLoading: loading });
  },
  login: (user, tokens) => {
    set({ user, tokens, isAuthenticated: true });
    typeof window !== 'undefined' &&
      localStorage.setItem('accessToken', tokens.accessToken);
    typeof window !== 'undefined' &&
      localStorage.setItem('refreshToken', tokens.refreshToken);
  },
  logout: () => {
    set({ user: null, tokens: null, isAuthenticated: false });
    typeof window !== 'undefined' && localStorage.removeItem('accessToken');
    typeof window !== 'undefined' && localStorage.removeItem('refreshToken');
  },
  refresh: (tokens) => {
    set({ tokens });
    typeof window !== 'undefined' &&
      localStorage.setItem('accessToken', tokens.accessToken);
    typeof window !== 'undefined' &&
      localStorage.setItem('refreshToken', tokens.refreshToken);
  },
  hydrate: () => {
    const accessToken =
      typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    const refreshToken =
      typeof window !== 'undefined' ? localStorage.getItem('refreshToken') : null;

    if (accessToken && refreshToken) {
      set({
        tokens: {
          accessToken,
          refreshToken,
          expiresIn: 3600,
        },
        isLoading: false,
      });
    } else {
      set({ isLoading: false });
    }
  },
}));
