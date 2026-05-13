import { describe, it, expect, vi } from 'vitest';
import {
  forecastSellThrough,
  getSellThroughForecast,
  getHighRiskForecasts,
  type MlAdapter,
  type DbAdapter,
  type SellThroughForecastOutput,
} from '../services/sell-through-forecast.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EVENT_DATE = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000); // 45 days

function makeForecastRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'forecast-1',
    event_id: 'event-1',
    total_capacity: '1000',
    tickets_sold: '600',
    current_sell_through_rate: '0.60',
    forecasted_sell_through_rate: '0.82',
    lower_bound: '0.70',
    upper_bound: '0.92',
    confidence_score: '0.78',
    risk_level: 'low',
    reasoning: 'Solid velocity, 45 days remaining',
    created_at: '2025-01-10T00:00:00.000Z',
    updated_at: '2025-01-10T00:00:00.000Z',
    ...overrides,
  };
}

function makeDb(queryResults: unknown[][], executeMock = vi.fn()): DbAdapter {
  let callIdx = 0;
  return {
    query: vi.fn().mockImplementation(() => {
      const result = queryResults[callIdx] ?? [];
      callIdx++;
      return Promise.resolve(result);
    }),
    execute: executeMock,
  };
}

function makeMl(output: Partial<SellThroughForecastOutput> = {}): MlAdapter {
  return {
    forecastSellThrough: vi.fn().mockResolvedValue({
      forecastedSellThroughRate: 0.82,
      lowerBound: 0.70,
      upperBound: 0.92,
      confidenceScore: 0.78,
      riskLevel: 'low',
      reasoning: 'Solid velocity, 45 days remaining',
      ...output,
    }),
  };
}

const BASE_INPUT = {
  eventId: 'event-1',
  totalCapacity: 1000,
  ticketsSold: 600,
  eventDate: EVENT_DATE,
  salesVelocityPerDay: 15,
};

// ---------------------------------------------------------------------------
// forecastSellThrough
// ---------------------------------------------------------------------------

describe('forecastSellThrough', () => {
  it('1. calls ML adapter and returns mapped forecast', async () => {
    const ml = makeMl();
    const db = makeDb([[makeForecastRow()]]);

    const result = await forecastSellThrough(BASE_INPUT, ml, db);

    expect(ml.forecastSellThrough).toHaveBeenCalledOnce();
    expect(result.id).toBe('forecast-1');
    expect(result.eventId).toBe('event-1');
    expect(result.forecastedSellThroughRate).toBe(0.82);
    expect(result.lowerBound).toBe(0.70);
    expect(result.upperBound).toBe(0.92);
    expect(result.riskLevel).toBe('low');
  });

  it('2. computes currentSellThroughRate from ticketsSold/totalCapacity', async () => {
    const ml = makeMl();
    const db = makeDb([[makeForecastRow()]]);

    await forecastSellThrough({ ...BASE_INPUT, ticketsSold: 300, totalCapacity: 1000 }, ml, db);

    const mlCall = (ml.forecastSellThrough as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(mlCall.currentSellThroughRate).toBe(0.30);
  });

  it('3. throws VALIDATION_ERROR when totalCapacity <= 0', async () => {
    const ml = makeMl();
    const db = makeDb([[]]);

    await expect(
      forecastSellThrough({ ...BASE_INPUT, totalCapacity: 0 }, ml, db),
    ).rejects.toThrow('VALIDATION_ERROR: totalCapacity must be positive');
  });

  it('4. throws VALIDATION_ERROR when totalCapacity is negative', async () => {
    const ml = makeMl();
    const db = makeDb([[]]);

    await expect(
      forecastSellThrough({ ...BASE_INPUT, totalCapacity: -1 }, ml, db),
    ).rejects.toThrow('VALIDATION_ERROR: totalCapacity must be positive');
  });

  it('5. throws VALIDATION_ERROR when ticketsSold < 0', async () => {
    const ml = makeMl();
    const db = makeDb([[]]);

    await expect(
      forecastSellThrough({ ...BASE_INPUT, ticketsSold: -1 }, ml, db),
    ).rejects.toThrow('VALIDATION_ERROR: ticketsSold cannot be negative');
  });

  it('6. throws VALIDATION_ERROR when ticketsSold > totalCapacity', async () => {
    const ml = makeMl();
    const db = makeDb([[]]);

    await expect(
      forecastSellThrough({ ...BASE_INPUT, ticketsSold: 1001, totalCapacity: 1000 }, ml, db),
    ).rejects.toThrow('VALIDATION_ERROR: ticketsSold cannot exceed totalCapacity');
  });

  it('7. throws VALIDATION_ERROR when salesVelocityPerDay < 0', async () => {
    const ml = makeMl();
    const db = makeDb([[]]);

    await expect(
      forecastSellThrough({ ...BASE_INPUT, salesVelocityPerDay: -1 }, ml, db),
    ).rejects.toThrow('VALIDATION_ERROR: salesVelocityPerDay cannot be negative');
  });

  it('8. accepts ticketsSold equal to totalCapacity (sold out)', async () => {
    const ml = makeMl({ forecastedSellThroughRate: 1.0, lowerBound: 1.0, upperBound: 1.0 });
    const db = makeDb([[makeForecastRow({
      tickets_sold: '1000',
      current_sell_through_rate: '1.0',
      forecasted_sell_through_rate: '1.0',
    })]]);

    const result = await forecastSellThrough(
      { ...BASE_INPUT, ticketsSold: 1000, totalCapacity: 1000 },
      ml, db,
    );

    expect(result.currentSellThroughRate).toBe(1.0);
  });

  it('9. throws ML_ERROR when lowerBound > forecastedSellThroughRate', async () => {
    const ml = makeMl({ forecastedSellThroughRate: 0.5, lowerBound: 0.6 });
    const db = makeDb([[]]);

    await expect(
      forecastSellThrough(BASE_INPUT, ml, db),
    ).rejects.toThrow('ML_ERROR: lowerBound must be <= forecastedSellThroughRate');
  });

  it('10. throws ML_ERROR when upperBound < forecastedSellThroughRate', async () => {
    const ml = makeMl({ forecastedSellThroughRate: 0.8, upperBound: 0.7 });
    const db = makeDb([[]]);

    await expect(
      forecastSellThrough(BASE_INPUT, ml, db),
    ).rejects.toThrow('ML_ERROR: upperBound must be >= forecastedSellThroughRate');
  });

  it('11. upserts with ON CONFLICT and correct params', async () => {
    const ml = makeMl();
    const db = makeDb([[makeForecastRow()]]);

    await forecastSellThrough(BASE_INPUT, ml, db);

    const [sql, params] = (db.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sql).toContain('ON CONFLICT (event_id) DO UPDATE');
    expect(params[0]).toBe('event-1');
    expect(params[1]).toBe(1000);
    expect(params[2]).toBe(600);
    expect(params[3]).toBe(0.60);
    expect(params[4]).toBe(0.82);
    expect(params[9]).toBe('Solid velocity, 45 days remaining');
  });

  it('12. passes null historicalAvgSellThrough to ML when not provided', async () => {
    const ml = makeMl();
    const db = makeDb([[makeForecastRow()]]);

    await forecastSellThrough(BASE_INPUT, ml, db);

    const mlCall = (ml.forecastSellThrough as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(mlCall.historicalAvgSellThrough).toBeNull();
  });

  it('13. passes historicalAvgSellThrough to ML when provided', async () => {
    const ml = makeMl();
    const db = makeDb([[makeForecastRow()]]);

    await forecastSellThrough({ ...BASE_INPUT, historicalAvgSellThrough: 0.75 }, ml, db);

    const mlCall = (ml.forecastSellThrough as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(mlCall.historicalAvgSellThrough).toBe(0.75);
  });

  it('14. passes null marketingSpendCzk when not provided', async () => {
    const ml = makeMl();
    const db = makeDb([[makeForecastRow()]]);

    await forecastSellThrough(BASE_INPUT, ml, db);

    const mlCall = (ml.forecastSellThrough as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(mlCall.marketingSpendCzk).toBeNull();
  });

  it('15. passes marketingSpendCzk to ML when provided', async () => {
    const ml = makeMl();
    const db = makeDb([[makeForecastRow()]]);

    await forecastSellThrough({ ...BASE_INPUT, marketingSpendCzk: 50000 }, ml, db);

    const mlCall = (ml.forecastSellThrough as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(mlCall.marketingSpendCzk).toBe(50000);
  });

  it('16. computes daysUntilEvent from eventDate', async () => {
    const ml = makeMl();
    const db = makeDb([[makeForecastRow()]]);

    const futureDate = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    await forecastSellThrough({ ...BASE_INPUT, eventDate: futureDate }, ml, db);

    const mlCall = (ml.forecastSellThrough as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(mlCall.daysUntilEvent).toBeGreaterThanOrEqual(19);
    expect(mlCall.daysUntilEvent).toBeLessThanOrEqual(21);
  });

  it('17. clamps daysUntilEvent to 0 for past events', async () => {
    const ml = makeMl();
    const db = makeDb([[makeForecastRow()]]);

    const pastDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await forecastSellThrough({ ...BASE_INPUT, eventDate: pastDate }, ml, db);

    const mlCall = (ml.forecastSellThrough as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(mlCall.daysUntilEvent).toBe(0);
  });

  it('18. maps all numeric fields from string DB values', async () => {
    const ml = makeMl();
    const db = makeDb([[makeForecastRow()]]);

    const result = await forecastSellThrough(BASE_INPUT, ml, db);

    expect(typeof result.totalCapacity).toBe('number');
    expect(typeof result.ticketsSold).toBe('number');
    expect(typeof result.currentSellThroughRate).toBe('number');
    expect(typeof result.forecastedSellThroughRate).toBe('number');
    expect(typeof result.lowerBound).toBe('number');
    expect(typeof result.upperBound).toBe('number');
    expect(typeof result.confidenceScore).toBe('number');
  });

  it('19. handles riskLevel medium', async () => {
    const ml = makeMl({ forecastedSellThroughRate: 0.60, lowerBound: 0.48, upperBound: 0.72, riskLevel: 'medium' });
    const db = makeDb([[makeForecastRow({ risk_level: 'medium', forecasted_sell_through_rate: '0.60' })]]);

    const result = await forecastSellThrough(BASE_INPUT, ml, db);

    expect(result.riskLevel).toBe('medium');
  });

  it('20. handles riskLevel high', async () => {
    const ml = makeMl({ forecastedSellThroughRate: 0.30, lowerBound: 0.10, upperBound: 0.50, riskLevel: 'high' });
    const db = makeDb([[makeForecastRow({ risk_level: 'high', forecasted_sell_through_rate: '0.30' })]]);

    const result = await forecastSellThrough(BASE_INPUT, ml, db);

    expect(result.riskLevel).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// getSellThroughForecast
// ---------------------------------------------------------------------------

describe('getSellThroughForecast', () => {
  it('21. returns mapped forecast when found', async () => {
    const db = makeDb([[makeForecastRow()]]);

    const result = await getSellThroughForecast('event-1', db);

    expect(result).not.toBeNull();
    expect(result!.eventId).toBe('event-1');
    expect(result!.forecastedSellThroughRate).toBe(0.82);
    expect(result!.createdAt).toBeInstanceOf(Date);
  });

  it('22. returns null when not found', async () => {
    const db = makeDb([[]]); // empty

    const result = await getSellThroughForecast('event-unknown', db);

    expect(result).toBeNull();
  });

  it('23. queries by event_id', async () => {
    const db = makeDb([[makeForecastRow()]]);

    await getSellThroughForecast('event-77', db);

    const [sql, params] = (db.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sql).toContain('WHERE event_id = $1');
    expect(params[0]).toBe('event-77');
  });

  it('24. maps riskLevel correctly', async () => {
    const db = makeDb([[makeForecastRow({ risk_level: 'high' })]]);

    const result = await getSellThroughForecast('event-1', db);

    expect(result!.riskLevel).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// getHighRiskForecasts
// ---------------------------------------------------------------------------

describe('getHighRiskForecasts', () => {
  it('25. returns high-risk forecasts for promoter', async () => {
    const db = makeDb([[
      makeForecastRow({ id: 'f1', event_id: 'e1', risk_level: 'high', forecasted_sell_through_rate: '0.20' }),
      makeForecastRow({ id: 'f2', event_id: 'e2', risk_level: 'high', forecasted_sell_through_rate: '0.35' }),
    ]]);

    const results = await getHighRiskForecasts('promoter-1', db);

    expect(results).toHaveLength(2);
    results.forEach(r => expect(r.riskLevel).toBe('high'));
  });

  it('26. returns empty array when no high-risk events', async () => {
    const db = makeDb([[]]); // empty

    const results = await getHighRiskForecasts('promoter-1', db);

    expect(results).toEqual([]);
  });

  it('27. queries with promoter_id and high risk_level filter', async () => {
    const db = makeDb([[makeForecastRow({ risk_level: 'high' })]]);

    await getHighRiskForecasts('promoter-42', db);

    const [sql, params] = (db.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sql).toContain("risk_level = 'high'");
    expect(params[0]).toBe('promoter-42');
  });

  it('28. orders by forecastedSellThroughRate ASC (most at-risk first)', async () => {
    const db = makeDb([[makeForecastRow({ risk_level: 'high' })]]);

    await getHighRiskForecasts('promoter-1', db);

    const [sql] = (db.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sql).toContain('ORDER BY stf.forecasted_sell_through_rate ASC');
  });

  it('29. maps all returned rows', async () => {
    const db = makeDb([[
      makeForecastRow({ id: 'f1', risk_level: 'high' }),
      makeForecastRow({ id: 'f2', risk_level: 'high' }),
      makeForecastRow({ id: 'f3', risk_level: 'high' }),
    ]]);

    const results = await getHighRiskForecasts('promoter-1', db);

    expect(results).toHaveLength(3);
    results.forEach(r => {
      expect(r.createdAt).toBeInstanceOf(Date);
      expect(typeof r.forecastedSellThroughRate).toBe('number');
    });
  });
});
