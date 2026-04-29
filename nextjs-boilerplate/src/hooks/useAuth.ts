import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { LoginCredentials, RegisterCredentials, User, AuthTokens } from '@/types/index';
import api from '@/lib/api';

interface UseAuthReturn {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (credentials: LoginCredentials) => Promise<User>;
  logout: () => Promise<void>;
  register: (credentials: RegisterCredentials) => Promise<User>;
  refresh: () => Promise<AuthTokens>;
}

export const useAuth = (): UseAuthReturn => {
  const { user, isLoading, isAuthenticated, setUser, setLoading, login: storeLogin, logout: storeLogout, refresh: storeRefresh, hydrate } = useAuthStore();
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      hydrate();
      setIsHydrated(true);
    }
  }, [hydrate]);

  const login = useCallback(
    async (credentials: LoginCredentials): Promise<User> => {
      setLoading(true);
      try {
        const response = await api.post('/api/auth/login', credentials);
        const { user: responseUser, tokens } = response.data.data;

        storeLogin(responseUser, tokens);
        setUser(responseUser);

        return responseUser;
      } catch (error) {
        setLoading(false);
        throw error;
      }
    },
    [setLoading, storeLogin, setUser]
  );

  const logout = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      await api.post('/api/auth/logout');
      storeLogout();
      setUser(null);
    } catch (error) {
      storeLogout();
      setUser(null);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [setLoading, storeLogout, setUser]);

  const register = useCallback(
    async (credentials: RegisterCredentials): Promise<User> => {
      setLoading(true);
      try {
        const response = await api.post('/api/auth/register', credentials);
        const { user: responseUser, tokens } = response.data.data;

        storeLogin(responseUser, tokens);
        setUser(responseUser);

        return responseUser;
      } catch (error) {
        setLoading(false);
        throw error;
      }
    },
    [setLoading, storeLogin, setUser]
  );

  const refresh = useCallback(async (): Promise<AuthTokens> => {
    try {
      const response = await api.post('/api/auth/refresh');
      const tokens = response.data.data;

      storeRefresh(tokens);

      return tokens;
    } catch (error) {
      storeLogout();
      throw error;
    }
  }, [storeRefresh, storeLogout]);

  return {
    user,
    isLoading: isLoading && !isHydrated,
    isAuthenticated,
    login,
    logout,
    register,
    refresh,
  };
};
