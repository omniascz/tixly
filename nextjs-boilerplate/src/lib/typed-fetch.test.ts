// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { typedFetch, typedGet, typedPost, TypedFetchError } from './typed-fetch';

const fetchMock = vi.fn();

beforeEach(() => {
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockReset();
  // jsdom localStorage isolated per test
  if (typeof window !== 'undefined') window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('typedFetch', () => {
  it('returns generic-typed body on 200', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'evt-1', title: 'Foo' }), { status: 200 }),
    );
    const r = await typedFetch<{ id: string; title: string }>('/api/x');
    expect(r.id).toBe('evt-1');
    expect(r.title).toBe('Foo');
  });

  it('validates with Zod schema', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ rows: [{ id: 1 }, { id: 2 }] }), { status: 200 }),
    );
    const Schema = z.object({ rows: z.array(z.object({ id: z.number() })) });
    const r = await typedFetch('/api/y', { schema: Schema });
    expect(r.rows.length).toBe(2);
    expect(r.rows[0].id).toBe(1);
  });

  it('throws TypedFetchError on schema mismatch', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ rows: 'not-an-array' }), { status: 200 }),
    );
    const Schema = z.object({ rows: z.array(z.object({ id: z.number() })) });
    await expect(typedFetch('/api/z', { schema: Schema })).rejects.toThrow(TypedFetchError);
  });

  it('attaches Bearer token from localStorage by default', async () => {
    // jsdom localStorage v tomto projektu nefunguje (test isolation issue),
    // proto stub-neme přímo window.localStorage
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
    });
    store.set('accessToken', 'tok-123');
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await typedFetch('/api/x');
    const callInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect((callInit.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
    vi.unstubAllGlobals();
  });

  it('skips auth header when auth=false', async () => {
    const store = new Map<string, string>([['accessToken', 'tok-skip']]);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: () => undefined,
      removeItem: () => undefined,
      clear: () => store.clear(),
    });
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await typedFetch('/api/public', { auth: false });
    const callInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect((callInit.headers as Record<string, string>).Authorization).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('serializes object body as JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await typedFetch('/api/x', { method: 'POST', body: { foo: 'bar', n: 42 } });
    const callInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(callInit.method).toBe('POST');
    expect(callInit.body).toBe('{"foo":"bar","n":42}');
  });

  it('throws on 4xx with throwOnError', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'NOT_FOUND' }), { status: 404 }),
    );
    await expect(typedFetch('/api/missing', { throwOnError: true })).rejects.toThrow(
      TypedFetchError,
    );
  });

  it('returns parsed body on 4xx without throwOnError', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'BAD' }), { status: 400 }),
    );
    const r = await typedFetch<{ error: string }>('/api/bad');
    expect(r.error).toBe('BAD');
  });
});

describe('typedGet / typedPost', () => {
  it('typedGet calls with method GET', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await typedGet('/api/list');
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('GET');
  });

  it('typedPost calls with method POST + JSON body', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"ok":true}', { status: 201 }));
    const r = await typedPost<{ ok: boolean }>('/api/create', { name: 'X' });
    const callInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(callInit.method).toBe('POST');
    expect(callInit.body).toBe('{"name":"X"}');
    expect(r.ok).toBe(true);
  });
});
