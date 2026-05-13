import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getActiveFeeSchedule,
  calculateOrderFee,
  applyFeeToOrder,
  createFeeSchedule,
  deactivateFeeSchedule,
  listFeeSchedules,
  getPlatformRevenueSummary,
  assignPromoterTier,
  getPromoterTier,
  getFeeScheduleAuditLog,
} from '../services/fee.service';
import { FeeError } from '../lib/fee-errors';
import type { DbAdapter, ServiceDeps } from '../lib/service-container';

// ---------------------------------------------------------------------------
// Mock DbAdapter factory
// ---------------------------------------------------------------------------
function makeMockDb(overrides: Partial<DbAdapter> = {}): DbAdapter {
  return {
    query: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation(async (fn: (tx: DbAdapter) => Promise<unknown>) => {
      return fn(makeMockDb(overrides));
    }),
    ...overrides,
  };
}

function makeDeps(db: DbAdapter): ServiceDeps {
  return { db };
}

// ---------------------------------------------------------------------------
// Fixture: platný DB řádek fee schedule
// ---------------------------------------------------------------------------
function makeFeeScheduleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sch-0000-0000-0000-000000000001',
    promoter_id: 'prm-0000-0000-0000-000000000001',
    name: 'default',
    percentage_fee: 500,
    fixed_fee: 0,
    min_fee: null,
    max_fee: null,
    valid_from: '2025-01-01T00:00:00.000Z',
    valid_until: null,
    is_active: true,
    created_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getActiveFeeSchedule
// ---------------------------------------------------------------------------
describe('getActiveFeeSchedule', () => {
  it('vrátí mapovaný FeeSchedule pro existujícího promotéra', async () => {
    const row = makeFeeScheduleRow();
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([row]) });
    const schedule = await getActiveFeeSchedule('prm-0000-0000-0000-000000000001', makeDeps(db));
    expect(schedule.id).toBe(row.id);
    expect(schedule.promoterId).toBe(row.promoter_id);
    expect(schedule.percentageFee).toBe(500);
    expect(schedule.isActive).toBe(true);
  });

  it('vyhodí NO_ACTIVE_SCHEDULE pokud promotér nemá žádný schedule', async () => {
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([]) });
    await expect(getActiveFeeSchedule('prm-neznamy', makeDeps(db))).rejects.toMatchObject({
      code: 'NO_ACTIVE_SCHEDULE',
    });
  });

  it('vyhodí NO_ACTIVE_SCHEDULE pro expirovaný schedule (vrátí prázdné pole)', async () => {
    // DB vrátí prázdné — expired schedule filtruje SQL klauzule valid_until > NOW()
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([]) });
    await expect(
      getActiveFeeSchedule('prm-0000-0000-0000-000000000001', makeDeps(db)),
    ).rejects.toBeInstanceOf(FeeError);
  });

  it('vyhodí NO_ACTIVE_SCHEDULE pokud valid_from je v budoucnosti (prázdný výsledek)', async () => {
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([]) });
    await expect(
      getActiveFeeSchedule('prm-future', makeDeps(db)),
    ).rejects.toMatchObject({ code: 'NO_ACTIVE_SCHEDULE' });
  });

  it('pokud existuje více schedules, vrátí první (DB ORDER BY valid_from DESC LIMIT 1)', async () => {
    // Simulujeme, že DB správně vrátí jen jeden — nejnovější
    const newest = makeFeeScheduleRow({ id: 'sch-newest', valid_from: '2026-01-01T00:00:00.000Z' });
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([newest]) });
    const schedule = await getActiveFeeSchedule('prm-0000-0000-0000-000000000001', makeDeps(db));
    expect(schedule.id).toBe('sch-newest');
  });
});

// ---------------------------------------------------------------------------
// calculateOrderFee
// ---------------------------------------------------------------------------
describe('calculateOrderFee', () => {
  it('vrátí korektní OrderFeeResult pro objednávku s více položkami', async () => {
    const row = makeFeeScheduleRow({ percentage_fee: 500 });
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([row]) });
    const result = await calculateOrderFee(
      'prm-0000-0000-0000-000000000001',
      [{ price: 10_000, quantity: 2 }],
      makeDeps(db),
    );
    expect(result.totalGrossRevenue).toBe(20_000);
    expect(result.totalPlatformFee).toBe(1_000); // 2 × 500
    expect(result.totalPromoterPayout).toBe(19_000);
    expect(result.lineItems).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// applyFeeToOrder
// ---------------------------------------------------------------------------
describe('applyFeeToOrder', () => {
  it('volá UPDATE na orders.orders se správnými hodnotami a fee_schedule_id', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const txDb = makeMockDb({ execute: executeMock });
    const db = makeMockDb({
      transaction: vi.fn().mockImplementation(async (fn: (tx: DbAdapter) => Promise<unknown>) => fn(txDb)),
    });

    const feeResult = {
      lineItems: [
        {
          ticketPrice: 10_000,
          percentageAmount: 500,
          fixedAmount: 0,
          rawFee: 500,
          platformFee: 500,
          promoterAmount: 9_500,
          feeScheduleId: 'sch-001',
          appliedPercentage: 500,
        },
      ],
      totalPlatformFee: 500,
      totalPromoterPayout: 9_500,
      totalGrossRevenue: 10_000,
      feeScheduleId: 'sch-001',
    };

    await applyFeeToOrder('order-001', feeResult, makeDeps(db));

    expect(executeMock).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE orders.orders'),
      expect.arrayContaining([500, 'sch-001', 'order-001']),
    );
  });
});

// ---------------------------------------------------------------------------
// createFeeSchedule
// ---------------------------------------------------------------------------
describe('createFeeSchedule', () => {
  it('vloží nový schedule do DB a vrátí mapovaný FeeSchedule', async () => {
    const row = makeFeeScheduleRow({ name: 'premium', percentage_fee: 300, fixed_fee: 200 });
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([row]) });

    const result = await createFeeSchedule(
      'prm-0000-0000-0000-000000000001',
      {
        promoterId: 'prm-0000-0000-0000-000000000001',
        name: 'premium',
        percentageFee: 300,
        fixedFee: 200,
        minFee: null,
        maxFee: null,
        validUntil: null,
      },
      'admin-001',
      makeDeps(db),
    );

    expect(result.name).toBe('premium');
    expect(result.percentageFee).toBe(300);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO platform.fee_schedules'),
      expect.any(Array),
    );
  });
});

// ---------------------------------------------------------------------------
// deactivateFeeSchedule
// ---------------------------------------------------------------------------
describe('deactivateFeeSchedule', () => {
  it('nastaví is_active = FALSE pomocí UPDATE', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeMockDb({ execute: executeMock });

    await deactivateFeeSchedule('sch-001', 'admin-001', makeDeps(db));

    expect(executeMock).toHaveBeenCalledWith(
      expect.stringContaining('is_active = FALSE'),
      expect.arrayContaining(['sch-001']),
    );
  });
});

// ---------------------------------------------------------------------------
// listFeeSchedules
// ---------------------------------------------------------------------------
describe('listFeeSchedules', () => {
  it('vrátí všechny schedules pro promotéra', async () => {
    const rows = [
      makeFeeScheduleRow({ id: 'sch-001' }),
      makeFeeScheduleRow({ id: 'sch-002', is_active: false }),
    ];
    const db = makeMockDb({ query: vi.fn().mockResolvedValue(rows) });

    const result = await listFeeSchedules('prm-0000-0000-0000-000000000001', makeDeps(db));
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('sch-001');
    expect(result[1].isActive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getPlatformRevenueSummary
// ---------------------------------------------------------------------------
describe('getPlatformRevenueSummary', () => {
  it('vrátí mapovaná data z revenue_summary pohledu', async () => {
    const rows = [
      {
        day: '2026-01-15T00:00:00.000Z',
        promoter_id: 'prm-001',
        order_count: '42',
        gross_revenue: '1000000',
        platform_fees: '50000',
        promoter_payouts: '950000',
        currency: 'CZK',
      },
    ];
    const db = makeMockDb({ query: vi.fn().mockResolvedValue(rows) });

    const result = await getPlatformRevenueSummary(
      { from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' },
      makeDeps(db),
    );

    expect(result).toHaveLength(1);
    expect(result[0].orderCount).toBe(42);
    expect(result[0].grossRevenue).toBe(1_000_000);
    expect(result[0].platformFees).toBe(50_000);
    expect(result[0].promoterPayouts).toBe(950_000);
    expect(result[0].currency).toBe('CZK');
  });
});

// ---------------------------------------------------------------------------
// assignPromoterTier
// ---------------------------------------------------------------------------
describe('assignPromoterTier', () => {
  it('provede UPSERT tieru, deaktivaci existujících schedules, insert nového schedule a audit zápis', async () => {
    const tierRow = {
      promoter_id: 'prm-0000-0000-0000-000000000001',
      tier: 'pro',
      assigned_at: '2026-04-08T00:00:00.000Z',
      assigned_by: 'admin-001',
      valid_until: null,
    };
    const scheduleRow = makeFeeScheduleRow({
      id: 'sch-new',
      name: 'Pro — 7% + 3 Kč',
      percentage_fee: 700,
      fixed_fee: 300,
      min_fee: 100,
    });

    const queryMock = vi
      .fn()
      .mockResolvedValueOnce([tierRow])       // UPSERT tier
      .mockResolvedValueOnce([scheduleRow]);  // INSERT new schedule
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeMockDb({ query: queryMock, execute: executeMock });

    const result = await assignPromoterTier(
      'prm-0000-0000-0000-000000000001',
      'pro',
      'admin-001',
      makeDeps(db),
    );

    // UPSERT
    expect(queryMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO platform.promoter_tiers'),
      expect.arrayContaining(['prm-0000-0000-0000-000000000001', 'pro', 'admin-001']),
    );
    // Deactivate
    expect(executeMock).toHaveBeenCalledWith(
      expect.stringContaining('is_active = FALSE'),
      ['prm-0000-0000-0000-000000000001'],
    );
    // Insert new fee schedule
    expect(queryMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO platform.fee_schedules'),
      expect.arrayContaining(['prm-0000-0000-0000-000000000001', 'Pro — 7% + 3 Kč', 700, 300, 100, null]),
    );
    // Audit
    expect(executeMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO platform.fee_schedule_audit'),
      expect.arrayContaining([
        'prm-0000-0000-0000-000000000001',
        'sch-new',
        'tier_assigned',
        'admin-001',
        expect.any(String),
      ]),
    );

    expect(result.tierAssignment.tier).toBe('pro');
    expect(result.tierAssignment.assignedBy).toBe('admin-001');
    expect(result.feeSchedule.id).toBe('sch-new');
    expect(result.feeSchedule.percentageFee).toBe(700);
    expect(result.feeSchedule.fixedFee).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// getPromoterTier
// ---------------------------------------------------------------------------
describe('getPromoterTier', () => {
  it('vrátí null, pokud promotér nemá přiřazen tier', async () => {
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([]) });
    const result = await getPromoterTier('prm-unknown', makeDeps(db));
    expect(result).toBeNull();
  });

  it('vrátí PromoterTierAssignment, pokud řádek existuje', async () => {
    const row = {
      promoter_id: 'prm-0000-0000-0000-000000000001',
      tier: 'growth',
      assigned_at: '2026-01-01T00:00:00.000Z',
      assigned_by: 'admin-001',
      valid_until: null,
    };
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([row]) });

    const result = await getPromoterTier('prm-0000-0000-0000-000000000001', makeDeps(db));
    expect(result).not.toBeNull();
    expect(result?.tier).toBe('growth');
    expect(result?.promoterId).toBe('prm-0000-0000-0000-000000000001');
    expect(result?.assignedBy).toBe('admin-001');
  });
});

// ---------------------------------------------------------------------------
// getFeeScheduleAuditLog
// ---------------------------------------------------------------------------
describe('getFeeScheduleAuditLog', () => {
  it('vrátí stránkované položky a total count', async () => {
    const auditRows = [
      {
        id: 'aud-001',
        promoter_id: 'prm-0000-0000-0000-000000000001',
        schedule_id: 'sch-001',
        action: 'created',
        admin_user_id: 'admin-001',
        details: { name: 'default' },
        created_at: '2026-04-08T00:00:00.000Z',
      },
      {
        id: 'aud-002',
        promoter_id: 'prm-0000-0000-0000-000000000001',
        schedule_id: 'sch-002',
        action: 'tier_assigned',
        admin_user_id: 'admin-002',
        details: { tier: 'pro' },
        created_at: '2026-04-07T00:00:00.000Z',
      },
    ];

    const queryMock = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('COUNT(*)')) {
        return Promise.resolve([{ total: '2' }]);
      }
      return Promise.resolve(auditRows);
    });
    const db = makeMockDb({ query: queryMock });

    const result = await getFeeScheduleAuditLog(
      'prm-0000-0000-0000-000000000001',
      { limit: 10, offset: 0 },
      makeDeps(db),
    );

    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].id).toBe('aud-001');
    expect(result.items[0].action).toBe('created');
    expect(result.items[0].details).toEqual({ name: 'default' });
    expect(result.items[1].action).toBe('tier_assigned');
  });
});
