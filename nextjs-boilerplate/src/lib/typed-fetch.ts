/**
 * Typed fetch wrapper s volitelným Zod parse.
 *
 * Eliminuje `no-unsafe-*` warnings v 319 callsites kde `await res.json()`
 * vrací `any`. Místo:
 *
 *   const r = await authFetch('/api/x');
 *   const data = await r.json();   // any
 *   setRows(data.rows);            // unsafe-member-access
 *
 * píšeme:
 *
 *   const data = await typedFetch<{ rows: Row[] }>('/api/x');
 *   setRows(data.rows);            // safely typed
 *
 * S Zod schema (preferované při neznámém API):
 *
 *   const Schema = z.object({ rows: z.array(RowSchema) });
 *   const data = await typedFetch('/api/x', { schema: Schema });
 *
 * Auth header se přiloží automaticky z localStorage.accessToken (client-side)
 * pokud `auth: true` (default).
 */
import type { ZodTypeAny, z as ZodNamespace } from 'zod';

export type TypedFetchOptions<S extends ZodTypeAny | undefined = undefined> = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Request body — buď serializované, nebo objekt (auto JSON.stringify). */
  body?: BodyInit | Record<string, unknown>;
  /** Custom headers, doplňované přes default. */
  headers?: Record<string, string>;
  /** Pokud true (default), přiloží Authorization: Bearer z localStorage.accessToken */
  auth?: boolean;
  /** Volitelný Zod schema na response parsing. Pokud chybí, kód spoléhá na type generic. */
  schema?: S;
  /** Pokud true, vyhoď chybu místo undefined při 4xx/5xx (default false — vrať parsed body). */
  throwOnError?: boolean;
  /** AbortController signal */
  signal?: AbortSignal;
};

export class TypedFetchError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'TypedFetchError';
  }
}

function getAuthToken(): string | null {
  if (typeof globalThis === 'undefined') return null;
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls?.getItem('accessToken') ?? null;
  } catch {
    return null;
  }
}

export async function typedFetch<T = unknown, S extends ZodTypeAny | undefined = undefined>(
  url: string,
  options: TypedFetchOptions<S> = {},
): Promise<S extends ZodTypeAny ? ZodNamespace.infer<S> : T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers ?? {}),
  };

  const auth = options.auth !== false;
  if (auth) {
    const token = getAuthToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (
      typeof options.body === 'string' ||
      options.body instanceof FormData ||
      options.body instanceof URLSearchParams ||
      options.body instanceof Blob
    ) {
      body = options.body as BodyInit;
    } else {
      body = JSON.stringify(options.body);
    }
  }

  const res = await fetch(url, {
    method: options.method ?? (body ? 'POST' : 'GET'),
    headers,
    body,
    signal: options.signal,
  });

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    parsed = undefined;
  }

  if (!res.ok && options.throwOnError) {
    throw new TypedFetchError(
      `HTTP ${res.status} ${res.statusText} on ${url}`,
      res.status,
      parsed,
    );
  }

  if (options.schema) {
    // Zod validuje runtime — caller se může spoléhat, že shape odpovídá.
    const result = options.schema.safeParse(parsed);
    if (!result.success) {
      throw new TypedFetchError(
        `Response shape mismatch on ${url}: ${result.error.message}`,
        res.status,
        parsed,
      );
    }
    return result.data as ZodNamespace.infer<NonNullable<S>>;
  }

  // Bez schema: caller je zodpovědný za type assertion (přes generic T)
  return parsed as S extends ZodTypeAny ? ZodNamespace.infer<S> : T;
}

/**
 * Convenience wrapper pro klasický GET → JSON pattern.
 *
 * Příklad:
 *   const { events } = await typedGet<{ events: Event[] }>('/api/admin/events');
 */
export async function typedGet<T = unknown>(
  url: string,
  options?: Omit<TypedFetchOptions, 'method' | 'body'>,
): Promise<T> {
  return typedFetch<T>(url, { ...options, method: 'GET' });
}

/**
 * Convenience wrapper pro POST s JSON body.
 *
 * Příklad:
 *   const result = await typedPost<{ id: string }>('/api/admin/events', {
 *     title: 'Concert', dateStart: '...'
 *   });
 */
export async function typedPost<T = unknown>(
  url: string,
  body: Record<string, unknown>,
  options?: Omit<TypedFetchOptions, 'method' | 'body'>,
): Promise<T> {
  return typedFetch<T>(url, { ...options, method: 'POST', body });
}
