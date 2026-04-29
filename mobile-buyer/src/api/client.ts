import { API_BASE_URL, REQUEST_TIMEOUT_MS, RETRY_MAX_ATTEMPTS, RETRY_DELAY_MS } from '../lib/constants';
import type { ApiError } from '../types/api.types';

// Token provider — injected at runtime by auth store
let _getAccessToken: (() => string | null) | null = null;
let _onTokenExpired: (() => Promise<string | null>) | null = null;

export function configureClient(options: {
  getAccessToken: () => string | null;
  onTokenExpired: () => Promise<string | null>;
}) {
  _getAccessToken = options.getAccessToken;
  _onTokenExpired = options.onTokenExpired;
}

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(error: ApiError) {
    super(error.message);
    this.name = 'ApiClientError';
    this.status = error.status;
    this.code = error.code;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  skipAuth?: boolean;
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
  attempt = 0,
): Promise<T> {
  const { body, skipAuth = false, headers: extraHeaders, ...rest } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(extraHeaders as Record<string, string>),
  };

  if (!skipAuth && _getAccessToken) {
    const token = _getAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const url = `${API_BASE_URL}${path}`;
  const init: RequestInit = {
    ...rest,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };

  let response: Response;
  try {
    response = await fetchWithTimeout(url, init, REQUEST_TIMEOUT_MS);
  } catch (err: unknown) {
    // Network error or timeout
    if (attempt < RETRY_MAX_ATTEMPTS) {
      await sleep(RETRY_DELAY_MS);
      return request<T>(path, options, attempt + 1);
    }
    const message = err instanceof Error ? err.message : 'Network error';
    throw new ApiClientError({ code: 'NETWORK_ERROR', message, status: 0 });
  }

  // Handle 401 — try token refresh once
  if (response.status === 401 && !skipAuth && attempt === 0 && _onTokenExpired) {
    const newToken = await _onTokenExpired();
    if (newToken) {
      return request<T>(path, options, attempt + 1);
    }
    throw new ApiClientError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
      status: 401,
    });
  }

  // Retry on 5xx
  if (response.status >= 500 && attempt < RETRY_MAX_ATTEMPTS) {
    await sleep(RETRY_DELAY_MS);
    return request<T>(path, options, attempt + 1);
  }

  if (!response.ok) {
    let errorBody: Partial<ApiError> = {};
    try {
      errorBody = await response.json();
    } catch {
      // ignore parse errors
    }
    throw new ApiClientError({
      code: errorBody.code ?? 'API_ERROR',
      message: errorBody.message ?? `HTTP ${response.status}`,
      status: response.status,
    });
  }

  // 204 No Content
  if (response.status === 204) {
    return undefined as unknown as T;
  }

  return response.json() as Promise<T>;
}

export const apiClient = {
  get<T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
    return request<T>(path, { ...options, method: 'GET' });
  },
  post<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
    return request<T>(path, { ...options, method: 'POST', body });
  },
  put<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
    return request<T>(path, { ...options, method: 'PUT', body });
  },
  delete<T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
    return request<T>(path, { ...options, method: 'DELETE' });
  },
};
