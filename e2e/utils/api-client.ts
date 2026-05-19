/**
 * Thin API client wrapper for E2E smoke tests.
 * Uses fetch directly (Node.js 18+ built-in).
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? 'test-admin-token';

export interface ApiResponse<T = unknown> {
  status: number;
  ok: boolean;
  data: T;
}

async function request<T>(
  method: string,
  path: string,
  options: {
    body?: unknown;
    headers?: Record<string, string>;
    token?: string;
  } = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else if (!('x-user-id' in (options.headers ?? {}))) {
    // Default fallback jen pokud test nevyplnil explicit override (= '' = bez auth)
    headers['x-user-id'] = ADMIN_TOKEN;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let data: T;
  try {
    data = await response.json() as T;
  } catch {
    data = {} as T;
  }

  return {
    status: response.status,
    ok: response.ok,
    data,
  };
}

export const api = {
  get: <T>(path: string, opts?: Parameters<typeof request>[2]) =>
    request<T>('GET', path, opts),
  post: <T>(path: string, body?: unknown, opts?: Parameters<typeof request>[2]) =>
    request<T>('POST', path, { ...opts, body }),
  patch: <T>(path: string, body?: unknown, opts?: Parameters<typeof request>[2]) =>
    request<T>('PATCH', path, { ...opts, body }),
  delete: <T>(path: string, opts?: Parameters<typeof request>[2]) =>
    request<T>('DELETE', path, opts),
};
