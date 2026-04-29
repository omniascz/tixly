import { describe, it, expect, vi } from 'vitest';
import type { DbAdapter } from '../types/vendor-marketplace.types.js';
import { VendorMarketplaceError } from '../types/vendor-marketplace.types.js';
import {
  registerVendor,
  approveVendor,
  suspendVendor,
  createAddon,
  publishAddon,
  getAvailableAddons,
  purchaseAddon,
  cancelOrderAddon,
  getVendorPayoutSummary,
} from '../services/vendor-marketplace.service.js';

// ─── fixtures ─────────────────────────────────────────────────────────────────

const NOW = new Date('2026-04-15T12:00:00Z');

function makeVendorRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'vendor-1',
    name: 'Parkoviste Praha',
    email: 'parking@example.com',
    category: 'parking',
    status: 'approved',
    commission_rate_bps: 1000,
    api_key: 'key-abc',
    created_at: NOW,
    ...overrides,
  };
}

function makeAddonRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'addon-1',
    vendor_id: 'vendor-1',
    event_id: 'event-1',
    name: 'Parkoviste VIP',
    description: 'Vyhrazene misto',
    category: 'parking',
    price_czk: 20000,
    max_quantity: 100,
    sold_quantity: 0,
    status: 'active',
    image_url: null,
    available_from: null,
    available_until: null,
    ...overrides,
  };
}

function makeOrderAddonRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'oa-1',
    order_id: 'order-1',
    addon_id: 'addon-1',
    vendor_id: 'vendor-1',
    quantity: 1,
    unit_price_czk: 20000,
    total_price_czk: 20000,
    commission_czk: 2000,
    vendor_payout_czk: 18000,
    status: 'confirmed',
    purchased_at: NOW,
    ...overrides,
  };
}

function makeDb(queryImpl?: (sql: string, params?: unknown[]) => Promise<unknown[]>): DbAdapter {
  const queryMock = vi.fn(queryImpl ?? (async () => []));
  const executeMock = vi.fn(async () => undefined);
  const transactionMock = vi.fn(async (fn: (db: DbAdapter) => Promise<unknown>) =>
    fn({ query: queryMock as DbAdapter['query'], execute: executeMock, transaction: transactionMock }),
  );
  return {
    query: queryMock as DbAdapter['query'],
    execute: executeMock,
    transaction: transactionMock,
  };
}

// ─── registerVendor ───────────────────────────────────────────────────────────

describe('registerVendor', () => {
  it('inserts vendor with pending_approval and returns mapped vendor', async () => {
    const vendorRow = makeVendorRow({ status: 'pending_approval', api_key: 'some-key' });
    const db = makeDb(async () => [vendorRow]);

    const result = await registerVendor(
      { name: 'Parkoviste Praha', email: 'parking@example.com', category: 'parking' },
      { db, now: () => NOW },
    );

    expect(result.status).toBe('pending_approval');
    expect(result.name).toBe('Parkoviste Praha');
    expect(result.commissionRateBps).toBe(1000);
    const executeMock = db.execute as ReturnType<typeof vi.fn>;
    expect(executeMock).toHaveBeenCalledOnce();
    const [sql, params] = executeMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO vendors');
    expect(params).toContain('pending_approval');
  });

  it('uses default commissionRateBps of 1000 when not provided', async () => {
    const vendorRow = makeVendorRow({ status: 'pending_approval', commission_rate_bps: 1000 });
    const db = makeDb(async () => [vendorRow]);

    const result = await registerVendor(
      { name: 'Test', email: 'test@example.com', category: 'food_beverage' },
      { db, now: () => NOW },
    );

    expect(result.commissionRateBps).toBe(1000);
    const [, params] = (db.execute as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
    expect(params).toContain(1000);
  });

  it('uses custom commissionRateBps when provided', async () => {
    const vendorRow = makeVendorRow({ status: 'pending_approval', commission_rate_bps: 1500 });
    const db = makeDb(async () => [vendorRow]);

    const result = await registerVendor(
      { name: 'Test', email: 'test@example.com', category: 'merchandise', commissionRateBps: 1500 },
      { db, now: () => NOW },
    );

    expect(result.commissionRateBps).toBe(1500);
    const [, params] = (db.execute as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
    expect(params).toContain(1500);
  });

  it('generates non-null apiKey during registration', async () => {
    const vendorRow = makeVendorRow({ status: 'pending_approval', api_key: 'generated-key' });
    const db = makeDb(async () => [vendorRow]);

    const result = await registerVendor(
      { name: 'Test', email: 'test@example.com', category: 'transport' },
      { db, now: () => NOW },
    );

    expect(result.apiKey).not.toBeNull();
  });
});

// ─── approveVendor ────────────────────────────────────────────────────────────

describe('approveVendor', () => {
  it('sets vendor status to approved', async () => {
    const pendingRow = makeVendorRow({ status: 'pending_approval' });
    const approvedRow = makeVendorRow({ status: 'approved' });
    const queryMock = vi.fn()
      .mockResolvedValueOnce([pendingRow])
      .mockResolvedValueOnce([approvedRow]);
    const executeMock = vi.fn(async () => undefined);
    const db: DbAdapter = { query: queryMock as DbAdapter['query'], execute: executeMock, transaction: vi.fn() };

    const result = await approveVendor('vendor-1', { db });

    expect(result.status).toBe('approved');
    expect(executeMock).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE vendors'),
      expect.arrayContaining(['approved', 'vendor-1']),
    );
  });

  it('throws VENDOR_NOT_FOUND when vendor does not exist', async () => {
    const db: DbAdapter = {
      query: vi.fn(async () => []),
      execute: vi.fn(async () => undefined),
      transaction: vi.fn(),
    };

    await expect(approveVendor('nonexistent', { db })).rejects.toMatchObject({ code: 'VENDOR_NOT_FOUND' });
    await expect(approveVendor('nonexistent', { db })).rejects.toBeInstanceOf(VendorMarketplaceError);
  });
});

// ─── suspendVendor ────────────────────────────────────────────────────────────

describe('suspendVendor', () => {
  it('sets vendor status to suspended', async () => {
    const approvedRow = makeVendorRow({ status: 'approved' });
    const suspendedRow = makeVendorRow({ status: 'suspended' });
    const queryMock = vi.fn()
      .mockResolvedValueOnce([approvedRow])
      .mockResolvedValueOnce([suspendedRow]);
    const executeMock = vi.fn(async () => undefined);
    const db: DbAdapter = { query: queryMock as DbAdapter['query'], execute: executeMock, transaction: vi.fn() };

    const result = await suspendVendor('vendor-1', 'terms violation', { db });

    expect(result.status).toBe('suspended');
    expect(executeMock).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE vendors'),
      expect.arrayContaining(['suspended', 'vendor-1']),
    );
  });

  it('throws VENDOR_NOT_FOUND when vendor does not exist', async () => {
    const db: DbAdapter = {
      query: vi.fn(async () => []),
      execute: vi.fn(async () => undefined),
      transaction: vi.fn(),
    };

    await expect(suspendVendor('nonexistent', 'reason', { db })).rejects.toMatchObject({ code: 'VENDOR_NOT_FOUND' });
  });
});

// ─── createAddon ──────────────────────────────────────────────────────────────

describe('createAddon', () => {
  const addonInput = {
    vendorId: 'vendor-1',
    eventId: 'event-1',
    name: 'Parkoviste VIP',
    description: 'Vyhrazene misto',
    category: 'parking' as const,
    priceCzk: 20000,
  };

  it('creates addon with draft status when vendor is approved', async () => {
    const vendorRow = makeVendorRow({ status: 'approved' });
    const addonRow = makeAddonRow({ status: 'draft', sold_quantity: 0 });
    const queryMock = vi.fn()
      .mockResolvedValueOnce([vendorRow])
      .mockResolvedValueOnce([addonRow]);
    const executeMock = vi.fn(async () => undefined);
    const db: DbAdapter = { query: queryMock as DbAdapter['query'], execute: executeMock, transaction: vi.fn() };

    const result = await createAddon(addonInput, { db });

    expect(result.status).toBe('draft');
    expect(result.soldQuantity).toBe(0);
    expect(executeMock).toHaveBeenCalledOnce();
    const [sql] = executeMock.mock.calls[0] as [string];
    expect(sql).toContain('INSERT INTO addons');
  });

  it('throws VENDOR_NOT_APPROVED when vendor is pending_approval', async () => {
    const pendingRow = makeVendorRow({ status: 'pending_approval' });
    const db: DbAdapter = {
      query: vi.fn(async () => [pendingRow]),
      execute: vi.fn(async () => undefined),
      transaction: vi.fn(),
    };

    await expect(createAddon(addonInput, { db })).rejects.toMatchObject({ code: 'VENDOR_NOT_APPROVED' });
  });

  it('throws VENDOR_NOT_APPROVED when vendor is suspended', async () => {
    const suspendedRow = makeVendorRow({ status: 'suspended' });
    const db: DbAdapter = {
      query: vi.fn(async () => [suspendedRow]),
      execute: vi.fn(async () => undefined),
      transaction: vi.fn(),
    };

    await expect(createAddon(addonInput, { db })).rejects.toMatchObject({ code: 'VENDOR_NOT_APPROVED' });
  });

  it('throws VENDOR_NOT_FOUND when vendor does not exist', async () => {
    const db: DbAdapter = {
      query: vi.fn(async () => []),
      execute: vi.fn(async () => undefined),
      transaction: vi.fn(),
    };

    await expect(createAddon({ ...addonInput, vendorId: 'nonexistent' }, { db })).rejects.toMatchObject({ code: 'VENDOR_NOT_FOUND' });
  });
});

// ─── publishAddon ─────────────────────────────────────────────────────────────

describe('publishAddon', () => {
  it('sets addon status to active', async () => {
    const draftRow = makeAddonRow({ status: 'draft' });
    const activeRow = makeAddonRow({ status: 'active' });
    const queryMock = vi.fn()
      .mockResolvedValueOnce([draftRow])
      .mockResolvedValueOnce([activeRow]);
    const executeMock = vi.fn(async () => undefined);
    const db: DbAdapter = { query: queryMock as DbAdapter['query'], execute: executeMock, transaction: vi.fn() };

    const result = await publishAddon('addon-1', 'vendor-1', { db });

    expect(result.status).toBe('active');
    expect(executeMock).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE addons'),
      expect.arrayContaining(['active', 'addon-1']),
    );
  });

  it('throws ADDON_NOT_FOUND when addon does not exist for vendor', async () => {
    const db: DbAdapter = {
      query: vi.fn(async () => []),
      execute: vi.fn(async () => undefined),
      transaction: vi.fn(),
    };

    await expect(publishAddon('nonexistent', 'vendor-1', { db })).rejects.toMatchObject({ code: 'ADDON_NOT_FOUND' });
  });
});

// ─── getAvailableAddons ───────────────────────────────────────────────────────

describe('getAvailableAddons', () => {
  it('returns active addons for the event', async () => {
    const addonRow = makeAddonRow({ status: 'active' });
    const db = makeDb(async () => [addonRow]);

    const result = await getAvailableAddons('event-1', { db, now: () => NOW });

    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe('active');
    const [sql] = (db.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("status = 'active'");
    expect(sql).toContain('available_from');
    expect(sql).toContain('available_until');
  });

  it('returns empty array when no active addons found', async () => {
    const db = makeDb(async () => []);

    const result = await getAvailableAddons('event-1', { db, now: () => NOW });

    expect(result).toHaveLength(0);
  });

  it('passes now timestamp as query parameter for availability window', async () => {
    const customNow = new Date('2026-06-01T10:00:00Z');
    const addonRow = makeAddonRow({ available_from: new Date('2026-05-01'), available_until: new Date('2026-07-01') });
    const db = makeDb(async () => [addonRow]);

    await getAvailableAddons('event-1', { db, now: () => customNow });

    const [, params] = (db.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
    expect(params).toContain(customNow);
  });
});

// ─── purchaseAddon ────────────────────────────────────────────────────────────

describe('purchaseAddon', () => {
  function makeTxDb(calls: unknown[][]) {
    let callIdx = 0;
    const queryMock = vi.fn(async () => calls[callIdx++] ?? []);
    const executeMock = vi.fn(async () => undefined);
    const txDb: DbAdapter = { query: queryMock as DbAdapter['query'], execute: executeMock, transaction: vi.fn() };
    const db: DbAdapter = {
      query: queryMock as DbAdapter['query'],
      execute: executeMock,
      transaction: vi.fn(async (fn) => fn(txDb)),
    };
    return { db, queryMock, executeMock };
  }

  it('successfully purchases addon and returns OrderAddon', async () => {
    const addonRow = makeAddonRow({ sold_quantity: 0, max_quantity: 100, status: 'active' });
    const vendorRow = makeVendorRow({ commission_rate_bps: 1000 });
    const orderAddonRow = makeOrderAddonRow();
    const { db } = makeTxDb([[addonRow], [vendorRow], [orderAddonRow]]);

    const result = await purchaseAddon(
      { orderId: 'order-1', addonId: 'addon-1', quantity: 1 },
      { db, now: () => NOW },
    );

    expect(result.status).toBe('confirmed');
    expect(result.totalPriceCzk).toBe(20000);
    expect(result.commissionCzk).toBe(2000);
    expect(result.vendorPayoutCzk).toBe(18000);
  });

  it('calculates commission correctly for 15% rate', async () => {
    const addonRow = makeAddonRow({ sold_quantity: 0, max_quantity: null, status: 'active', price_czk: 10000 });
    const vendorRow = makeVendorRow({ commission_rate_bps: 1500 });
    const orderAddonRow = makeOrderAddonRow({ total_price_czk: 10000, commission_czk: 1500, vendor_payout_czk: 8500 });
    const { db, executeMock } = makeTxDb([[addonRow], [vendorRow], [orderAddonRow]]);

    await purchaseAddon({ orderId: 'order-1', addonId: 'addon-1', quantity: 1 }, { db, now: () => NOW });

    // commission = 10000 * 1500 / 10000 = 1500
    const insertCall = executeMock.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO order_addons'),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall?.[1]).toContain(1500); // commission
    expect(insertCall?.[1]).toContain(8500); // payout
  });

  it('throws ADDON_NOT_FOUND when addon does not exist', async () => {
    const { db } = makeTxDb([[]]);

    await expect(purchaseAddon(
      { orderId: 'order-1', addonId: 'nonexistent', quantity: 1 },
      { db, now: () => NOW },
    )).rejects.toMatchObject({ code: 'ADDON_NOT_FOUND' });
  });

  it('throws ADDON_NOT_ACTIVE when addon is draft', async () => {
    const draftRow = makeAddonRow({ status: 'draft' });
    const { db } = makeTxDb([[draftRow]]);

    await expect(purchaseAddon(
      { orderId: 'order-1', addonId: 'addon-1', quantity: 1 },
      { db, now: () => NOW },
    )).rejects.toMatchObject({ code: 'ADDON_NOT_ACTIVE' });
  });

  it('throws ADDON_NOT_ACTIVE when addon is sold_out', async () => {
    const soldOutRow = makeAddonRow({ status: 'sold_out', sold_quantity: 100, max_quantity: 100 });
    const { db } = makeTxDb([[soldOutRow]]);

    await expect(purchaseAddon(
      { orderId: 'order-1', addonId: 'addon-1', quantity: 1 },
      { db, now: () => NOW },
    )).rejects.toMatchObject({ code: 'ADDON_NOT_ACTIVE' });
  });

  it('throws INSUFFICIENT_STOCK when quantity exceeds remaining stock', async () => {
    const addonRow = makeAddonRow({ sold_quantity: 95, max_quantity: 100, status: 'active' });
    const { db } = makeTxDb([[addonRow]]);

    await expect(purchaseAddon(
      { orderId: 'order-1', addonId: 'addon-1', quantity: 10 },
      { db, now: () => NOW },
    )).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
  });

  it('allows purchase when maxQuantity is null (unlimited)', async () => {
    const addonRow = makeAddonRow({ sold_quantity: 9999, max_quantity: null, status: 'active' });
    const vendorRow = makeVendorRow();
    const orderAddonRow = makeOrderAddonRow({ quantity: 100 });
    const { db } = makeTxDb([[addonRow], [vendorRow], [orderAddonRow]]);

    const result = await purchaseAddon({ orderId: 'order-1', addonId: 'addon-1', quantity: 100 }, { db, now: () => NOW });

    expect(result).toBeDefined();
  });

  it('throws ADDON_NOT_AVAILABLE when current time is before availableFrom', async () => {
    const future = new Date('2026-05-01T00:00:00Z');
    const addonRow = makeAddonRow({ status: 'active', available_from: future, available_until: null });
    const { db } = makeTxDb([[addonRow]]);

    await expect(purchaseAddon(
      { orderId: 'order-1', addonId: 'addon-1', quantity: 1 },
      { db, now: () => NOW }, // 2026-04-15 < 2026-05-01
    )).rejects.toMatchObject({ code: 'ADDON_NOT_AVAILABLE' });
  });

  it('throws ADDON_NOT_AVAILABLE when current time is after availableUntil', async () => {
    const past = new Date('2026-03-01T00:00:00Z');
    const addonRow = makeAddonRow({ status: 'active', available_from: null, available_until: past });
    const { db } = makeTxDb([[addonRow]]);

    await expect(purchaseAddon(
      { orderId: 'order-1', addonId: 'addon-1', quantity: 1 },
      { db, now: () => NOW }, // 2026-04-15 > 2026-03-01
    )).rejects.toMatchObject({ code: 'ADDON_NOT_AVAILABLE' });
  });

  it('transitions addon to sold_out when last stock unit is purchased', async () => {
    const addonRow = makeAddonRow({ sold_quantity: 99, max_quantity: 100, status: 'active' });
    const vendorRow = makeVendorRow();
    const orderAddonRow = makeOrderAddonRow();
    const { db, executeMock } = makeTxDb([[addonRow], [vendorRow], [orderAddonRow]]);

    await purchaseAddon({ orderId: 'order-1', addonId: 'addon-1', quantity: 1 }, { db, now: () => NOW });

    const updateCall = executeMock.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE addons'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall?.[1]).toContain('sold_out');
    expect(updateCall?.[1]).toContain(100); // soldQuantity = 99 + 1
  });
});

// ─── cancelOrderAddon ─────────────────────────────────────────────────────────

describe('cancelOrderAddon', () => {
  it('sets status to cancelled and decrements soldQuantity', async () => {
    const orderAddonRow = makeOrderAddonRow({ status: 'confirmed', quantity: 2 });
    const addonRow = makeAddonRow({ sold_quantity: 10, status: 'active' });
    const cancelledRow = makeOrderAddonRow({ status: 'cancelled' });
    const queryMock = vi.fn()
      .mockResolvedValueOnce([orderAddonRow])
      .mockResolvedValueOnce([addonRow])
      .mockResolvedValueOnce([cancelledRow]);
    const executeMock = vi.fn(async () => undefined);
    const db: DbAdapter = { query: queryMock as DbAdapter['query'], execute: executeMock, transaction: vi.fn() };

    const result = await cancelOrderAddon('oa-1', { db });

    expect(result.status).toBe('cancelled');
    const statusUpdate = executeMock.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE order_addons'),
    );
    expect(statusUpdate?.[1]).toContain('cancelled');
    const addonUpdate = executeMock.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE addons'),
    );
    expect(addonUpdate?.[1]).toContain(8); // 10 - 2 = 8
  });

  it('reactivates sold_out addon to active on cancellation', async () => {
    const orderAddonRow = makeOrderAddonRow({ status: 'confirmed', quantity: 1 });
    const addonRow = makeAddonRow({ sold_quantity: 100, max_quantity: 100, status: 'sold_out' });
    const cancelledRow = makeOrderAddonRow({ status: 'cancelled' });
    const queryMock = vi.fn()
      .mockResolvedValueOnce([orderAddonRow])
      .mockResolvedValueOnce([addonRow])
      .mockResolvedValueOnce([cancelledRow]);
    const executeMock = vi.fn(async () => undefined);
    const db: DbAdapter = { query: queryMock as DbAdapter['query'], execute: executeMock, transaction: vi.fn() };

    await cancelOrderAddon('oa-1', { db });

    const addonUpdate = executeMock.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE addons'),
    );
    expect(addonUpdate?.[1]).toContain('active');
    expect(addonUpdate?.[1]).toContain(99); // 100 - 1
  });

  it('throws ORDER_ADDON_NOT_FOUND when order addon does not exist', async () => {
    const db: DbAdapter = {
      query: vi.fn(async () => []),
      execute: vi.fn(async () => undefined),
      transaction: vi.fn(),
    };

    await expect(cancelOrderAddon('nonexistent', { db })).rejects.toMatchObject({ code: 'ORDER_ADDON_NOT_FOUND' });
  });
});

// ─── getVendorPayoutSummary ───────────────────────────────────────────────────

describe('getVendorPayoutSummary', () => {
  it('returns payout summary aggregated from order_addons', async () => {
    const payoutRow = {
      vendor_id: 'vendor-1',
      event_id: 'event-1',
      total_revenue_czk: 100000,
      total_commission_czk: 10000,
      vendor_payout_czk: 90000,
      order_count: 5,
    };
    const db = makeDb(async () => [payoutRow]);

    const result = await getVendorPayoutSummary('vendor-1', 'event-1', { db });

    expect(result.vendorId).toBe('vendor-1');
    expect(result.eventId).toBe('event-1');
    expect(result.totalRevenueCzk).toBe(100000);
    expect(result.totalCommissionCzk).toBe(10000);
    expect(result.vendorPayoutCzk).toBe(90000);
    expect(result.orderCount).toBe(5);
  });

  it('returns zero-filled summary when no orders exist', async () => {
    const db = makeDb(async () => []);

    const result = await getVendorPayoutSummary('vendor-1', 'event-1', { db });

    expect(result.totalRevenueCzk).toBe(0);
    expect(result.totalCommissionCzk).toBe(0);
    expect(result.vendorPayoutCzk).toBe(0);
    expect(result.orderCount).toBe(0);
  });

  it('passes vendorId and eventId as query parameters', async () => {
    const db = makeDb(async () => []);

    await getVendorPayoutSummary('vendor-42', 'event-99', { db });

    const [, params] = (db.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
    expect(params).toContain('vendor-42');
    expect(params).toContain('event-99');
  });

  it('converts string numbers from DB to number type', async () => {
    const payoutRow = {
      vendor_id: 'vendor-1',
      event_id: 'event-1',
      total_revenue_czk: '50000',
      total_commission_czk: '5000',
      vendor_payout_czk: '45000',
      order_count: '3',
    };
    const db = makeDb(async () => [payoutRow]);

    const result = await getVendorPayoutSummary('vendor-1', 'event-1', { db });

    expect(typeof result.totalRevenueCzk).toBe('number');
    expect(result.totalRevenueCzk).toBe(50000);
    expect(result.orderCount).toBe(3);
  });
});
