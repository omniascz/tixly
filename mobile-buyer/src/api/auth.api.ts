import { apiClient } from './client';
import type { User, AuthTokens } from '../types/api.types';

export interface LoginPayload {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: User;
  tokens: AuthTokens;
}

export interface RefreshResponse {
  tokens: AuthTokens;
}

export const authApi = {
  login(payload: LoginPayload): Promise<LoginResponse> {
    return apiClient.post<LoginResponse>('/api/auth/login', payload, { skipAuth: true });
  },

  refresh(refreshToken: string): Promise<RefreshResponse> {
    return apiClient.post<RefreshResponse>('/api/auth/refresh', { refreshToken }, { skipAuth: true });
  },

  logout(): Promise<void> {
    return apiClient.post<void>('/api/auth/logout');
  },

  getProfile(): Promise<User> {
    return apiClient.get<User>('/api/users/me');
  },

  registerPushToken(expoPushToken: string): Promise<void> {
    return apiClient.post<void>('/api/users/push-token', { token: expoPushToken });
  },
};
