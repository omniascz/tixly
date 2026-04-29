import { create } from 'zustand';
import type { User, AuthTokens } from '../types/api.types';
import { SECURE_STORE_KEYS } from '../lib/constants';

// SecureStore is loaded lazily so the store can be unit-tested without RN env
async function secureGet(key: string): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SecureStore = require('expo-secure-store');
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function secureSet(key: string, value: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SecureStore = require('expo-secure-store');
    await SecureStore.setItemAsync(key, value);
  } catch {
    // ignore in test/non-RN environments
  }
}

async function secureDelete(key: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SecureStore = require('expo-secure-store');
    await SecureStore.deleteItemAsync(key);
  } catch {
    // ignore
  }
}

export interface AuthState {
  user: User | null;
  tokens: AuthTokens | null;
  isLoading: boolean;

  // Actions
  login: (user: User, tokens: AuthTokens) => Promise<void>;
  logout: () => Promise<void>;
  setTokens: (tokens: AuthTokens) => Promise<void>;
  getAccessToken: () => string | null;
  loadFromStorage: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  tokens: null,
  isLoading: false,

  login: async (user, tokens) => {
    set({ user, tokens });
    await secureSet(SECURE_STORE_KEYS.AUTH_TOKENS, JSON.stringify(tokens));
  },

  logout: async () => {
    set({ user: null, tokens: null });
    await secureDelete(SECURE_STORE_KEYS.AUTH_TOKENS);
  },

  setTokens: async (tokens) => {
    set({ tokens });
    await secureSet(SECURE_STORE_KEYS.AUTH_TOKENS, JSON.stringify(tokens));
  },

  getAccessToken: () => {
    return get().tokens?.accessToken ?? null;
  },

  loadFromStorage: async () => {
    set({ isLoading: true });
    try {
      const raw = await secureGet(SECURE_STORE_KEYS.AUTH_TOKENS);
      if (raw) {
        const tokens: AuthTokens = JSON.parse(raw);
        set({ tokens });
      }
    } catch {
      // corrupted storage — clear it
      await secureDelete(SECURE_STORE_KEYS.AUTH_TOKENS);
    } finally {
      set({ isLoading: false });
    }
  },
}));
