/**
 * Tests for applyPromoCode() in src/lib/promo-code-handler.ts
 *
 * All monetary values are integer haléře (1 Kč = 100 haléřů).
 * DB is fully mocked with vi.fn().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock crypto.randomUUID so INSERT IDs are deterministic
// ---------------------------------------------------------------------------
vi.mock('crypto', async () => {
  const actual = await vi.importActual<typeof import('crypto')>('crypto');
  let seq = 0;
  return {
    ...actual,
    randomUUID: vi.fn(() => `uuid-${++seq}`),
  };
});

import { applyPromoCode, type DbAdapter } from '@lib/promo-code-handler.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date('2026-04-08T12:00:00Z');

/** Base valid promo code row returned by the mock DB SELECT … FOR UPDATE */
function makePromoCodeRow(overrides: Partial<{
  id: string;
  code: string;
  type: 'percentage' | 'fixed' | 'bogo' | 'free';
  discount_value: number;
  max_uses: number | null;
  uses_count: number;
  max_uses_per_user: number | null;
  valid_from: Date;
  valid_until: Date | null;
  min_quantity: number;
  min_order_amount: number;
  applicable_ticket_type_ids: string[] | null;
  applicable_event_ids: string[] | null;
  active: boolean;
}> = {}) {
  return {
    id: 'pc-1',
    code: 'SAVE20',
    type: 'percentage' as const,
    discount_value: 20,
    max_uses: null,
    uses_count: 0,
    max_uses_per_user: null,
    valid_from: new Date('2026-01-01T00:00:00Z'),
    valid_until: null,
    min_quantity: 1,
    min_order_amount: 0,
    applicable_ticket_type_ids: null,
    applicable_event_ids: null,
    active: true,
    ...overrides,
  };
}

const BASE_INPUT = {
  code: 'SAVE20',
  orderId: 'order-1',
  userId: 'user-1',
  eventId: 'event-1',
  orderTotalHalire: 98000,
  ticketTypeIds: ['tt-1'],
  orderItems: [{ ticketTypeId: 'tt-1', quantity: 2, unitPriceHalire: 49000 }],
};

// ---------------------------------------------------------------------------
// Mock DB factory
// ---------------------------------------------------------------------------

/**
 * Creates a mock DbAdapter whose transaction() delegates to the same mock
 * (no real savepoints needed for unit tests).
 *
 * promoRow:    row returned for the SELECT … FOR UPDATE query
 * userUsages:  rows returned for the per-user usage COUNT query
 */
function createMockDb(
  promoRow: ReturnType<typeof makePromoCodeRow> | null,
  userUsages: { cnt: string }[] = [{ cnt: '0' }],
): DbAdapter & {
  executedSqls: string[];
  executedParams: unknown[][];
} {
  const executedSqls: string[] = [];
  const executedParams: unknown[][] = [];

  const adapter: DbAdapter & {
    executedSqls: string[];
    executedParams: unknown[][];
  } = {
    executedSqls,
    executedParams,

    async query<T>(sql: string, _params?: unknown[]): Promise<T[]> {
      // Per-user usage count query
      if (sql.includes('promo_code_usages') && sql.includes('COUNT')) {
        return userUsages as unknown as T[];
      }
      // Main SELECT FOR UPDATE
      if (promoRow === null) return [] as T[];
      return [promoRow] as unknown as T[];
    },

    async execute(sql: string, params?: unknown[]): Promise<void> {
      executedSqls.push(sql);
      executedParams.push(params ?? []);
    },

    async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
      return fn(adapter);
    },
  };

  return adapter;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('applyPromoCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Advance past NOW so valid_from = 2026-01-01 is in the past
    vi.setSystemTime(NOW);
  });

  // ── Happy path: percentage ─────────────────────────────────────────────────

  it('applies 20% discount to 98000 haléřů → discountHalire = 19600', async () => {
    const db = createMockDb(makePromoCodeRow({ type: 'percentage', discount_value: 20 }));

    const result = await applyPromoCode(BASE_INPUT, db);

    expect(result.applied).toBe(true);
    expect(result.discountHalire).toBe(19600); // floor(98000 * 20 / 100)
    expect(result.newTotalHalire).toBe(78400);
    expect(result.promoCodeId).toBe('pc-1');
    expect(Number.isInteger(result.discountHalire)).toBe(true);
    expect(Number.isInteger(result.newTotalHalire)).toBe(true);
  });

  it('percentage discount uses Math.floor (rounds down to whole haléře)', async () => {
    // 20% of 333 = 66.6 → floor = 66
    const db = createMockDb(makePromoCodeRow({ type: 'percentage', discount_value: 20 }));
    const result = await applyPromoCode(
      { ...BASE_INPUT, orderTotalHalire: 333, orderItems: [{ ticketTypeId: 'tt-1', quantity: 1, unitPriceHalire: 333 }] },
      db,
    );

    expect(result.discountHalire).toBe(66);
    expect(Number.isInteger(result.discountHalire)).toBe(true);
  });

  // ── Happy path: fixed ──────────────────────────────────────────────────────

  it('applies fixed 10000 haléřů discount to 98000 → newTotal = 88000', async () => {
    const db = createMockDb(makePromoCodeRow({ type: 'fixed', discount_value: 10000 }));

    const result = await applyPromoCode(BASE_INPUT, db);

    expect(result.applied).toBe(true);
    expect(result.discountHalire).toBe(10000);
    expect(result.newTotalHalire).toBe(88000);
    expect(Number.isInteger(result.discountHalire)).toBe(true);
  });

  it('fixed discount larger than order total is capped — no negative total', async () => {
    const db = createMockDb(makePromoCodeRow({ type: 'fixed', discount_value: 200000 }));
    const input = { ...BASE_INPUT, orderTotalHalire: 5000, orderItems: [{ ticketTypeId: 'tt-1', quantity: 1, unitPriceHalire: 5000 }] };

    const result = await applyPromoCode(input, db);

    expect(result.applied).toBe(true);
    expect(result.discountHalire).toBe(5000); // capped at order total
    expect(result.newTotalHalire).toBe(0);
    expect(result.newTotalHalire).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(result.discountHalire)).toBe(true);
  });

  // ── Invalid: code not found ────────────────────────────────────────────────

  it('returns applied=false when promo code does not exist', async () => {
    const db = createMockDb(null);

    const result = await applyPromoCode(BASE_INPUT, db);

    expect(result.applied).toBe(false);
    expect(result.discountHalire).toBe(0);
    expect(result.newTotalHalire).toBe(BASE_INPUT.orderTotalHalire);
    expect(result.promoCodeId).toBeNull();
    expect(result.reasonCode).toBe('CODE_NOT_FOUND');
  });

  // ── Invalid: expired ───────────────────────────────────────────────────────

  it('returns applied=false with CODE_EXPIRED when valid_until is in the past', async () => {
    const db = createMockDb(
      makePromoCodeRow({ valid_until: new Date('2025-01-01T00:00:00Z') }),
    );

    const result = await applyPromoCode(BASE_INPUT, db);

    expect(result.applied).toBe(false);
    expect(result.reasonCode).toBe('CODE_EXPIRED');
    expect(result.discountHalire).toBe(0);
  });

  // ── Invalid: not yet active ────────────────────────────────────────────────

  it('returns applied=false with CODE_NOT_YET_ACTIVE when valid_from is in the future', async () => {
    const db = createMockDb(
      makePromoCodeRow({ valid_from: new Date('2027-01-01T00:00:00Z') }),
    );

    const result = await applyPromoCode(BASE_INPUT, db);

    expect(result.applied).toBe(false);
    expect(result.reasonCode).toBe('CODE_NOT_YET_ACTIVE');
  });

  // ── Invalid: used up ───────────────────────────────────────────────────────

  it('returns applied=false with CODE_USED_UP when uses_count >= max_uses', async () => {
    const db = createMockDb(
      makePromoCodeRow({ max_uses: 10, uses_count: 10 }),
    );

    const result = await applyPromoCode(BASE_INPUT, db);

    expect(result.applied).toBe(false);
    expect(result.reasonCode).toBe('CODE_USED_UP');
    expect(result.discountHalire).toBe(0);
  });

  it('still applies when uses_count is one below max_uses', async () => {
    const db = createMockDb(
      makePromoCodeRow({ max_uses: 10, uses_count: 9 }),
    );

    const result = await applyPromoCode(BASE_INPUT, db);

    expect(result.applied).toBe(true);
  });

  // ── Invalid: per-user limit exceeded ──────────────────────────────────────

  it('returns applied=false with PER_USER_LIMIT_EXCEEDED when user already used it', async () => {
    const db = createMockDb(
      makePromoCodeRow({ max_uses_per_user: 1 }),
      [{ cnt: '1' }], // user already used it once
    );

    const result = await applyPromoCode(BASE_INPUT, db);

    expect(result.applied).toBe(false);
    expect(result.reasonCode).toBe('PER_USER_LIMIT_EXCEEDED');
  });

  it('applies when user usage count is one below per-user limit', async () => {
    const db = createMockDb(
      makePromoCodeRow({ max_uses_per_user: 3 }),
      [{ cnt: '2' }],
    );

    const result = await applyPromoCode(BASE_INPUT, db);

    expect(result.applied).toBe(true);
  });

  // ── Invalid: event not eligible ────────────────────────────────────────────

  it('returns applied=false with EVENT_NOT_ELIGIBLE when code is scoped to different event', async () => {
    const db = createMockDb(
      makePromoCodeRow({ applicable_event_ids: ['event-OTHER'] }),
    );

    const result = await applyPromoCode(BASE_INPUT, db);

    expect(result.applied).toBe(false);
    expect(result.reasonCode).toBe('EVENT_NOT_ELIGIBLE');
  });

  it('applies when eventId is in applicable_event_ids', async () => {
    const db = createMockDb(
      makePromoCodeRow({ applicable_event_ids: ['event-1', 'event-2'] }),
    );

    const result = await applyPromoCode(BASE_INPUT, db);

    expect(result.applied).toBe(true);
  });

  it('applies when applicable_event_ids is null (all events)', async () => {
    const db = createMockDb(
      makePromoCodeRow({ applicable_event_ids: null }),
    );

    const result = await applyPromoCode(BASE_INPUT, db);

    expect(result.applied).toBe(true);
  });

  // ── Invalid: ticket type not eligible ─────────────────────────────────────

  it('returns applied=false with TICKET_TYPE_NOT_ELIGIBLE when no matching type', async () => {
    const db = createMockDb(
      makePromoCodeRow({ applicable_ticket_type_ids: ['tt-PREMIUM'] }),
    );
    const input = { ...BASE_INPUT, ticketTypeIds: ['tt-STANDARD'] };

    const result = await applyPromoCode(input, db);

    expect(result.applied).toBe(false);
    expect(result.reasonCode).toBe('TICKET_TYPE_NOT_ELIGIBLE');
  });

  // ── Invalid: minimum order not met ────────────────────────────────────────

  it('returns applied=false with MIN_ORDER_NOT_MET when order total is too low', async () => {
    const db = createMockDb(
      makePromoCodeRow({ min_order_amount: 200000 }), // 2000 Kč minimum
    );
    const input = { ...BASE_INPUT, orderTotalHalire: 98000 }; // only 980 Kč

    const result = await applyPromoCode(input, db);

    expect(result.applied).toBe(false);
    expect(result.reasonCode).toBe('MIN_ORDER_NOT_MET');
  });

  it('applies when order total exactly meets min_order_amount', async () => {
    const db = createMockDb(
      makePromoCodeRow({ min_order_amount: 98000 }),
    );

    const result = await applyPromoCode(BASE_INPUT, db);

    expect(result.applied).toBe(true);
  });

  // ── Invalid: inactive code ─────────────────────────────────────────────────

  it('returns applied=false with CODE_INACTIVE when code is inactive', async () => {
    const db = createMockDb(makePromoCodeRow({ active: false }));

    const result = await applyPromoCode(BASE_INPUT, db);

    expect(result.applied).toBe(false);
    expect(result.reasonCode).toBe('CODE_INACTIVE');
  });

  // ── DB side effects on success ─────────────────────────────────────────────

  it('increments uses_count and inserts a usage row on successful redemption', async () => {
    const db = createMockDb(makePromoCodeRow());

    await applyPromoCode(BASE_INPUT, db);

    const updateSql = db.executedSqls.find((s) => s.includes('uses_count = uses_count + 1'));
    expect(updateSql).toBeTruthy();

    const insertSql = db.executedSqls.find((s) => s.includes('promo_code_usages'));
    expect(insertSql).toBeTruthy();

    // Verify discount_halire was recorded in the usage insert
    const insertIdx = db.executedSqls.indexOf(insertSql!);
    const insertParams = db.executedParams[insertIdx];
    // params: [id, promo_code_id, order_id, user_id, discount_halire]
    const recordedDiscount = insertParams[4];
    expect(typeof recordedDiscount).toBe('number');
    expect(Number.isInteger(recordedDiscount as number)).toBe(true);
    expect(recordedDiscount).toBe(19600); // 20% of 98000
  });

  it('does NOT increment uses_count or insert usage when code is invalid', async () => {
    const db = createMockDb(makePromoCodeRow({ active: false }));

    await applyPromoCode(BASE_INPUT, db);

    expect(db.executedSqls).toHaveLength(0);
  });

  // ── Race condition: FOR UPDATE ─────────────────────────────────────────────

  it('issues SELECT … FOR UPDATE to lock the promo code row', async () => {
    const querySqls: string[] = [];
    const db: DbAdapter = {
      async query<T>(sql: string, _params?: unknown[]): Promise<T[]> {
        querySqls.push(sql);
        if (sql.includes('promo_code_usages') && sql.includes('COUNT')) {
          return [{ cnt: '0' }] as unknown as T[];
        }
        return [makePromoCodeRow()] as unknown as T[];
      },
      async execute() {},
      async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
        return fn(this);
      },
    };

    await applyPromoCode(BASE_INPUT, db);

    const lockQuery = querySqls.find((s) => s.includes('FOR UPDATE'));
    expect(lockQuery).toBeTruthy();
  });

  // ── Integer invariants ─────────────────────────────────────────────────────

  it('all result amounts are integers (no floats)', async () => {
    const db = createMockDb(makePromoCodeRow({ type: 'percentage', discount_value: 33 }));
    // 33% of 98000 = 32340 exactly (integer)
    const result = await applyPromoCode(BASE_INPUT, db);

    expect(Number.isInteger(result.discountHalire)).toBe(true);
    expect(Number.isInteger(result.newTotalHalire)).toBe(true);
  });

  it('discountHalire is always >= 0 (no negative discounts)', async () => {
    const db = createMockDb(makePromoCodeRow({ type: 'fixed', discount_value: 0 }));
    const result = await applyPromoCode({ ...BASE_INPUT, orderTotalHalire: 0, orderItems: [{ ticketTypeId: 'tt-1', quantity: 1, unitPriceHalire: 0 }] }, db);

    expect(result.discountHalire).toBeGreaterThanOrEqual(0);
    expect(result.newTotalHalire).toBeGreaterThanOrEqual(0);
  });

  // ── Code is normalised to uppercase ───────────────────────────────────────

  it('normalises code to uppercase before DB lookup', async () => {
    const queriedCodes: unknown[] = [];
    const db: DbAdapter = {
      async query<T>(_sql: string, params?: unknown[]): Promise<T[]> {
        if (_sql.includes('promo_code_usages')) return [{ cnt: '0' }] as unknown as T[];
        queriedCodes.push(params?.[0]);
        return [makePromoCodeRow()] as unknown as T[];
      },
      async execute() {},
      async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
        return fn(this);
      },
    };

    await applyPromoCode({ ...BASE_INPUT, code: 'save20' }, db);

    expect(queriedCodes[0]).toBe('SAVE20');
  });

  // ── bogo discount ──────────────────────────────────────────────────────────

  it('calculates bogo discount: 4 tickets × 49000 → 2 free → discount = 98000', async () => {
    const db = createMockDb(makePromoCodeRow({ type: 'bogo', discount_value: 0 }));
    const result = await applyPromoCode({
      ...BASE_INPUT,
      orderTotalHalire: 196000,
      orderItems: [{ ticketTypeId: 'tt-1', quantity: 4, unitPriceHalire: 49000 }],
    }, db);

    expect(result.applied).toBe(true);
    expect(result.discountHalire).toBe(98000); // floor(4/2) = 2 free × 49000
    expect(result.newTotalHalire).toBe(98000);
    expect(Number.isInteger(result.discountHalire)).toBe(true);
  });

  // ── free discount ──────────────────────────────────────────────────────────

  it('free type makes all items free', async () => {
    const db = createMockDb(makePromoCodeRow({ type: 'free', discount_value: 0 }));
    const result = await applyPromoCode(BASE_INPUT, db);

    expect(result.applied).toBe(true);
    expect(result.newTotalHalire).toBe(0);
    expect(result.discountHalire).toBe(BASE_INPUT.orderTotalHalire);
  });
});
