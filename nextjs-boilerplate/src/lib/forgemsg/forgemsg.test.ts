import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the RLS pool so emit/dispatch run against an in-memory query spy.
const query = vi.fn();
vi.mock('@/lib/db/rls-pool', () => ({
  db: () => ({ query }),
  runWithServiceContext: (fn: () => unknown) => fn(),
}));

import { splitName, emitForgeMsg } from './emit';
import { dispatchOutbox } from './dispatch';

beforeEach(() => {
  query.mockReset();
  vi.unstubAllGlobals();
});
afterEach(() => vi.unstubAllEnvs());

describe('splitName', () => {
  it('splits first/last, handles single + empty', () => {
    expect(splitName('Jan Novák')).toEqual({ firstName: 'Jan', lastName: 'Novák' });
    expect(splitName('Jan')).toEqual({ firstName: 'Jan' });
    expect(splitName('Jan van der Berg')).toEqual({ firstName: 'Jan', lastName: 'van der Berg' });
    expect(splitName(null)).toEqual({});
    expect(splitName('')).toEqual({});
  });
});

describe('emitForgeMsg', () => {
  it('inserts an outbox row with promoter + type + json payload', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await emitForgeMsg(
      { type: 'order_paid', contact: { email: 'a@b.cz' }, event: { externalId: 'e1' } },
      'promoter-1',
    );
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('INSERT INTO public.forgemsg_outbox');
    expect(params[0]).toBe('promoter-1');
    expect(params[1]).toBe('order_paid');
    expect(JSON.parse(params[2]).contact.email).toBe('a@b.cz');
  });

  it('null promoter when omitted', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await emitForgeMsg({ type: 'event_upsert', event: { externalId: 'e2' } });
    expect(query.mock.calls[0][1][0]).toBeNull();
  });
});

describe('dispatchOutbox', () => {
  it('marks rows sent on a 2xx and batches by promoter', async () => {
    vi.stubEnv('FORGEMSG_API_URL', 'https://fm.test');
    vi.stubEnv('FORGEMSG_API_KEY', 'platform-key');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal('fetch', fetchMock);

    query
      .mockResolvedValueOnce({
        rows: [
          { id: '1', promoter_id: null, event_type: 'order_paid', payload: { type: 'order_paid' } },
          { id: '2', promoter_id: null, event_type: 'cart_abandoned', payload: { type: 'cart_abandoned' } },
        ],
      }) // SELECT pending
      .mockResolvedValueOnce({ rows: [] }); // UPDATE sent

    const res = await dispatchOutbox();
    expect(res).toMatchObject({ picked: 2, sent: 2, failed: 0 });
    // one batched POST with both events + the platform key
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://fm.test/api/v1/ticketing/events/batch');
    expect(opts.headers['x-api-key']).toBe('platform-key');
    expect(JSON.parse(opts.body).events).toHaveLength(2);
  });

  it('keeps rows pending (retry) on a non-2xx', async () => {
    vi.stubEnv('FORGEMSG_API_URL', 'https://fm.test');
    vi.stubEnv('FORGEMSG_API_KEY', 'platform-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    query
      .mockResolvedValueOnce({ rows: [{ id: '1', promoter_id: null, event_type: 'order_paid', payload: {} }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE attempts++/failed

    const res = await dispatchOutbox();
    expect(res).toMatchObject({ picked: 1, sent: 0, failed: 1 });
    const updateSql = query.mock.calls[1][0];
    expect(updateSql).toContain('attempts = attempts + 1');
  });

  it('skips (leaves pending) when no credentials configured', async () => {
    vi.stubEnv('FORGEMSG_API_URL', '');
    vi.stubEnv('FORGEMSG_API_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    query.mockResolvedValueOnce({ rows: [{ id: '1', promoter_id: null, event_type: 'x', payload: {} }] });
    const res = await dispatchOutbox();
    expect(res).toMatchObject({ picked: 1, sent: 0, skipped: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no pending rows → no-op', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const res = await dispatchOutbox();
    expect(res.picked).toBe(0);
  });
});
