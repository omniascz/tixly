import { describe, it, expect, vi } from 'vitest';
import {
  simulateCapacityChange,
  simulatePriceChange,
  getRevenueProjection,
  updateRevenueProjection,
  logRevenueScenario,
  getScenarioHistory,
  formatRevenueImpact,
  getScenarioProjections,
} from '../services/calculator.service.js';
import type { DbAdapter } from '../services/calculator.service.js';

const EVENT_ID = 'event-001';
const PROMOTER_ID = 'promoter-001';

function makeProjectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'proj-001',
    event_id: EVENT_ID,
    promoter_id: PROMOTER_ID,
    total_capacity: 1000,
    current_sold: 500,
    base_price_hellers: 50000,  // 500 CZK
    projected_revenue_hellers: 25000000,  // 250,000 CZK
    worst_case_revenue_hellers: 20000000,  // 40% × 1000 × 500 CZK
    mid_case_revenue_hellers: 35000000,  // 70% × 1000 × 500 CZK
    best_case_revenue_hellers: 50000000,  // 100% × 1000 × 500 CZK
    calculated_at: '2026-04-14T10:00:00Z',
    updated_at: '2026-04-14T10:00:00Z',
    ...overrides,
  };
}

function makeDb(queryResults: unknown[][] = [], executeMock = vi.fn()): DbAdapter {
  let callIdx = 0;
  return {
    query: vi.fn(async () => {
      const result = queryResults[callIdx] ?? [];
      callIdx++;
      return result;
    }),
    execute: executeMock,
    transaction: vi.fn(async (fn) => fn({
      query: vi.fn().mockResolvedValue([]),
      execute: executeMock,
      transaction: vi.fn(),
    } as DbAdapter)),
  };
}

describe('simulateCapacityChange', () => {
  it('vypočítá dopad zvýšení kapacity', () => {
    // Current: 500 sold / 1000 capacity = 50% fill rate
    // New capacity: 2000, so we expect 2000 × 50% = 1000 sold
    // Base price: 500 CZK (50000 halíře)
    const result = simulateCapacityChange(1000, 2000, 500, 50000);

    expect(result.baseRevenueHellers).toBe(25000000);  // 500 × 50000
    expect(result.newRevenueHellers).toBe(50000000);  // 1000 × 50000
    expect(result.impactHellers).toBe(25000000);
    expect(result.impactPercent).toBe(100);  // 100% increase
  });

  it('vypočítá dopad snížení kapacity', () => {
    const result = simulateCapacityChange(1000, 500, 500, 50000);

    expect(result.baseRevenueHellers).toBe(25000000);
    // 500 × 50% fill rate = 250 sold, but capped at 500 capacity
    expect(result.newRevenueHellers).toBeLessThanOrEqual(25000000);
  });
});

describe('simulatePriceChange', () => {
  it('vypočítá dopad zvýšení ceny s elasticitou poptávky', () => {
    // Current: 500 sold × 500 CZK = 250,000 CZK
    // Price increase by 50% (from 500 to 750)
    // Elasticity: 50% / 5 = 10% demand drop
    // New: (500 × 0.9) × 750 = 337,500 CZK
    const result = simulatePriceChange(50000, 75000, 500, 1000);

    expect(result.baseRevenueHellers).toBe(25000000);
    // Price went up 50%, demand drops ~10%, so revenue should increase
    expect(result.newRevenueHellers).toBeGreaterThan(25000000);
  });

  it('vypočítá dopad snížení ceny s nižší elasticitou', () => {
    const result = simulatePriceChange(50000, 30000, 500, 1000);

    expect(result.baseRevenueHellers).toBe(25000000);
    // Price down 40%, demand increases ~8%
    expect(result.newRevenueHellers).toBeLessThan(25000000);
  });
});

describe('getRevenueProjection', () => {
  it('vrátí aktuální projekci příjmů', async () => {
    const db = makeDb([[makeProjectionRow()]]);

    const result = await getRevenueProjection(EVENT_ID, db);

    expect(result).not.toBeNull();
    expect(result?.projectedRevenueHellers).toBe(25000000);
  });

  it('vrátí null pokud projekce neexistuje', async () => {
    const db = makeDb([[]]);

    const result = await getRevenueProjection(EVENT_ID, db);

    expect(result).toBeNull();
  });
});

describe('updateRevenueProjection', () => {
  it('vytvoří nebo aktualizuje projekci příjmů', async () => {
    const db = makeDb([[makeProjectionRow()]]);

    const result = await updateRevenueProjection(
      EVENT_ID,
      PROMOTER_ID,
      1000,
      500,
      50000,
      db,
    );

    expect(result.totalCapacity).toBe(1000);
    expect(result.currentSold).toBe(500);
    expect(result.projectedRevenueHellers).toBe(25000000);
  });

  it('vypočítá scénáře (worst/mid/best case)', async () => {
    const db = makeDb([[makeProjectionRow()]]);

    const result = await updateRevenueProjection(
      EVENT_ID,
      PROMOTER_ID,
      1000,
      500,
      50000,
      db,
    );

    expect(result.worstCaseRevenueHellers).toBe(20000000);  // 40% capacity
    expect(result.midCaseRevenueHellers).toBe(35000000);    // 70% capacity
    expect(result.bestCaseRevenueHellers).toBe(50000000);   // 100% capacity
  });
});

describe('logRevenueScenario', () => {
  it('zaloguje výpočet scénáře do historii', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeDb([], executeMock);

    await logRevenueScenario(
      EVENT_ID,
      'capacity_change',
      25000000,
      50000000,
      { from: 1000, to: 2000 },
      db,
    );

    expect(executeMock).toHaveBeenCalledTimes(1);
  });
});

describe('getScenarioHistory', () => {
  it('vrátí poslední scénáře pro event', async () => {
    const db = makeDb([[
      {
        scenario_type: 'capacity_change',
        base_revenue_hellers: 25000000,
        new_revenue_hellers: 50000000,
        impact_hellers: 25000000,
        impact_percent: 100.0,
        calculated_at: '2026-04-14T10:00:00Z',
      },
    ]]);

    const result = await getScenarioHistory(EVENT_ID, db);

    expect(result).toHaveLength(1);
    expect(result[0].scenarioType).toBe('capacity_change');
  });
});

describe('formatRevenueImpact', () => {
  it('naformátuje dopad příjmů pro UI', () => {
    const impact = {
      baseRevenueHellers: 25000000,
      newRevenueHellers: 50000000,
      impactHellers: 25000000,
      impactPercent: 100,
    };

    const result = formatRevenueImpact(impact);

    expect(result.baseRevenue).toBe('250000.00 CZK');
    expect(result.newRevenue).toBe('500000.00 CZK');
    expect(result.impactAmount).toBe('250000.00 CZK');
    expect(result.impactPercent).toBe('100.0%');
    expect(result.trend).toBe('up');
  });

  it('označí trend jako down pro negativní dopad', () => {
    const impact = {
      baseRevenueHellers: 50000000,
      newRevenueHellers: 25000000,
      impactHellers: -25000000,
      impactPercent: -50,
    };

    const result = formatRevenueImpact(impact);

    expect(result.trend).toBe('down');
  });

  it('označí trend jako neutral pro nulový dopad', () => {
    const impact = {
      baseRevenueHellers: 25000000,
      newRevenueHellers: 25000000,
      impactHellers: 0,
      impactPercent: 0,
    };

    const result = formatRevenueImpact(impact);

    expect(result.trend).toBe('neutral');
  });
});

describe('getScenarioProjections', () => {
  it('vrátí 3 scénáře (worst/mid/best)', async () => {
    const db = makeDb([[makeProjectionRow()]]);

    const result = await getScenarioProjections(EVENT_ID, db);

    expect(result).not.toBeNull();
    expect(result?.current).toBe(25000000);
    expect(result?.worst).toBe(20000000);
    expect(result?.mid).toBe(35000000);
    expect(result?.best).toBe(50000000);
  });

  it('vrátí null pokud projekce neexistuje', async () => {
    const db = makeDb([[]]);

    const result = await getScenarioProjections(EVENT_ID, db);

    expect(result).toBeNull();
  });
});
