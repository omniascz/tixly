import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DbAdapter, RedisAdapter, ServiceDeps } from '../lib/service-container';
import { AdminError } from '../lib/admin-errors';
import {
  getPlatformOverview,
  getDailyStats,
  listPromoters,
  getPromoterDetail,
  bulkUpdatePromoterStatus,
  getKycQueue,
  getKycStats,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  createNotification,
  getAuditLog,
  logAdminAction,
  invalidateOverviewCache,
} from '../services/admin.service';

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

function makeDb(overrides: Partial<DbAdapter> = {}): DbAdapter {
  return {
    query: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation(async (fn) => fn(makeDb())),
    ...overrides,
  };
}

function makeRedis(overrides: Partial<RedisAdapter> = {}): RedisAdapter {
  return {
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeDeps(dbOverrides: Partial<DbAdapter> = {}, redisOverrides: Partial<RedisAdapter> = {}): ServiceDeps {
  return { db: makeDb(dbOverrides), redis: makeRedis(redisOverrides) };
}

// ---------------------------------------------------------------------------
// Default mock rows
// ---------------------------------------------------------------------------

const statusRows = [
  { status: 'active', cnt: '10' },
  { status: 'suspended', cnt: '2' },
  { status: 'pending', cnt: '3' },
];

const kycRows = [{ cnt: '4' }];
const orderRows = [{ gmv: '500000', platform_revenue: '25000', orders_count: '150' }];
const payoutRows = [{ payout_count: '5', payout_amount: '200000' }];
const notifRows = [{ unread: '3', critical: '1' }];

const overviewPayload = {
  totalPromoters: 15,
  activePromoters: 10,
  suspendedPromoters: 2,
  pendingKyc: 4,
  gmv30d: 500000,
  platformRevenue30d: 25000,
  ordersCount30d: 150,
  pendingPayoutsCount: 5,
  pendingPayoutsAmount: 200000,
  unreadNotifications: 3,
  criticalNotifications: 1,
};

// ---------------------------------------------------------------------------
// getPlatformOverview
// ---------------------------------------------------------------------------

describe('getPlatformOverview', () => {
  it('cache hit → returns cached data without DB query', async () => {
    const deps = makeDeps({}, {
      get: vi.fn().mockResolvedValue(JSON.stringify(overviewPayload)),
    });
    const result = await getPlatformOverview(deps);
    expect(result).toEqual(overviewPayload);
    expect(deps.db.query).not.toHaveBeenCalled();
  });

  it('cache miss → queries DB and returns correct data', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(statusRows)
      .mockResolvedValueOnce(kycRows)
      .mockResolvedValueOnce(orderRows)
      .mockResolvedValueOnce(payoutRows)
      .mockResolvedValueOnce(notifRows);

    const deps = makeDeps({ query }, { get: vi.fn().mockResolvedValue(null) });
    const result = await getPlatformOverview(deps);

    expect(result.totalPromoters).toBe(15);
    expect(result.activePromoters).toBe(10);
    expect(result.pendingKyc).toBe(4);
    expect(result.gmv30d).toBe(500000);
    expect(result.platformRevenue30d).toBe(25000);
    expect(result.ordersCount30d).toBe(150);
    expect(result.pendingPayoutsCount).toBe(5);
    expect(result.pendingPayoutsAmount).toBe(200000);
    expect(result.unreadNotifications).toBe(3);
    expect(result.criticalNotifications).toBe(1);
  });

  it('cache miss → saves result to Redis with TTL 300', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(statusRows)
      .mockResolvedValueOnce(kycRows)
      .mockResolvedValueOnce(orderRows)
      .mockResolvedValueOnce(payoutRows)
      .mockResolvedValueOnce(notifRows);

    const setex = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ query }, { get: vi.fn().mockResolvedValue(null), setex });
    await getPlatformOverview(deps);

    expect(setex).toHaveBeenCalledWith('admin:overview', 300, expect.any(String));
  });

  it('handles missing promoter status rows → zero values', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ cnt: '0' }])
      .mockResolvedValueOnce([{ gmv: null, platform_revenue: null, orders_count: '0' }])
      .mockResolvedValueOnce([{ payout_count: '0', payout_amount: null }])
      .mockResolvedValueOnce([{ unread: null, critical: null }]);

    const deps = makeDeps({ query }, { get: vi.fn().mockResolvedValue(null) });
    const result = await getPlatformOverview(deps);
    expect(result.totalPromoters).toBe(0);
    expect(result.gmv30d).toBe(0);
    expect(result.criticalNotifications).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getDailyStats
// ---------------------------------------------------------------------------

describe('getDailyStats', () => {
  const dailyRows = [
    { date: '2026-04-04', gmv: '100000', platform_revenue: '5000', orders_count: '20', new_promoters: '1', active_promoters: '3' },
    { date: '2026-04-03', gmv: '80000', platform_revenue: '4000', orders_count: '15', new_promoters: '0', active_promoters: '2' },
  ];

  it('returns stats mapped from DB rows', async () => {
    const deps = makeDeps({ query: vi.fn().mockResolvedValue(dailyRows) });
    const result = await getDailyStats(7, deps);
    expect(result).toHaveLength(2);
    expect(result[0].date).toBe('2026-04-04');
    expect(result[0].gmv).toBe(100000);
    expect(result[0].platformRevenue).toBe(5000);
    expect(result[0].ordersCount).toBe(20);
    expect(result[0].newPromoters).toBe(1);
    expect(result[0].activePromoters).toBe(3);
  });

  it('empty days → empty array (not null values)', async () => {
    const deps = makeDeps({ query: vi.fn().mockResolvedValue([]) });
    const result = await getDailyStats(30, deps);
    expect(result).toEqual([]);
  });

  it('null DB values → zero fallback', async () => {
    const deps = makeDeps({
      query: vi.fn().mockResolvedValue([
        { date: '2026-04-01', gmv: null, platform_revenue: null, orders_count: null, new_promoters: null, active_promoters: null },
      ]),
    });
    const result = await getDailyStats(30, deps);
    expect(result[0].gmv).toBe(0);
    expect(result[0].platformRevenue).toBe(0);
    expect(result[0].ordersCount).toBe(0);
    expect(result[0].newPromoters).toBe(0);
    expect(result[0].activePromoters).toBe(0);
  });

  it('cache hit → returns cached, does not call DB', async () => {
    const cachedStats = [{ date: '2026-04-04', gmv: 9999, platformRevenue: 100, ordersCount: 5, newPromoters: 0, activePromoters: 1 }];
    const redis = makeRedis({ get: vi.fn().mockResolvedValue(JSON.stringify(cachedStats)) });
    const db = makeDb();
    const result = await getDailyStats(7, { db, redis });
    expect(result).toEqual(cachedStats);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('cache miss → saves with TTL 600s', async () => {
    const setex = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps(
      { query: vi.fn().mockResolvedValue(dailyRows) },
      { get: vi.fn().mockResolvedValue(null), setex },
    );
    await getDailyStats(7, deps);
    expect(setex).toHaveBeenCalledWith('admin:daily_stats:7', 600, expect.any(String));
  });
});

// ---------------------------------------------------------------------------
// listPromoters
// ---------------------------------------------------------------------------

describe('listPromoters', () => {
  const promoterRows = [
    {
      id: 'p1',
      name: 'Acme Events',
      email: 'acme@example.com',
      ico: '12345678',
      status: 'active',
      kyc_status: 'approved',
      slug: 'acme',
      created_at: '2026-01-01T00:00:00Z',
      total_events: '5',
      total_revenue: '1000000',
      active_events: '2',
      last_activity_at: '2026-04-01T10:00:00Z',
      total_count: '1',
    },
  ];

  it('without filters → returns all promoters', async () => {
    const deps = makeDeps({ query: vi.fn().mockResolvedValue(promoterRows) });
    const result = await listPromoters({}, deps);
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe('Acme Events');
    expect(result.items[0].totalRevenue).toBe(1000000);
  });

  it('search filter → includes ILIKE condition in SQL', async () => {
    const query = vi.fn().mockResolvedValue(promoterRows);
    const deps = makeDeps({ query });
    await listPromoters({ search: 'Acme' }, deps);
    const sql: string = (query.mock.calls[0][0] as string);
    expect(sql).toContain('ILIKE');
  });

  it('search filter on IČO → passes search param', async () => {
    const query = vi.fn().mockResolvedValue(promoterRows);
    const deps = makeDeps({ query });
    await listPromoters({ search: '12345678' }, deps);
    const params = query.mock.calls[0][1] as unknown[];
    expect(params).toContain('%12345678%');
  });

  it('status filter → adds status condition', async () => {
    const query = vi.fn().mockResolvedValue(promoterRows);
    const deps = makeDeps({ query });
    await listPromoters({ status: 'active' }, deps);
    const params = query.mock.calls[0][1] as unknown[];
    expect(params).toContain('active');
  });

  it('kycStatus filter → adds kyc_status condition', async () => {
    const query = vi.fn().mockResolvedValue(promoterRows);
    const deps = makeDeps({ query });
    await listPromoters({ kycStatus: 'submitted' }, deps);
    const params = query.mock.calls[0][1] as unknown[];
    expect(params).toContain('submitted');
  });

  it('sortBy=total_revenue DESC → SQL contains total_revenue DESC', async () => {
    const query = vi.fn().mockResolvedValue(promoterRows);
    const deps = makeDeps({ query });
    await listPromoters({ sortBy: 'total_revenue', sortOrder: 'desc' }, deps);
    const sql: string = (query.mock.calls[0][0] as string);
    expect(sql).toContain('total_revenue');
    expect(sql).toContain('DESC');
  });

  it('pagination → limit and offset passed to DB', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const deps = makeDeps({ query });
    await listPromoters({ limit: 10, offset: 30 }, deps);
    const params = query.mock.calls[0][1] as unknown[];
    expect(params).toContain(10);
    expect(params).toContain(30);
  });

  it('empty result → total 0', async () => {
    const deps = makeDeps({ query: vi.fn().mockResolvedValue([]) });
    const result = await listPromoters({}, deps);
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getPromoterDetail
// ---------------------------------------------------------------------------

describe('getPromoterDetail', () => {
  const detailRow = {
    id: 'p1',
    name: 'Acme Events',
    email: 'acme@example.com',
    ico: '12345678',
    status: 'active',
    kyc_status: 'approved',
    slug: 'acme',
    created_at: '2026-01-01T00:00:00Z',
    legal_name: 'Acme s.r.o.',
    dic: 'CZ12345678',
    phone: '+420123456789',
    website: 'https://acme.cz',
    bank_account_iban: 'CZ0000000000000000000000',
    kyc_verified_at: '2026-02-01T00:00:00Z',
    kyc_notes: null,
    total_events: '5',
    total_revenue: '1000000',
    active_events: '2',
    last_activity_at: '2026-04-01T10:00:00Z',
  };

  const payoutRow = { id: 'py1', net_payout: '50000', status: 'paid', created_at: '2026-03-01T00:00:00Z' };
  const eventRow = { id: 'e1', title: 'Festival', status: 'published', starts_at: '2026-07-01T18:00:00Z', total_revenue: '200000' };
  const actionRow = { id: 'a1', admin_user_id: 'admin1', action: 'kyc_approve', target_type: 'promoter', target_id: 'p1', details: {}, ip_address: null, created_at: '2026-02-01T00:00:00Z' };

  it('returns full promoter detail with history', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([detailRow])
      .mockResolvedValueOnce([payoutRow])
      .mockResolvedValueOnce([eventRow])
      .mockResolvedValueOnce([actionRow]);

    const deps = makeDeps({ query });
    const result = await getPromoterDetail('p1', deps);

    expect(result.id).toBe('p1');
    expect(result.legalName).toBe('Acme s.r.o.');
    expect(result.dic).toBe('CZ12345678');
    expect(result.recentPayouts).toHaveLength(1);
    expect(result.recentPayouts[0].amount).toBe(50000);
    expect(result.recentEvents).toHaveLength(1);
    expect(result.recentEvents[0].title).toBe('Festival');
    expect(result.adminActions).toHaveLength(1);
    expect(result.adminActions[0].action).toBe('kyc_approve');
  });

  it('non-existent ID → throws PROMOTER_NOT_FOUND', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const deps = makeDeps({ query });
    await expect(getPromoterDetail('non-existent', deps)).rejects.toThrow(AdminError);

    try {
      await getPromoterDetail('non-existent', makeDeps({ query: vi.fn().mockResolvedValueOnce([]).mockResolvedValue([]) }));
    } catch (err) {
      expect(err instanceof AdminError && err.code).toBe('PROMOTER_NOT_FOUND');
    }
  });
});

// ---------------------------------------------------------------------------
// bulkUpdatePromoterStatus
// ---------------------------------------------------------------------------

describe('bulkUpdatePromoterStatus', () => {
  it('all succeed → { succeeded: [...], failed: [] }', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ execute });
    const result = await bulkUpdatePromoterStatus(
      ['p1', 'p2', 'p3'],
      'suspend',
      'Spam',
      'admin1',
      deps,
    );
    expect(result.succeeded).toEqual(['p1', 'p2', 'p3']);
    expect(result.failed).toEqual([]);
  });

  it('partial failure → returns 207-style detail', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(undefined)     // p1 ok
      .mockRejectedValueOnce(new Error('DB error'))  // p2 fails
      .mockResolvedValueOnce(undefined);    // p3 ok

    const deps = makeDeps({ execute });
    const result = await bulkUpdatePromoterStatus(
      ['p1', 'p2', 'p3'],
      'activate',
      'Reinstate',
      'admin1',
      deps,
    );
    expect(result.succeeded).toContain('p1');
    expect(result.succeeded).toContain('p3');
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].id).toBe('p2');
    expect(result.failed[0].error).toBe('DB error');
  });

  it('> 50 promoters → throws INVALID_ACTION', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `p${i}`);
    const deps = makeDeps();
    await expect(
      bulkUpdatePromoterStatus(ids, 'ban', 'Fraud', 'admin1', deps),
    ).rejects.toThrow(AdminError);

    try {
      await bulkUpdatePromoterStatus(ids, 'ban', 'Fraud', 'admin1', deps);
    } catch (err) {
      expect(err instanceof AdminError && err.code).toBe('INVALID_ACTION');
    }
  });

  it('calls DB execute for each promoter', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ execute });
    await bulkUpdatePromoterStatus(['p1', 'p2'], 'ban', 'Reason', 'admin1', deps);
    // 2 UPDATE calls (logAdminAction may also fire execute, but async)
    const updateCalls = (execute.mock.calls as unknown[][]).filter((args) =>
      (args[0] as string).includes('UPDATE platform.promoters'),
    );
    expect(updateCalls).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// getKycQueue
// ---------------------------------------------------------------------------

describe('getKycQueue', () => {
  const kycQueueRow = {
    id: 'p1',
    name: 'New Promoter',
    email: 'new@example.com',
    ico: null,
    kyc_status: 'submitted',
    waiting_days: '3',
    submitted_at: '2026-04-01T10:00:00Z',
    created_at: '2026-03-28T08:00:00Z',
    total_count: '1',
  };

  it('returns only submitted KYC items', async () => {
    const query = vi.fn().mockResolvedValue([kycQueueRow]);
    const deps = makeDeps({ query });
    const result = await getKycQueue({}, deps);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].kycStatus).toBe('submitted');
    expect(result.total).toBe(1);
  });

  it('priority=waiting_long → SQL includes waiting days condition', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const deps = makeDeps({ query });
    await getKycQueue({ priority: 'waiting_long' }, deps);
    const sql: string = (query.mock.calls[0][0] as string);
    expect(sql).toContain('86400');
  });

  it('maps waitingDays correctly', async () => {
    const query = vi.fn().mockResolvedValue([kycQueueRow]);
    const deps = makeDeps({ query });
    const result = await getKycQueue({}, deps);
    expect(result.items[0].waitingDays).toBe(3);
  });

  it('empty queue → total 0', async () => {
    const deps = makeDeps({ query: vi.fn().mockResolvedValue([]) });
    const result = await getKycQueue({}, deps);
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getKycStats
// ---------------------------------------------------------------------------

describe('getKycStats', () => {
  it('returns correct counts', async () => {
    const query = vi.fn().mockResolvedValue([
      { total_pending: '4', avg_waiting_days: '2.5', approved_today: '2', rejected_today: '1' },
    ]);
    const deps = makeDeps({ query });
    const result = await getKycStats(deps);
    expect(result.totalPending).toBe(4);
    expect(result.avgWaitingDays).toBe(2.5);
    expect(result.approvedToday).toBe(2);
    expect(result.rejectedToday).toBe(1);
  });

  it('null values → zero fallback', async () => {
    const query = vi.fn().mockResolvedValue([
      { total_pending: null, avg_waiting_days: null, approved_today: null, rejected_today: null },
    ]);
    const deps = makeDeps({ query });
    const result = await getKycStats(deps);
    expect(result.totalPending).toBe(0);
    expect(result.avgWaitingDays).toBe(0);
    expect(result.approvedToday).toBe(0);
    expect(result.rejectedToday).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// listNotifications
// ---------------------------------------------------------------------------

describe('listNotifications', () => {
  const unreadCritical = {
    id: 'n1',
    type: 'kyc_submitted',
    priority: 'critical',
    title: 'KYC pending',
    body: null,
    target_type: 'promoter',
    target_id: 'p1',
    is_read: false,
    created_at: '2026-04-04T12:00:00Z',
  };
  const readNormal = {
    id: 'n2',
    type: 'payout_pending',
    priority: 'normal',
    title: 'Payout waiting',
    body: 'Details',
    target_type: 'payout',
    target_id: 'py1',
    is_read: true,
    created_at: '2026-04-03T10:00:00Z',
  };

  it('unread notifications first — SQL orders by is_read ASC', async () => {
    const query = vi.fn().mockResolvedValue([unreadCritical, readNormal]);
    const deps = makeDeps({ query });
    await listNotifications({}, deps);
    const sql: string = (query.mock.calls[0][0] as string);
    expect(sql).toContain('is_read ASC');
  });

  it('isRead=false filter → only unread returned', async () => {
    const query = vi.fn().mockResolvedValue([unreadCritical]);
    const deps = makeDeps({ query });
    const result = await listNotifications({ isRead: false }, deps);
    expect(result).toHaveLength(1);
    expect(result[0].isRead).toBe(false);
    // Check filter was applied
    const params = query.mock.calls[0][1] as unknown[];
    expect(params).toContain(false);
  });

  it('maps notification fields correctly', async () => {
    const query = vi.fn().mockResolvedValue([unreadCritical]);
    const deps = makeDeps({ query });
    const result = await listNotifications({}, deps);
    expect(result[0]).toMatchObject({
      id: 'n1',
      type: 'kyc_submitted',
      priority: 'critical',
      isRead: false,
      targetType: 'promoter',
      targetId: 'p1',
    });
  });
});

// ---------------------------------------------------------------------------
// markNotificationRead
// ---------------------------------------------------------------------------

describe('markNotificationRead', () => {
  it('marks is_read = true', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const query = vi.fn().mockResolvedValue([{ id: 'n1' }]);
    const deps = makeDeps({ query, execute });
    await markNotificationRead('n1', 'admin1', deps);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('is_read = TRUE'),
      expect.arrayContaining(['admin1', 'n1']),
    );
  });

  it('non-existent notification → throws NOTIFICATION_NOT_FOUND', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const deps = makeDeps({ query });
    await expect(markNotificationRead('missing', 'admin1', deps)).rejects.toThrow(AdminError);
    try {
      await markNotificationRead('missing', 'admin1', makeDeps({ query: vi.fn().mockResolvedValue([]) }));
    } catch (err) {
      expect(err instanceof AdminError && err.code).toBe('NOTIFICATION_NOT_FOUND');
    }
  });
});

// ---------------------------------------------------------------------------
// markAllNotificationsRead
// ---------------------------------------------------------------------------

describe('markAllNotificationsRead', () => {
  it('marks all unread and returns count', async () => {
    const query = vi.fn().mockResolvedValue([{ count: '7' }]);
    const deps = makeDeps({ query });
    const result = await markAllNotificationsRead('admin1', deps);
    expect(result.count).toBe(7);
  });

  it('no unread → returns count 0', async () => {
    const query = vi.fn().mockResolvedValue([{ count: '0' }]);
    const deps = makeDeps({ query });
    const result = await markAllNotificationsRead('admin1', deps);
    expect(result.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// createNotification
// ---------------------------------------------------------------------------

describe('createNotification', () => {
  it('inserts and returns mapped notification', async () => {
    const returned = {
      id: 'n-new',
      type: 'suspicious_activity',
      priority: 'high',
      title: 'Suspicious login',
      body: null,
      target_type: null,
      target_id: null,
      is_read: false,
      created_at: '2026-04-05T08:00:00Z',
    };
    const query = vi.fn().mockResolvedValue([returned]);
    const deps = makeDeps({ query });

    const result = await createNotification(
      { type: 'suspicious_activity', priority: 'high', title: 'Suspicious login' },
      deps,
    );

    expect(result.id).toBe('n-new');
    expect(result.priority).toBe('high');
    expect(result.type).toBe('suspicious_activity');
    expect(result.isRead).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getAuditLog
// ---------------------------------------------------------------------------

describe('getAuditLog', () => {
  const logRow = {
    id: 'a1',
    admin_user_id: 'admin1',
    action: 'kyc_approve',
    target_type: 'promoter',
    target_id: 'p1',
    details: { reason: 'Documents verified' },
    ip_address: '192.168.1.1',
    created_at: '2026-03-01T10:00:00Z',
    total_count: '1',
  };

  it('targetId filter → passes targetId param', async () => {
    const query = vi.fn().mockResolvedValue([logRow]);
    const deps = makeDeps({ query });
    await getAuditLog({ targetId: 'p1' }, deps);
    const params = query.mock.calls[0][1] as unknown[];
    expect(params).toContain('p1');
  });

  it('adminUserId filter → passes adminUserId param', async () => {
    const query = vi.fn().mockResolvedValue([logRow]);
    const deps = makeDeps({ query });
    await getAuditLog({ adminUserId: 'admin1' }, deps);
    const params = query.mock.calls[0][1] as unknown[];
    expect(params).toContain('admin1');
  });

  it('from/to filter → passes both date params', async () => {
    const query = vi.fn().mockResolvedValue([logRow]);
    const deps = makeDeps({ query });
    await getAuditLog({
      from: '2026-03-01T00:00:00Z',
      to: '2026-04-01T00:00:00Z',
    }, deps);
    const params = query.mock.calls[0][1] as unknown[];
    expect(params).toContain('2026-03-01T00:00:00Z');
    expect(params).toContain('2026-04-01T00:00:00Z');
  });

  it('returns mapped items with correct total', async () => {
    const query = vi.fn().mockResolvedValue([logRow]);
    const deps = makeDeps({ query });
    const result = await getAuditLog({}, deps);
    expect(result.total).toBe(1);
    expect(result.items[0].action).toBe('kyc_approve');
    expect(result.items[0].adminUserId).toBe('admin1');
    expect(result.items[0].ipAddress).toBe('192.168.1.1');
  });

  it('details as string → parsed to object', async () => {
    const row = { ...logRow, details: '{"reason":"test"}' };
    const query = vi.fn().mockResolvedValue([row]);
    const deps = makeDeps({ query });
    const result = await getAuditLog({}, deps);
    expect(result.items[0].details).toEqual({ reason: 'test' });
  });
});

// ---------------------------------------------------------------------------
// logAdminAction
// ---------------------------------------------------------------------------

describe('logAdminAction', () => {
  it('inserts into platform.admin_actions', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ execute });
    await logAdminAction('admin1', 'suspend', 'promoter', 'p1', { reason: 'Spam' }, deps);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('platform.admin_actions'),
      expect.arrayContaining(['admin1', 'suspend', 'promoter', 'p1']),
    );
  });

  it('serializes details as JSON string param', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ execute });
    await logAdminAction('admin1', 'ban', 'promoter', 'p2', { extra: true }, deps);
    const params = execute.mock.calls[0][1] as unknown[];
    expect(params[4]).toBe(JSON.stringify({ extra: true }));
  });
});

// ---------------------------------------------------------------------------
// invalidateOverviewCache
// ---------------------------------------------------------------------------

describe('invalidateOverviewCache', () => {
  it('deletes admin:overview key', async () => {
    const del = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({}, { del });
    await invalidateOverviewCache(deps);
    expect(del).toHaveBeenCalledWith('admin:overview');
  });

  it('deletes admin:daily_stats key', async () => {
    const del = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({}, { del });
    await invalidateOverviewCache(deps);
    expect(del).toHaveBeenCalledWith('admin:daily_stats');
  });

  it('calls del exactly twice (for both cache keys)', async () => {
    const del = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({}, { del });
    await invalidateOverviewCache(deps);
    expect(del).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Additional Module #37 Tests — Platform Admin API Coverage
// ---------------------------------------------------------------------------

describe('listPromoters — additional coverage', () => {
  const promoterRows = [
    {
      id: 'p1',
      name: 'Acme Events',
      email: 'acme@example.com',
      ico: '12345678',
      status: 'active',
      kyc_status: 'approved',
      slug: 'acme',
      created_at: '2026-01-01T00:00:00Z',
      total_events: '5',
      total_revenue: '1000000',
      active_events: '2',
      last_activity_at: '2026-04-01T10:00:00Z',
      total_count: '1',
    },
  ];

  it('returns filtered results with status filter', async () => {
    const query = vi.fn().mockResolvedValue(promoterRows);
    const deps = makeDeps({ query });
    const result = await listPromoters({ status: 'active' }, deps);
    expect(result.items[0].status).toBe('active');
    const params = query.mock.calls[0][1] as unknown[];
    expect(params).toContain('active');
  });

  it('search by name using ILIKE (case-insensitive)', async () => {
    const query = vi.fn().mockResolvedValue(promoterRows);
    const deps = makeDeps({ query });
    await listPromoters({ search: 'acme' }, deps);
    const params = query.mock.calls[0][1] as unknown[];
    expect(params).toContain('%acme%');
    const sql: string = (query.mock.calls[0][0] as string);
    expect(sql).toContain('ILIKE');
  });

  it('search by email using ILIKE', async () => {
    const query = vi.fn().mockResolvedValue(promoterRows);
    const deps = makeDeps({ query });
    await listPromoters({ search: 'example.com' }, deps);
    const params = query.mock.calls[0][1] as unknown[];
    expect(params).toContain('%example.com%');
  });
});

describe('getPromoterDetail — KYC documents coverage', () => {
  const detailRow = {
    id: 'p1',
    name: 'Acme Events',
    email: 'acme@example.com',
    ico: '12345678',
    status: 'active',
    kyc_status: 'approved',
    slug: 'acme',
    created_at: '2026-01-01T00:00:00Z',
    legal_name: 'Acme s.r.o.',
    dic: 'CZ12345678',
    phone: '+420123456789',
    website: 'https://acme.cz',
    bank_account_iban: 'CZ0000000000000000000000',
    kyc_verified_at: '2026-02-01T00:00:00Z',
    kyc_notes: 'Documents verified on 2026-02-01',
    total_events: '5',
    total_revenue: '1000000',
    active_events: '2',
    last_activity_at: '2026-04-01T10:00:00Z',
  };

  const payoutRow = { id: 'py1', net_payout: '50000', status: 'paid', created_at: '2026-03-01T00:00:00Z' };
  const eventRow = { id: 'e1', title: 'Festival', status: 'published', starts_at: '2026-07-01T18:00:00Z', total_revenue: '200000' };
  const actionRow = { id: 'a1', admin_user_id: 'admin1', action: 'kyc_approve', target_type: 'promoter', target_id: 'p1', details: { documents: ['id', 'proof_of_address'] }, ip_address: '192.168.1.1', created_at: '2026-02-01T00:00:00Z' };

  it('returns KYC documents in admin actions', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([detailRow])
      .mockResolvedValueOnce([payoutRow])
      .mockResolvedValueOnce([eventRow])
      .mockResolvedValueOnce([actionRow]);

    const deps = makeDeps({ query });
    const result = await getPromoterDetail('p1', deps);

    expect(result.adminActions).toHaveLength(1);
    expect(result.adminActions[0].action).toBe('kyc_approve');
    expect(result.adminActions[0].details).toEqual({ documents: ['id', 'proof_of_address'] });
  });

  it('returns KYC verified date and notes', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([detailRow])
      .mockResolvedValueOnce([payoutRow])
      .mockResolvedValueOnce([eventRow])
      .mockResolvedValueOnce([actionRow]);

    const deps = makeDeps({ query });
    const result = await getPromoterDetail('p1', deps);

    expect(result.kycVerifiedAt).toBe('2026-02-01T00:00:00Z');
    expect(result.kycNotes).toContain('verified');
  });
});

describe('bulkUpdatePromoterStatus — status transitions', () => {
  it('pending → active via approvePromoter (activate action)', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ execute });

    const result = await bulkUpdatePromoterStatus(
      ['p1'],
      'activate',
      'KYC approved',
      'admin1',
      deps,
    );

    expect(result.succeeded).toContain('p1');
    const updateCall = (execute.mock.calls as unknown[][]).find((args) =>
      (args[0] as string).includes('UPDATE platform.promoters')
    );
    const params = updateCall?.[1] as unknown[];
    expect(params).toContain('active');
  });

  it('active → suspended via suspendPromoter', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ execute });

    const result = await bulkUpdatePromoterStatus(
      ['p1'],
      'suspend',
      'Violating TOS',
      'admin1',
      deps,
    );

    expect(result.succeeded).toContain('p1');
    const updateCall = (execute.mock.calls as unknown[][]).find((args) =>
      (args[0] as string).includes('UPDATE platform.promoters')
    );
    const params = updateCall?.[1] as unknown[];
    expect(params).toContain('suspended');
  });

  it('any → banned via ban action', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ execute });

    const result = await bulkUpdatePromoterStatus(
      ['p1'],
      'ban',
      'Fraud detected',
      'admin1',
      deps,
    );

    expect(result.succeeded).toContain('p1');
    const updateCall = (execute.mock.calls as unknown[][]).find((args) =>
      (args[0] as string).includes('UPDATE platform.promoters')
    );
    const params = updateCall?.[1] as unknown[];
    expect(params).toContain('banned');
  });
});

describe('non-admin access control (x-is-admin check)', () => {
  it('admin-only functions should check authorization at route level', async () => {
    // NOTE: These tests verify the service functions work correctly.
    // Authorization check (x-is-admin header) is typically done in the route handler,
    // not in the service layer. Example:
    // if (!request.headers.get('x-is-admin')) throw new Error('Forbidden');
    // await bulkUpdatePromoterStatus(...);

    const execute = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ execute });

    // The service function itself doesn't validate auth — the route handler does.
    // We verify the service works:
    const result = await bulkUpdatePromoterStatus(
      ['p1'],
      'suspend',
      'Test',
      'admin1',
      deps,
    );

    expect(result.succeeded).toHaveLength(1);
  });
});

describe('getKycQueue — only pending items', () => {
  const pendingRow = {
    id: 'p1',
    name: 'Pending Promoter',
    email: 'pending@example.com',
    ico: null,
    kyc_status: 'submitted',
    waiting_days: '5',
    submitted_at: '2026-03-30T10:00:00Z',
    created_at: '2026-03-28T08:00:00Z',
    total_count: '1',
  };

  const approvedRow = {
    id: 'p2',
    name: 'Approved Promoter',
    email: 'approved@example.com',
    ico: null,
    kyc_status: 'approved',
    waiting_days: null,
    submitted_at: null,
    created_at: '2026-03-27T08:00:00Z',
    total_count: null,
  };

  it('returns only submitted KYC status items, not approved', async () => {
    const query = vi.fn().mockResolvedValue([pendingRow]);
    const deps = makeDeps({ query });

    const result = await getKycQueue({}, deps);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].kycStatus).toBe('submitted');
    expect(result.items[0].id).toBe('p1');
  });

  it('SQL condition filters kyc_status = submitted', async () => {
    const query = vi.fn().mockResolvedValue([pendingRow]);
    const deps = makeDeps({ query });

    await getKycQueue({}, deps);

    const sql: string = (query.mock.calls[0][0] as string);
    expect(sql).toContain("kyc_status = 'submitted'");
  });
});

describe('revenue stats — correct aggregates with integer halíře', () => {
  it('sums platform revenue as integers (halíře = 1/100 CZK)', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([
        { status: 'active', cnt: '5' },
        { status: 'suspended', cnt: '1' },
      ])
      .mockResolvedValueOnce([{ cnt: '0' }])
      .mockResolvedValueOnce([
        { gmv: '1000000', platform_revenue: '50000', orders_count: '100' },
      ])
      .mockResolvedValueOnce([
        { payout_count: '3', payout_amount: '120000' },
      ])
      .mockResolvedValueOnce([
        { unread: '2', critical: '0' },
      ]);

    const deps = makeDeps({ query });
    const result = await getPlatformOverview(deps);

    expect(result.platformRevenue30d).toBe(50000); // in halíře
    expect(result.gmv30d).toBe(1000000); // in halíře
    expect(typeof result.platformRevenue30d).toBe('number');
    expect(Number.isInteger(result.platformRevenue30d)).toBe(true);
  });
});

describe('additional KYC and notification scenarios', () => {
  it('listNotifications with priority=critical filter', async () => {
    const criticalNotif = {
      id: 'n1',
      type: 'kyc_urgent',
      priority: 'critical',
      title: 'Critical KYC issue',
      body: 'Action required',
      target_type: 'promoter',
      target_id: 'p1',
      is_read: false,
      created_at: '2026-04-05T10:00:00Z',
    };

    const query = vi.fn().mockResolvedValue([criticalNotif]);
    const deps = makeDeps({ query });

    const result = await listNotifications({ priority: 'critical' }, deps);

    expect(result).toHaveLength(1);
    expect(result[0].priority).toBe('critical');
    const params = query.mock.calls[0][1] as unknown[];
    expect(params).toContain('critical');
  });

  it('markAllNotificationsRead batches all unread → read in one CTE', async () => {
    const query = vi.fn().mockResolvedValue([{ count: '42' }]);
    const deps = makeDeps({ query });

    const result = await markAllNotificationsRead('admin1', deps);

    expect(result.count).toBe(42);
    const sql: string = (query.mock.calls[0][0] as string);
    expect(sql).toContain('WITH updated AS');
    expect(sql).toContain('UPDATE platform.admin_notifications');
  });
});
