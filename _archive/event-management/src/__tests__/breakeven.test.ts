// =============================================================================
// Break-even analýza — unit testy (Feature #62)
// =============================================================================

import { describe, it, expect, vi } from 'vitest';
import { calculateBreakeven } from '../services/breakeven.service.js';
import { EventManagementError } from '../lib/event-errors.js';
import type { ServiceDeps } from '../lib/service-container.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(queryFn: (...args: unknown[]) => Promise<unknown[]>): ServiceDeps {
  return {
    db: {
      query: vi.fn(queryFn) as unknown as ServiceDeps['db']['query'],
      execute: vi.fn(),
      transaction: vi.fn(async (fn: (tx: ServiceDeps['db']) => Promise<unknown>) => fn({
        query: vi.fn(queryFn) as unknown as ServiceDeps['db']['query'],
        execute: vi.fn(),
        transaction: vi.fn(),
      } as ServiceDeps['db'])),
    },
    kafka: { send: vi.fn() },
  };
}

const PROMOTER_ID = 'promoter-001';
const EVENT_ID = 'event-001';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('calculateBreakeven — základní scénář', () => {
  it('vypočítá break-even bod a scénáře správně', async () => {
    // Event: 1000 kapacita, 1 ticket type: 50000 halíře (500 CZK)
    // Pevné náklady: 10 000 000 halíře (100 000 CZK)
    // Variabilní na lístek: 2 000 halíře (20 CZK)
    // Marže = 50000 - 2000 = 48000
    // Break-even = ceil(10 000 000 / 48000) = 209 vstupenek
    // BE obsazenost = 209 / 1000 = 20.9 %

    const deps = makeDeps(async (sql: unknown) => {
      if ((sql as string).includes('catalog.events')) {
        return [{ id: EVENT_ID, promoter_id: PROMOTER_ID, capacity: 1000 }];
      }
      if ((sql as string).includes('catalog.ticket_types')) {
        return [{ id: 'tt-1', price_halire: 50000, capacity: 1000 }];
      }
      return [];
    });

    const result = await calculateBreakeven(EVENT_ID, PROMOTER_ID, {
      fixedCostsHalire: 10_000_000,
      variableCostPerTicketHalire: 2_000,
    }, deps);

    expect(result.totalCapacity).toBe(1000);
    expect(result.weightedAvgPriceHalire).toBe(50000);
    expect(result.breakEvenTickets).toBe(209);
    expect(result.breakEvenOccupancyPct).toBe(20.9);
    expect(result.scenarios).toHaveLength(7);
    expect(result.scenarios[0].occupancyPct).toBe(40);
    expect(result.scenarios[6].occupancyPct).toBe(100);
  });

  it('scénář 100% je vždy v zisku při reálné ceně', async () => {
    const deps = makeDeps(async (sql: unknown) => {
      if ((sql as string).includes('catalog.events')) {
        return [{ id: EVENT_ID, promoter_id: PROMOTER_ID, capacity: 500 }];
      }
      if ((sql as string).includes('catalog.ticket_types')) {
        return [{ id: 'tt-1', price_halire: 30000, capacity: 500 }];
      }
      return [];
    });

    const result = await calculateBreakeven(EVENT_ID, PROMOTER_ID, {
      fixedCostsHalire: 5_000_000,
      variableCostPerTicketHalire: 1_000,
    }, deps);

    const fullHouse = result.scenarios.find((s) => s.occupancyPct === 100)!;
    expect(fullHouse.isProfitable).toBe(true);
    expect(fullHouse.profitHalire).toBeGreaterThan(0);
  });

  it('recommendedMinPriceHalire pokryje náklady při 80 % obsazenosti', async () => {
    const deps = makeDeps(async (sql: unknown) => {
      if ((sql as string).includes('catalog.events')) {
        return [{ id: EVENT_ID, promoter_id: PROMOTER_ID, capacity: 1000 }];
      }
      if ((sql as string).includes('catalog.ticket_types')) {
        return [{ id: 'tt-1', price_halire: 50000, capacity: 1000 }];
      }
      return [];
    });

    const result = await calculateBreakeven(EVENT_ID, PROMOTER_ID, {
      fixedCostsHalire: 20_000_000,
      variableCostPerTicketHalire: 5_000,
    }, deps);

    // recommendedMinPriceHalire by měla při 80 % obsazenosti pokrýt náklady
    const target = Math.round(0.8 * 1000); // 800 vstupenek
    const revenueAt80 = target * result.recommendedMinPriceHalire;
    const costsAt80 = 20_000_000 + target * 5_000;
    expect(revenueAt80).toBeGreaterThanOrEqual(costsAt80);
  });
});

describe('calculateBreakeven — více ticket types', () => {
  it('váhovaný průměr správně agreguje více typů vstupenek', async () => {
    // 200 VIP @ 100000 + 800 Standard @ 30000
    // weightedAvg = (200×100000 + 800×30000) / 1000 = (20M + 24M) / 1000 = 44000
    const deps = makeDeps(async (sql: unknown) => {
      if ((sql as string).includes('catalog.events')) {
        return [{ id: EVENT_ID, promoter_id: PROMOTER_ID, capacity: 1000 }];
      }
      if ((sql as string).includes('catalog.ticket_types')) {
        return [
          { id: 'tt-vip', price_halire: 100000, capacity: 200 },
          { id: 'tt-std', price_halire: 30000, capacity: 800 },
        ];
      }
      return [];
    });

    const result = await calculateBreakeven(EVENT_ID, PROMOTER_ID, {
      fixedCostsHalire: 0,
      variableCostPerTicketHalire: 0,
    }, deps);

    expect(result.totalCapacity).toBe(1000);
    expect(result.weightedAvgPriceHalire).toBe(44000);
  });
});

describe('calculateBreakeven — chybové stavy', () => {
  it('vyhodí EVENT_NOT_FOUND pokud akce neexistuje nebo nepatří promotérovi', async () => {
    const deps = makeDeps(async (sql: unknown) => {
      if ((sql as string).includes('catalog.events')) return [];
      return [];
    });

    await expect(
      calculateBreakeven(EVENT_ID, PROMOTER_ID, {
        fixedCostsHalire: 1_000_000,
        variableCostPerTicketHalire: 0,
      }, deps),
    ).rejects.toBeInstanceOf(EventManagementError);
  });

  it('vyhodí VALIDATION_ERROR pokud akce nemá ticket types', async () => {
    const deps = makeDeps(async (sql: unknown) => {
      if ((sql as string).includes('catalog.events')) {
        return [{ id: EVENT_ID, promoter_id: PROMOTER_ID, capacity: 1000 }];
      }
      if ((sql as string).includes('catalog.ticket_types')) return [];
      return [];
    });

    await expect(
      calculateBreakeven(EVENT_ID, PROMOTER_ID, {
        fixedCostsHalire: 1_000_000,
        variableCostPerTicketHalire: 0,
      }, deps),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('vyhodí VALIDATION_ERROR pokud variabilní náklady >= průměrná cena', async () => {
    const deps = makeDeps(async (sql: unknown) => {
      if ((sql as string).includes('catalog.events')) {
        return [{ id: EVENT_ID, promoter_id: PROMOTER_ID, capacity: 100 }];
      }
      if ((sql as string).includes('catalog.ticket_types')) {
        return [{ id: 'tt-1', price_halire: 1000, capacity: 100 }];
      }
      return [];
    });

    await expect(
      calculateBreakeven(EVENT_ID, PROMOTER_ID, {
        fixedCostsHalire: 500_000,
        variableCostPerTicketHalire: 1500, // variabilní > cena → žádný breakeven
      }, deps),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('odmítne záporné náklady', async () => {
    const deps = makeDeps(async () => []);

    await expect(
      calculateBreakeven(EVENT_ID, PROMOTER_ID, {
        fixedCostsHalire: -1,
        variableCostPerTicketHalire: 0,
      }, deps),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('calculateBreakeven — nulové náklady', () => {
  it('při nulových nákladech je break-even 0 % obsazenost', async () => {
    const deps = makeDeps(async (sql: unknown) => {
      if ((sql as string).includes('catalog.events')) {
        return [{ id: EVENT_ID, promoter_id: PROMOTER_ID, capacity: 500 }];
      }
      if ((sql as string).includes('catalog.ticket_types')) {
        return [{ id: 'tt-1', price_halire: 20000, capacity: 500 }];
      }
      return [];
    });

    const result = await calculateBreakeven(EVENT_ID, PROMOTER_ID, {
      fixedCostsHalire: 0,
      variableCostPerTicketHalire: 0,
    }, deps);

    expect(result.breakEvenTickets).toBe(0);
    expect(result.scenarios.every((s) => s.isProfitable || s.occupancyPct === 0)).toBe(true);
  });
});
