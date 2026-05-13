/**
 * #23 — Watchlist + notifikace
 *
 * Tests for WatchlistService CRUD methods (addToWatchlist, removeFromWatchlist,
 * getWatchlistForUser) and route-layer auth guards.
 *
 * notifyMatchingWatchers + watchlistMatchEmail are covered in the companion
 * file watchlist-notify.test.ts — no duplication here.
 *
 * Run: vitest src/__tests__/watchlist.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WatchlistService } from '../services/watchlist.service.js';
import type { DbAdapter, RedisAdapter, EventBusAdapter } from '../types/resale.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWatchlistRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wl-1',
    user_id: 'user-1',
    event_id: 'event-1',
    max_price: null,
    zone: null,
    notified_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

interface Mocks {
  db: DbAdapter;
  redis: RedisAdapter;
  eventBus: EventBusAdapter;
  dbQuery: ReturnType<typeof vi.fn>;
}

function makeMocks(): Mocks {
  const dbQuery = vi.fn().mockResolvedValue([]);

  const db = {
    query: dbQuery,
    transaction: vi.fn(),
  } as unknown as DbAdapter;

  const redis: RedisAdapter = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(undefined),
  };

  const eventBus: EventBusAdapter = {
    publish: vi.fn().mockResolvedValue(undefined),
  };

  return { db, redis, eventBus, dbQuery };
}

// ---------------------------------------------------------------------------
// addToWatchlist
// ---------------------------------------------------------------------------

describe('WatchlistService.addToWatchlist', () => {
  let m: Mocks;
  let svc: WatchlistService;

  beforeEach(() => {
    m = makeMocks();
    svc = new WatchlistService(m.db, m.redis, m.eventBus);
  });

  it('happy path: creates entry with eventId, maxPrice, zone — returns mapped WatchlistEntry', async () => {
    const row = makeWatchlistRow({
      id: 'wl-abc',
      user_id: 'u-1',
      event_id: 'ev-42',
      max_price: '15000',
      zone: 'VIP',
    });
    m.dbQuery.mockResolvedValueOnce([row]);

    const entry = await svc.addToWatchlist('u-1', 'ev-42', 15000, 'VIP');

    expect(entry.id).toBe('wl-abc');
    expect(entry.userId).toBe('u-1');
    expect(entry.eventId).toBe('ev-42');
    expect(entry.maxPrice).toBe(15000);
    expect(entry.zone).toBe('VIP');
    expect(entry.createdAt).toBeInstanceOf(Date);
  });

  it('passes correct SQL params: userId, eventId, maxPrice, zone', async () => {
    const row = makeWatchlistRow({ user_id: 'u-2', event_id: 'ev-99', max_price: '5000', zone: 'A' });
    m.dbQuery.mockResolvedValueOnce([row]);

    await svc.addToWatchlist('u-2', 'ev-99', 5000, 'A');

    expect(m.dbQuery).toHaveBeenCalledOnce();
    const [sql, params] = m.dbQuery.mock.calls[0];
    expect(sql).toContain('ON CONFLICT');
    expect(params).toEqual(['u-2', 'ev-99', 5000, 'A']);
  });

  it('idempotent: duplicate call (upsert) returns the updated row without throwing', async () => {
    // ON CONFLICT DO UPDATE — DB returns the upserted row both times
    const row = makeWatchlistRow({ id: 'wl-dup', event_id: 'ev-10', max_price: '20000' });
    m.dbQuery.mockResolvedValue([row]);

    const r1 = await svc.addToWatchlist('u-1', 'ev-10', 20000, undefined);
    const r2 = await svc.addToWatchlist('u-1', 'ev-10', 20000, undefined);

    expect(r1.id).toBe('wl-dup');
    expect(r2.id).toBe('wl-dup');
    expect(m.dbQuery).toHaveBeenCalledTimes(2);
  });

  it('stores null when maxPrice and zone are omitted', async () => {
    const row = makeWatchlistRow({ id: 'wl-bare', max_price: null, zone: null });
    m.dbQuery.mockResolvedValueOnce([row]);

    await svc.addToWatchlist('u-1', 'ev-1');

    const [, params] = m.dbQuery.mock.calls[0];
    expect(params[2]).toBeNull(); // maxPrice → null
    expect(params[3]).toBeNull(); // zone → null
  });

  it('maps null max_price from DB to null (not NaN)', async () => {
    const row = makeWatchlistRow({ max_price: null });
    m.dbQuery.mockResolvedValueOnce([row]);

    const entry = await svc.addToWatchlist('u-1', 'ev-1');
    expect(entry.maxPrice).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// removeFromWatchlist
// ---------------------------------------------------------------------------

describe('WatchlistService.removeFromWatchlist', () => {
  let m: Mocks;
  let svc: WatchlistService;

  beforeEach(() => {
    m = makeMocks();
    svc = new WatchlistService(m.db, m.redis, m.eventBus);
  });

  it('issues DELETE with correct watchlistId and userId', async () => {
    m.dbQuery.mockResolvedValueOnce([{ id: 'wl-1' }]); // row deleted

    await svc.removeFromWatchlist('u-1', 'wl-1');

    expect(m.dbQuery).toHaveBeenCalledOnce();
    const [sql, params] = m.dbQuery.mock.calls[0];
    expect(sql).toContain('DELETE FROM');
    expect(params).toEqual(['wl-1', 'u-1']);
  });

  it('does not throw when watchlist entry not found (idempotent)', async () => {
    m.dbQuery.mockResolvedValueOnce([]); // nothing deleted

    await expect(svc.removeFromWatchlist('u-1', 'wl-not-found')).resolves.toBeUndefined();
  });

  it('does not throw when entry belongs to a different user (silently ignores)', async () => {
    m.dbQuery.mockResolvedValueOnce([]); // WHERE user_id = $2 filtered it out

    await expect(svc.removeFromWatchlist('wrong-user', 'wl-1')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getWatchlistForUser (listUserWatchlists)
// ---------------------------------------------------------------------------

describe('WatchlistService.getWatchlistForUser', () => {
  let m: Mocks;
  let svc: WatchlistService;

  beforeEach(() => {
    m = makeMocks();
    svc = new WatchlistService(m.db, m.redis, m.eventBus);
  });

  it('returns only the entries for the queried user', async () => {
    const rows = [
      makeWatchlistRow({ id: 'wl-1', user_id: 'u-A', event_id: 'ev-1' }),
      makeWatchlistRow({ id: 'wl-2', user_id: 'u-A', event_id: 'ev-2' }),
    ];
    m.dbQuery.mockResolvedValueOnce(rows);

    const entries = await svc.getWatchlistForUser('u-A');

    expect(entries).toHaveLength(2);
    entries.forEach((e) => expect(e.userId).toBe('u-A'));
  });

  it('passes the userId as SQL param', async () => {
    m.dbQuery.mockResolvedValueOnce([]);

    await svc.getWatchlistForUser('u-XYZ');

    const [sql, params] = m.dbQuery.mock.calls[0];
    expect(sql).toContain('WHERE user_id = $1');
    expect(params).toEqual(['u-XYZ']);
  });

  it('returns empty array when user has no watchlist entries', async () => {
    m.dbQuery.mockResolvedValueOnce([]);

    const entries = await svc.getWatchlistForUser('u-empty');
    expect(entries).toEqual([]);
  });

  it('maps notified_at correctly from ISO string to Date', async () => {
    const iso = '2026-04-08T12:00:00.000Z';
    const row = makeWatchlistRow({ notified_at: iso });
    m.dbQuery.mockResolvedValueOnce([row]);

    const [entry] = await svc.getWatchlistForUser('u-1');
    expect(entry.notifiedAt).toBeInstanceOf(Date);
    expect(entry.notifiedAt!.toISOString()).toBe(iso);
  });

  it('maps notified_at = null correctly', async () => {
    m.dbQuery.mockResolvedValueOnce([makeWatchlistRow({ notified_at: null })]);

    const [entry] = await svc.getWatchlistForUser('u-1');
    expect(entry.notifiedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Route-layer: auth guard (x-user-id header required)
// ---------------------------------------------------------------------------

describe('GET /api/watchlist — auth guard', () => {
  it('returns 401 when x-user-id header is absent', async () => {
    const { GET } = await import('../app/api/watchlist/route.js');

    const req = new Request('http://localhost/api/watchlist', {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });

    const res = await GET(req as unknown as Parameters<typeof GET>[0]);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('UNAUTHORIZED');
  });
});

describe('POST /api/watchlist — validation', () => {
  it('returns 401 when x-user-id header is absent', async () => {
    const { POST } = await import('../app/api/watchlist/route.js');

    const req = new Request('http://localhost/api/watchlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventId: 'ev-1' }),
    });

    const res = await POST(req as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(401);
  });

  it('returns 400 when eventId is missing from body', async () => {
    const { POST } = await import('../app/api/watchlist/route.js');

    const req = new Request('http://localhost/api/watchlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': 'u-1' },
      body: JSON.stringify({ maxPrice: 500 }),
    });

    const res = await POST(req as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

describe('DELETE /api/watchlist/[watchlistId] — auth guard', () => {
  it('returns 401 when x-user-id header is absent', async () => {
    const { DELETE } = await import('../app/api/watchlist/[watchlistId]/route.js');

    const req = new Request('http://localhost/api/watchlist/wl-1', {
      method: 'DELETE',
    });

    const res = await DELETE(
      req as unknown as Parameters<typeof DELETE>[0],
      { params: { watchlistId: 'wl-1' } },
    );
    expect(res.status).toBe(401);
  });
});
