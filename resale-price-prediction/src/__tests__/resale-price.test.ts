import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  predictResalePrice,
  getResalePricePrediction,
  validateListingPrice,
  getEventResalePredictions,
  type MlAdapter,
  type DbAdapter,
  type ResalePricePredictionOutput,
} from '../services/resale-price.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EVENT_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

function makePredictionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pred-1',
    ticket_id: 'ticket-1',
    event_id: 'event-1',
    face_value_halire: '50000',
    predicted_price_halire: '55000',
    ceiling_price_halire: '75000',
    floor_price_halire: '40000',
    confidence_score: '0.80',
    reasoning: 'High demand, 30 days out',
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

function makeMl(output: Partial<ResalePricePredictionOutput> = {}): MlAdapter {
  return {
    predictResalePrice: vi.fn().mockResolvedValue({
      predictedPriceHalire: 55000,
      ceilingPriceHalire: 75000,
      floorPriceHalire: 40000,
      confidenceScore: 0.80,
      reasoning: 'High demand, 30 days out',
      ...output,
    }),
  };
}

const BASE_INPUT = {
  ticketId: 'ticket-1',
  eventId: 'event-1',
  faceValueHalire: 50000,
  eventDate: EVENT_DATE,
  activeListingsCount: 5,
  demandScore: 0.7,
};

// ---------------------------------------------------------------------------
// predictResalePrice
// ---------------------------------------------------------------------------

describe('predictResalePrice', () => {
  it('1. calls ML adapter and returns mapped prediction', async () => {
    const ml = makeMl();
    const db = makeDb([[makePredictionRow()]]);

    const result = await predictResalePrice(BASE_INPUT, ml, db);

    expect(ml.predictResalePrice).toHaveBeenCalledOnce();
    expect(result.id).toBe('pred-1');
    expect(result.ticketId).toBe('ticket-1');
    expect(result.predictedPriceHalire).toBe(55000);
    expect(result.ceilingPriceHalire).toBe(75000);
    expect(result.floorPriceHalire).toBe(40000);
    expect(result.confidenceScore).toBe(0.80);
  });

  it('2. throws VALIDATION_ERROR when faceValueHalire <= 0', async () => {
    const ml = makeMl();
    const db = makeDb([[]]);

    await expect(
      predictResalePrice({ ...BASE_INPUT, faceValueHalire: 0 }, ml, db),
    ).rejects.toThrow('VALIDATION_ERROR: faceValueHalire must be positive');
  });

  it('3. throws VALIDATION_ERROR when faceValueHalire is negative', async () => {
    const ml = makeMl();
    const db = makeDb([[]]);

    await expect(
      predictResalePrice({ ...BASE_INPUT, faceValueHalire: -1 }, ml, db),
    ).rejects.toThrow('VALIDATION_ERROR: faceValueHalire must be positive');
  });

  it('4. throws VALIDATION_ERROR when demandScore > 1', async () => {
    const ml = makeMl();
    const db = makeDb([[]]);

    await expect(
      predictResalePrice({ ...BASE_INPUT, demandScore: 1.1 }, ml, db),
    ).rejects.toThrow('VALIDATION_ERROR: demandScore must be between 0 and 1');
  });

  it('5. throws VALIDATION_ERROR when demandScore < 0', async () => {
    const ml = makeMl();
    const db = makeDb([[]]);

    await expect(
      predictResalePrice({ ...BASE_INPUT, demandScore: -0.1 }, ml, db),
    ).rejects.toThrow('VALIDATION_ERROR: demandScore must be between 0 and 1');
  });

  it('6. throws VALIDATION_ERROR when activeListingsCount < 0', async () => {
    const ml = makeMl();
    const db = makeDb([[]]);

    await expect(
      predictResalePrice({ ...BASE_INPUT, activeListingsCount: -1 }, ml, db),
    ).rejects.toThrow('VALIDATION_ERROR: activeListingsCount cannot be negative');
  });

  it('7. accepts demandScore of exactly 0 and 1 as boundary values', async () => {
    const ml = makeMl();
    const db = makeDb([[makePredictionRow()], [makePredictionRow()]]);

    await expect(predictResalePrice({ ...BASE_INPUT, demandScore: 0 }, ml, db)).resolves.toBeDefined();
    await expect(predictResalePrice({ ...BASE_INPUT, demandScore: 1 }, ml, db)).resolves.toBeDefined();
  });

  it('8. throws ML_ERROR when ceilingPrice < predictedPrice', async () => {
    const ml = makeMl({ predictedPriceHalire: 70000, ceilingPriceHalire: 60000 });
    const db = makeDb([[]]);

    await expect(
      predictResalePrice(BASE_INPUT, ml, db),
    ).rejects.toThrow('ML_ERROR: ceilingPriceHalire must be >= predictedPriceHalire');
  });

  it('9. throws ML_ERROR when floorPrice > predictedPrice', async () => {
    const ml = makeMl({ predictedPriceHalire: 55000, floorPriceHalire: 60000 });
    const db = makeDb([[]]);

    await expect(
      predictResalePrice(BASE_INPUT, ml, db),
    ).rejects.toThrow('ML_ERROR: floorPriceHalire must be <= predictedPriceHalire');
  });

  it('10. upserts with ON CONFLICT and passes correct params', async () => {
    const ml = makeMl();
    const db = makeDb([[makePredictionRow()]]);

    await predictResalePrice(BASE_INPUT, ml, db);

    const [sql, params] = (db.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sql).toContain('ON CONFLICT (ticket_id) DO UPDATE');
    expect(params[0]).toBe('ticket-1');
    expect(params[1]).toBe('event-1');
    expect(params[2]).toBe(50000);
    expect(params[3]).toBe(55000);
    expect(params[4]).toBe(75000);
    expect(params[5]).toBe(40000);
    expect(params[6]).toBe(0.80);
  });

  it('11. passes null historicalResaleRatio to ML when not provided', async () => {
    const ml = makeMl();
    const db = makeDb([[makePredictionRow()]]);

    await predictResalePrice(BASE_INPUT, ml, db);

    const mlCall = (ml.predictResalePrice as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(mlCall.historicalResaleRatio).toBeNull();
  });

  it('12. passes historicalResaleRatio to ML when provided', async () => {
    const ml = makeMl();
    const db = makeDb([[makePredictionRow()]]);

    await predictResalePrice({ ...BASE_INPUT, historicalResaleRatio: 1.25 }, ml, db);

    const mlCall = (ml.predictResalePrice as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(mlCall.historicalResaleRatio).toBe(1.25);
  });

  it('13. computes daysUntilEvent from eventDate', async () => {
    const ml = makeMl();
    const db = makeDb([[makePredictionRow()]]);

    const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000); // 10 days
    await predictResalePrice({ ...BASE_INPUT, eventDate: futureDate }, ml, db);

    const mlCall = (ml.predictResalePrice as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(mlCall.daysUntilEvent).toBeGreaterThanOrEqual(9);
    expect(mlCall.daysUntilEvent).toBeLessThanOrEqual(11);
  });

  it('14. clamps daysUntilEvent to 0 for past events', async () => {
    const ml = makeMl();
    const db = makeDb([[makePredictionRow()]]);

    const pastDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await predictResalePrice({ ...BASE_INPUT, eventDate: pastDate }, ml, db);

    const mlCall = (ml.predictResalePrice as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(mlCall.daysUntilEvent).toBe(0);
  });

  it('15. maps all numeric fields from string DB values', async () => {
    const ml = makeMl();
    const db = makeDb([[makePredictionRow({
      face_value_halire: '50000',
      predicted_price_halire: '55000',
      ceiling_price_halire: '75000',
      floor_price_halire: '40000',
      confidence_score: '0.80',
    })]]);

    const result = await predictResalePrice(BASE_INPUT, ml, db);

    expect(typeof result.faceValueHalire).toBe('number');
    expect(typeof result.predictedPriceHalire).toBe('number');
    expect(typeof result.ceilingPriceHalire).toBe('number');
    expect(typeof result.floorPriceHalire).toBe('number');
    expect(typeof result.confidenceScore).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// getResalePricePrediction
// ---------------------------------------------------------------------------

describe('getResalePricePrediction', () => {
  it('16. returns mapped prediction when found', async () => {
    const db = makeDb([[makePredictionRow()]]);

    const result = await getResalePricePrediction('ticket-1', db);

    expect(result).not.toBeNull();
    expect(result!.ticketId).toBe('ticket-1');
    expect(result!.predictedPriceHalire).toBe(55000);
  });

  it('17. returns null when not found', async () => {
    const db = makeDb([[]]); // empty

    const result = await getResalePricePrediction('ticket-unknown', db);

    expect(result).toBeNull();
  });

  it('18. queries by ticket_id', async () => {
    const db = makeDb([[makePredictionRow()]]);

    await getResalePricePrediction('ticket-42', db);

    const [sql, params] = (db.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sql).toContain('WHERE ticket_id = $1');
    expect(params[0]).toBe('ticket-42');
  });
});

// ---------------------------------------------------------------------------
// validateListingPrice
// ---------------------------------------------------------------------------

describe('validateListingPrice', () => {
  it('19. returns valid when price is within range', async () => {
    const db = makeDb([[makePredictionRow()]]);

    const result = await validateListingPrice('ticket-1', 55000, db);

    expect(result.valid).toBe(true);
    expect(result.reason).toBeNull();
  });

  it('20. returns invalid when price exceeds ceiling', async () => {
    const db = makeDb([[makePredictionRow({ ceiling_price_halire: '75000' })]]);

    const result = await validateListingPrice('ticket-1', 80000, db);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('75000');
  });

  it('21. returns invalid when price is below floor', async () => {
    const db = makeDb([[makePredictionRow({ floor_price_halire: '40000' })]]);

    const result = await validateListingPrice('ticket-1', 30000, db);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('40000');
  });

  it('22. returns valid with null reason when no prediction exists', async () => {
    const db = makeDb([[]]); // no prediction

    const result = await validateListingPrice('ticket-new', 999999, db);

    expect(result.valid).toBe(true);
    expect(result.reason).toBeNull();
  });

  it('23. returns valid at exactly ceiling price', async () => {
    const db = makeDb([[makePredictionRow({ ceiling_price_halire: '75000' })]]);

    const result = await validateListingPrice('ticket-1', 75000, db);

    expect(result.valid).toBe(true);
  });

  it('24. returns valid at exactly floor price', async () => {
    const db = makeDb([[makePredictionRow({ floor_price_halire: '40000' })]]);

    const result = await validateListingPrice('ticket-1', 40000, db);

    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getEventResalePredictions
// ---------------------------------------------------------------------------

describe('getEventResalePredictions', () => {
  it('25. returns all predictions for an event', async () => {
    const db = makeDb([[
      makePredictionRow({ id: 'p1', ticket_id: 't1', predicted_price_halire: '70000' }),
      makePredictionRow({ id: 'p2', ticket_id: 't2', predicted_price_halire: '55000' }),
    ]]);

    const results = await getEventResalePredictions('event-1', db);

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('p1');
    expect(results[1].id).toBe('p2');
  });

  it('26. returns empty array when no predictions for event', async () => {
    const db = makeDb([[]]); // empty

    const results = await getEventResalePredictions('event-unknown', db);

    expect(results).toEqual([]);
  });

  it('27. queries by event_id', async () => {
    const db = makeDb([[makePredictionRow()]]);

    await getEventResalePredictions('event-42', db);

    const [sql, params] = (db.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sql).toContain('WHERE event_id = $1');
    expect(params[0]).toBe('event-42');
  });

  it('28. orders by predicted_price_halire DESC', async () => {
    const db = makeDb([[makePredictionRow()]]);

    await getEventResalePredictions('event-1', db);

    const [sql] = (db.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sql).toContain('ORDER BY predicted_price_halire DESC');
  });

  it('29. maps all rows correctly', async () => {
    const db = makeDb([[
      makePredictionRow({ id: 'p1', ticket_id: 't1' }),
      makePredictionRow({ id: 'p2', ticket_id: 't2' }),
      makePredictionRow({ id: 'p3', ticket_id: 't3' }),
    ]]);

    const results = await getEventResalePredictions('event-1', db);

    expect(results).toHaveLength(3);
    results.forEach(r => {
      expect(r.createdAt).toBeInstanceOf(Date);
      expect(r.updatedAt).toBeInstanceOf(Date);
      expect(typeof r.predictedPriceHalire).toBe('number');
    });
  });
});
