import { API_BASE_URL } from './config';
import { getToken, clearSession } from './session';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Autentizovaný JSON fetch na Tixly API (Bearer access token ze SecureStore). */
export async function apiFetch<T>(
  path: string,
  init: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const { method = 'GET', body, auth = true } = init;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Nelze se připojit k serveru.');
  }

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* prázdná/non-JSON odpověď */
  }

  if (res.status === 401) {
    await clearSession();
    throw new ApiError(401, 'UNAUTHORIZED', 'Přihlášení vypršelo.');
  }
  if (!res.ok) {
    const j = (json ?? {}) as { error?: string; message?: string; result?: string };
    throw new ApiError(res.status, j.error ?? j.result ?? 'ERROR', j.message ?? j.error ?? `Chyba ${res.status}`);
  }
  return json as T;
}
