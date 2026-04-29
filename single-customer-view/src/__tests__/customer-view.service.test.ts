import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getCustomerProfile,
  getOrderHistory,
  getTimeline,
  searchCustomers,
  ServiceDeps,
} from '../services/customer-view.service.js';
import { CustomerNotFoundError } from '../types/customer-view.js';

// ─── Mock DB ─────────────────────────────────────────────────────────────────

function createMockDb(queryResults: Record<string, { rows: unknown[] }>) {
  const queryFn = vi.fn(async (sql: string, _params?: unknown[]) => {
    // Match by first significant keyword in the query
    for (const [key, result] of Object.entries(queryResults)) {
      if (sql.includes(key)) return result;
    }
    return { rows: [] };
  });

  return {
    query: queryFn,
    // withTenantContext calls client callback — we return the db itself as "client"
  } as unknown;
}

// Mock withTenantContext to just call the callback with db
vi.mock('@tixly/rls-multitenancy', () => ({
  withTenantContext: async (_db: unknown, _promoterId: string, fn: (client: unknown) => Promise<unknown>) => {
    return fn(_db);
  },
}));

const PROMOTER_ID = 'promo-001';
const USER_ID = 'user-001';

// ─── Test 1: Profile aggregation ─────────────────────────────────────────────

describe('getCustomerProfile', () => {
  it('aggreguje data z více tabulek do profilu', async () => {
    const db = createMockDb({
      'identity.users': {
        rows: [
          {
            id: USER_ID,
            email: 'jan@example.com',
            first_name: 'Jan',
            last_name: 'Novák',
            phone: '+420123456789',
            created_at: '2024-01-01T00:00:00Z',
          },
        ],
      },
      'orders.orders': {
        rows: [
          {
            order_count: '5',
            total_halire: '250000',
            max_created_at: '2026-04-01T00:00:00Z',
            ticket_count: '8',
            events_attended: '3',
          },
        ],
      },
      'orders.refunds': {
        rows: [{ refund_count: '1', refunded_halire: '5000' }],
      },
      'loyalty.accounts': {
        rows: [{ tier: 'gold', points_balance: '1200' }],
      },
      'segmentation.segment_members': {
        rows: [{ segment_id: 'seg-vip' }, { segment_id: 'seg-repeat' }],
      },
      'referral.referral_links': {
        rows: [{ code: 'REF-JAN', conversion_count: '3' }],
      },
      'risk.detection_runs': {
        rows: [{ total_score: 15 }],
      },
      'blacklist.blacklist_entries': {
        rows: [],
      },
      'tickets.scans': {
        rows: [{ last_attended: '2026-03-20T00:00:00Z' }],
      },
    });

    const deps: ServiceDeps = { db: db as never };
    const profile = await getCustomerProfile(USER_ID, PROMOTER_ID, deps);

    expect(profile.userId).toBe(USER_ID);
    expect(profile.email).toBe('jan@example.com');
    expect(profile.name).toBe('Jan Novák');
    expect(profile.lifetimeValueHalire).toBe(250000);
    expect(profile.lifetimeOrderCount).toBe(5);
    expect(profile.avgOrderValueHalire).toBe(50000);
    expect(profile.loyaltyTier).toBe('gold');
    expect(profile.loyaltyPointsBalance).toBe(1200);
    expect(profile.segmentIds).toEqual(['seg-vip', 'seg-repeat']);
    expect(profile.referralCode).toBe('REF-JAN');
    expect(profile.referralConversions).toBe(3);
    expect(profile.fraudRiskScore).toBe(15);
    expect(profile.isBlacklisted).toBe(false);
    expect(profile.totalTicketsBought).toBe(8);
    expect(profile.totalRefunds).toBe(1);
    expect(profile.totalRefundedHalire).toBe(5000);
    // RFM: recency ~7 days → 5, frequency 5 → 4, monetary 250k → 3
    expect(profile.rfm.recency).toBeGreaterThanOrEqual(1);
    expect(profile.rfm.recency).toBeLessThanOrEqual(5);
    expect(profile.rfm.cohort).toBeDefined();
  });

  // ─── Test 2: Empty user defaults ────────────────────────────────────────────

  it('vrátí výchozí hodnoty pro uživatele bez dat', async () => {
    const db = createMockDb({
      'identity.users': {
        rows: [
          {
            id: USER_ID,
            email: 'novy@example.com',
            first_name: null,
            last_name: null,
            phone: null,
            created_at: '2026-04-08T00:00:00Z',
          },
        ],
      },
      'orders.orders': {
        rows: [
          {
            order_count: '0',
            total_halire: '0',
            max_created_at: null,
            ticket_count: '0',
            events_attended: '0',
          },
        ],
      },
      'orders.refunds': {
        rows: [{ refund_count: '0', refunded_halire: '0' }],
      },
      'loyalty.accounts': { rows: [] },
      'segmentation.segment_members': { rows: [] },
      'referral.referral_links': { rows: [] },
      'risk.detection_runs': { rows: [] },
      'blacklist.blacklist_entries': { rows: [] },
      'tickets.scans': { rows: [{ last_attended: null }] },
    });

    const deps: ServiceDeps = { db: db as never };
    const profile = await getCustomerProfile(USER_ID, PROMOTER_ID, deps);

    expect(profile.name).toBe('novy@example.com'); // fallback to email
    expect(profile.lifetimeValueHalire).toBe(0);
    expect(profile.lifetimeOrderCount).toBe(0);
    expect(profile.avgOrderValueHalire).toBe(0);
    expect(profile.loyaltyTier).toBe('bronze');
    expect(profile.loyaltyPointsBalance).toBe(0);
    expect(profile.lastPurchaseAt).toBeNull();
    expect(profile.daysSinceLastPurchase).toBeNull();
    expect(profile.segmentIds).toEqual([]);
    expect(profile.referralCode).toBeNull();
    expect(profile.referralConversions).toBe(0);
    expect(profile.fraudRiskScore).toBeNull();
    expect(profile.isBlacklisted).toBe(false);
  });

  // ─── Test 3: Cross-tenant 404 ──────────────────────────────────────────────

  it('vyhodí CustomerNotFoundError pokud uživatel neexistuje', async () => {
    const db = createMockDb({
      'identity.users': { rows: [] },
    });

    const deps: ServiceDeps = { db: db as never };

    await expect(
      getCustomerProfile('nonexistent', PROMOTER_ID, deps),
    ).rejects.toThrow(CustomerNotFoundError);
  });
});

// ─── Test 4: Search by name/email ────────────────────────────────────────────

describe('searchCustomers', () => {
  it('vyhledá zákazníky podle jména nebo emailu', async () => {
    const db = createMockDb({
      'identity.users': {
        rows: [
          {
            id: 'user-found',
            email: 'found@example.com',
            first_name: 'Jana',
            last_name: 'Nová',
            phone: null,
            created_at: '2024-01-01T00:00:00Z',
            total_count: '1',
          },
        ],
      },
      'orders.orders': {
        rows: [
          {
            order_count: '1',
            total_halire: '10000',
            max_created_at: '2026-04-01T00:00:00Z',
            ticket_count: '1',
            events_attended: '1',
          },
        ],
      },
      'orders.refunds': {
        rows: [{ refund_count: '0', refunded_halire: '0' }],
      },
      'loyalty.accounts': { rows: [] },
      'segmentation.segment_members': { rows: [] },
      'referral.referral_links': { rows: [] },
      'risk.detection_runs': { rows: [] },
      'blacklist.blacklist_entries': { rows: [] },
      'tickets.scans': { rows: [{ last_attended: null }] },
    });

    const deps: ServiceDeps = { db: db as never };
    const result = await searchCustomers(PROMOTER_ID, 'Jana', { limit: 20, offset: 0 }, deps);

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe('Jana Nová');
  });
});

// ─── Test 5: Order history pagination ────────────────────────────────────────

describe('getOrderHistory', () => {
  it('vrátí stránkovanou historii objednávek', async () => {
    const db = createMockDb({
      'orders.orders o': {
        rows: [
          {
            order_id: 'ord-1',
            order_number: 'ORD-001',
            event_name: 'Koncert',
            event_date: '2026-05-01T20:00:00Z',
            total_halire: 50000,
            ticket_count: 2,
            status: 'paid',
            created_at: '2026-04-01T10:00:00Z',
          },
        ],
      },
      'COUNT': {
        rows: [{ count: '5' }],
      },
    });

    const deps: ServiceDeps = { db: db as never };
    const result = await getOrderHistory(USER_ID, PROMOTER_ID, { limit: 1, offset: 0 }, deps);

    expect(result.total).toBe(5);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].orderId).toBe('ord-1');
    expect(result.items[0].eventName).toBe('Koncert');
    expect(result.items[0].totalHalire).toBe(50000);
  });
});

// ─── Test 6: Timeline ordering ───────────────────────────────────────────────

describe('getTimeline', () => {
  it('vrátí timeline seřazenou od nejnovějšího', async () => {
    const db = createMockDb({
      'timeline': {
        rows: [
          {
            type: 'purchase',
            description: 'Nákup objednávky ORD-002',
            amount_halire: 30000,
            occurred_at: '2026-04-05T10:00:00Z',
            metadata: { orderId: 'ord-2' },
          },
          {
            type: 'refund',
            description: 'Refundace objednávky ord-1',
            amount_halire: 15000,
            occurred_at: '2026-04-03T10:00:00Z',
            metadata: { orderId: 'ord-1' },
          },
        ],
      },
      'count': {
        rows: [{ count: '2' }],
      },
    });

    const deps: ServiceDeps = { db: db as never };
    const result = await getTimeline(USER_ID, PROMOTER_ID, { limit: 20, offset: 0 }, deps);

    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].type).toBe('purchase');
    expect(result.items[1].type).toBe('refund');
    // Verify chronological order (descending)
    expect(new Date(result.items[0].occurredAt).getTime())
      .toBeGreaterThan(new Date(result.items[1].occurredAt).getTime());
  });
});
