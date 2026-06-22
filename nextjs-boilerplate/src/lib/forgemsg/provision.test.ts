import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const query = vi.fn();
vi.mock('@/lib/db/rls-pool', () => ({
  db: () => ({ query }),
  runWithServiceContext: (fn: () => unknown) => fn(),
}));

import { provisionPromoter } from './provision';

beforeEach(() => {
  query.mockReset();
  vi.unstubAllGlobals();
  vi.stubEnv('FORGEMSG_API_URL', 'https://fm.test');
  vi.stubEnv('FORGEMSG_PARTNER_SECRET', 'secret');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('provisionPromoter', () => {
  it('skips when credentials already exist', async () => {
    query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // existing creds
    const res = await provisionPromoter('p1');
    expect(res.status).toBe('skipped');
  });

  it('provisions, maps SR→SK, and upserts the returned key', async () => {
    query
      .mockResolvedValueOnce({ rows: [] }) // no existing creds
      .mockResolvedValueOnce({ rows: [{ name: 'Divadlo X', country: 'SR' }] }) // promoter
      .mockResolvedValueOnce({ rows: [] }); // upsert creds
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { apiKey: 'fm_live_abc', orgId: 'o1' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await provisionPromoter('p1');
    expect(res.status).toBe('provisioned');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ externalId: 'p1', name: 'Divadlo X', country: 'SK' });
    expect(fetchMock.mock.calls[0][1].headers['x-partner-secret']).toBe('secret');
    // last query is the credentials upsert with the returned key
    const upsert = query.mock.calls.at(-1);
    expect(upsert[0]).toContain('INSERT INTO public.forgemsg_credentials');
    expect(upsert[1]).toEqual(['p1', 'fm_live_abc', 'https://fm.test']);
  });

  it('fails gracefully on a non-2xx from ForgeMsg', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ name: 'X', country: 'CZ' }] });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const res = await provisionPromoter('p1');
    expect(res.status).toBe('failed');
    expect(res.error).toContain('401');
  });

  it('fails when env not configured', async () => {
    vi.stubEnv('FORGEMSG_PARTNER_SECRET', '');
    const res = await provisionPromoter('p1');
    expect(res.status).toBe('failed');
  });
});
