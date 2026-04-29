import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WatchlistService } from '../services/watchlist.service.js';
import { watchlistMatchEmail } from '../lib/watchlist-emails.js';
import type {
  ResaleListing,
  DbAdapter,
  RedisAdapter,
  EventBusAdapter,
} from '../types/resale.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeListing(overrides: Partial<ResaleListing> = {}): ResaleListing {
  return {
    id: 'listing-1',
    ticketId: 'ticket-1',
    sellerId: 'seller-1',
    buyerId: null,
    askPrice: 15000,
    originalPrice: 20000,
    commissionRate: 0.05,
    status: 'active',
    escrowStatus: 'none',
    gopayPaymentId: null,
    listedAt: new Date(),
    expiresAt: null,
    reservedUntil: null,
    soldAt: null,
    cancelledAt: null,
    payoutAmount: null,
    payoutAt: null,
    payoutRetryCount: 0,
    manualReview: false,
    ...overrides,
  };
}

interface WatchlistRowInput {
  id: string;
  user_id: string;
  event_id: string;
  max_price: string | null;
  zone: string | null;
}

function makeRow(o: Partial<WatchlistRowInput> & { id: string }): WatchlistRowInput & {
  notified_at: null;
  created_at: string;
} {
  return {
    user_id: 'u-' + o.id,
    event_id: 'event-1',
    max_price: null,
    zone: null,
    notified_at: null,
    created_at: new Date().toISOString(),
    ...o,
  };
}

interface Mocks {
  db: DbAdapter;
  redis: RedisAdapter;
  eventBus: EventBusAdapter;
  selectRows: ReturnType<typeof vi.fn>;
  updateSpy: ReturnType<typeof vi.fn>;
  redisGet: ReturnType<typeof vi.fn>;
  redisSet: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
}

function makeMocks(): Mocks {
  const selectRows = vi.fn().mockResolvedValue([]);
  const updateSpy = vi.fn().mockResolvedValue([]);
  const redisGet = vi.fn().mockResolvedValue(null);
  const redisSet = vi.fn().mockResolvedValue(undefined);
  const publish = vi.fn().mockResolvedValue(undefined);

  const db = {
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      if (/^\s*SELECT/i.test(sql)) return selectRows(sql, _params);
      if (/^\s*UPDATE/i.test(sql)) return updateSpy(sql, _params);
      return [];
    }),
    transaction: vi.fn(),
  } as unknown as DbAdapter;

  const redis: RedisAdapter = {
    get: redisGet,
    set: redisSet,
    del: vi.fn(),
  };

  const eventBus: EventBusAdapter = { publish };

  return { db, redis, eventBus, selectRows, updateSpy, redisGet, redisSet, publish };
}

// ---------------------------------------------------------------------------
// notifyMatchingWatchers — matching rules
// ---------------------------------------------------------------------------

describe('WatchlistService.notifyMatchingWatchers — matching', () => {
  let m: Mocks;
  let svc: WatchlistService;

  beforeEach(() => {
    m = makeMocks();
    svc = new WatchlistService(m.db, m.redis, m.eventBus);
  });

  it('zone NULL in watchlist matches any zone in listing', async () => {
    m.selectRows.mockResolvedValueOnce([makeRow({ id: 'w1', zone: null })]);
    const res = await svc.notifyMatchingWatchers(makeListing(), 'event-1', 'A');
    expect(res).toEqual({ matched: 1, notified: 1, throttled: 0 });
    expect(m.publish).toHaveBeenCalledWith(
      'watchlist.match',
      expect.objectContaining({ watchlistId: 'w1', zone: 'A' }),
    );
  });

  it("zone='A' in watchlist matches zone='A' in listing", async () => {
    m.selectRows.mockResolvedValueOnce([makeRow({ id: 'w1', zone: 'A' })]);
    const res = await svc.notifyMatchingWatchers(makeListing(), 'event-1', 'A');
    expect(res.notified).toBe(1);
  });

  it('SQL filters out wrong zone (DB returns no rows)', async () => {
    // Service trusts the SQL filter — verify the params it sends.
    m.selectRows.mockResolvedValueOnce([]);
    const res = await svc.notifyMatchingWatchers(makeListing(), 'event-1', 'B');
    expect(res).toEqual({ matched: 0, notified: 0, throttled: 0 });
    const call = m.selectRows.mock.calls[0];
    expect(call[1]).toEqual(['event-1', 'B', 15000]);
  });

  it('passes askPrice into the max_price filter', async () => {
    m.selectRows.mockResolvedValueOnce([]);
    await svc.notifyMatchingWatchers(makeListing({ askPrice: 150 }), 'event-1', null);
    expect(m.selectRows.mock.calls[0][1]).toEqual(['event-1', null, 150]);
  });

  it('matches when watchlist max_price >= listing askPrice', async () => {
    m.selectRows.mockResolvedValueOnce([
      makeRow({ id: 'w1', max_price: '200' }),
    ]);
    const res = await svc.notifyMatchingWatchers(
      makeListing({ askPrice: 150 }),
      'event-1',
      null,
    );
    expect(res.notified).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Throttling
// ---------------------------------------------------------------------------

describe('WatchlistService.notifyMatchingWatchers — throttling', () => {
  it('throttles when Redis key already set within 24h', async () => {
    const m = makeMocks();
    m.selectRows.mockResolvedValueOnce([makeRow({ id: 'w1' })]);
    m.redisGet.mockResolvedValueOnce('1');

    const svc = new WatchlistService(m.db, m.redis, m.eventBus);
    const res = await svc.notifyMatchingWatchers(makeListing(), 'event-1', null);

    expect(res).toEqual({ matched: 1, notified: 0, throttled: 1 });
    expect(m.publish).not.toHaveBeenCalled();
    expect(m.redisSet).not.toHaveBeenCalled();
    expect(m.updateSpy).not.toHaveBeenCalled();
  });

  it('proceeds with notification when throttle key has expired (returns null)', async () => {
    const m = makeMocks();
    m.selectRows.mockResolvedValueOnce([makeRow({ id: 'w1' })]);
    m.redisGet.mockResolvedValueOnce(null);

    const svc = new WatchlistService(m.db, m.redis, m.eventBus);
    const res = await svc.notifyMatchingWatchers(makeListing(), 'event-1', null);

    expect(res.notified).toBe(1);
    expect(m.redisSet).toHaveBeenCalledWith('watchlist:notified:w1', '1', 86400);
    expect(m.updateSpy).toHaveBeenCalledTimes(1);
  });

  it('mixed: 3 matched, 2 notified, 1 throttled', async () => {
    const m = makeMocks();
    m.selectRows.mockResolvedValueOnce([
      makeRow({ id: 'w1' }),
      makeRow({ id: 'w2' }),
      makeRow({ id: 'w3' }),
    ]);
    // w2 is throttled
    m.redisGet
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('1')
      .mockResolvedValueOnce(null);

    const svc = new WatchlistService(m.db, m.redis, m.eventBus);
    const res = await svc.notifyMatchingWatchers(makeListing(), 'event-1', null);

    expect(res).toEqual({ matched: 3, notified: 2, throttled: 1 });
    expect(m.publish).toHaveBeenCalledTimes(2);
    expect(m.redisSet).toHaveBeenCalledTimes(2);
    expect(m.updateSpy).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// watchlistMatchEmail
// ---------------------------------------------------------------------------

describe('watchlistMatchEmail', () => {
  const baseInput = {
    recipientName: 'Jana Nováková',
    eventName: 'Koncert Lucie',
    eventDate: '15. 6. 2026 20:00',
    askPriceHalire: 123450,
    zone: 'Sektor A',
    listingUrl: 'https://tixly.cz/resale/abc-123',
  };

  it('returns non-empty subject and html', () => {
    const r = watchlistMatchEmail(baseInput);
    expect(r.subject.length).toBeGreaterThan(0);
    expect(r.html.length).toBeGreaterThan(0);
  });

  it('subject contains the event name', () => {
    const r = watchlistMatchEmail(baseInput);
    expect(r.subject).toContain('Koncert Lucie');
    expect(r.subject).toBe('Vstupenka na Koncert Lucie je k dispozici v resale');
  });

  it('HTML contains formatted Kč amount with non-breaking space', () => {
    const r = watchlistMatchEmail(baseInput);
    expect(r.html).toContain('1\u00a0234,50 Kč');
  });

  it('handles Czech diacritics correctly', () => {
    const r = watchlistMatchEmail(baseInput);
    expect(r.html).toContain('Jana Nováková');
    expect(r.html).toContain('Zobrazit nabídku');
    expect(r.html).toContain('Pospěšte si');
  });

  it('escapes XSS attempts in eventName', () => {
    const r = watchlistMatchEmail({
      ...baseInput,
      eventName: '<script>alert(1)</script>',
    });
    expect(r.html).not.toContain('<script>alert(1)</script>');
    expect(r.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('omits zone row when zone is null', () => {
    const r = watchlistMatchEmail({ ...baseInput, zone: null });
    expect(r.html).not.toContain('Sektor:');
  });

  it('uses purple #6C47FF header colour', () => {
    const r = watchlistMatchEmail(baseInput);
    expect(r.html).toContain('#6C47FF');
  });

  it('contains the listing URL as a CTA link', () => {
    const r = watchlistMatchEmail(baseInput);
    expect(r.html).toContain('https://tixly.cz/resale/abc-123');
  });
});
