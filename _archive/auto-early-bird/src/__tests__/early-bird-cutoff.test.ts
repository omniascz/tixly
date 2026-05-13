import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  predictEarlyBirdCutoff,
  acceptEarlyBirdCutoff,
  getEarlyBirdCutoff,
  expireStaleRecommendations,
  type MlAdapter,
  type DbAdapter,
  type CutoffPredictionInput,
  type CutoffPredictionOutput,
} from '../services/early-bird-cutoff.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LAUNCH_DATE = new Date('2025-01-01T00:00:00.000Z');
const EVENT_DATE  = new Date('2025-06-01T00:00:00.000Z');
const CUTOFF_DATE = new Date('2025-03-15T00:00:00.000Z');

function makeCutoffRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cutoff-1',
    event_id: 'event-1',
    promoter_id: 'promoter-1',
    recommended_cutoff_date: CUTOFF_DATE.toISOString(),
    accepted_cutoff_date: null,
    status: 'pending',
    confidence_score: '0.85',
    estimated_sell_through: '0.28',
    reasoning: 'Based on current velocity',
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

function makeMl(output: Partial<CutoffPredictionOutput> = {}): MlAdapter {
  return {
    predictCutoffDate: vi.fn().mockResolvedValue({
      recommendedCutoffDate: CUTOFF_DATE,
      confidenceScore: 0.85,
      estimatedSellThroughAtCutoff: 0.28,
      reasoning: 'Based on current velocity',
      ...output,
    }),
  };
}

const BASE_INPUT = {
  eventId: 'event-1',
  promoterId: 'promoter-1',
  eventDate: EVENT_DATE,
  launchDate: LAUNCH_DATE,
  ticketsSoldSinceLaunch: 100,
  totalCapacity: 500,
};

// ---------------------------------------------------------------------------
// predictEarlyBirdCutoff
// ---------------------------------------------------------------------------

describe('predictEarlyBirdCutoff', () => {
  it('1. calls ML adapter with correct input and returns mapped cutoff', async () => {
    const ml = makeMl();
    const db = makeDb([[makeCutoffRow()]]);

    const result = await predictEarlyBirdCutoff(BASE_INPUT, ml, db);

    expect(ml.predictCutoffDate).toHaveBeenCalledOnce();
    const mlCall = (ml.predictCutoffDate as ReturnType<typeof vi.fn>).mock.calls[0][0] as CutoffPredictionInput;
    expect(mlCall.eventId).toBe('event-1');
    expect(mlCall.totalCapacity).toBe(500);
    expect(mlCall.earlyBirdTargetPct).toBe(0.30);

    expect(result.id).toBe('cutoff-1');
    expect(result.eventId).toBe('event-1');
    expect(result.status).toBe('pending');
    expect(result.confidenceScore).toBe(0.85);
    expect(result.estimatedSellThrough).toBe(0.28);
    expect(result.recommendedCutoffDate).toEqual(CUTOFF_DATE);
  });

  it('2. uses custom earlyBirdTargetPct when provided', async () => {
    const ml = makeMl();
    const db = makeDb([[makeCutoffRow()]]);

    await predictEarlyBirdCutoff({ ...BASE_INPUT, earlyBirdTargetPct: 0.25 }, ml, db);

    const mlCall = (ml.predictCutoffDate as ReturnType<typeof vi.fn>).mock.calls[0][0] as CutoffPredictionInput;
    expect(mlCall.earlyBirdTargetPct).toBe(0.25);
  });

  it('3. defaults earlyBirdTargetPct to 0.30 when not provided', async () => {
    const ml = makeMl();
    const db = makeDb([[makeCutoffRow()]]);

    await predictEarlyBirdCutoff(BASE_INPUT, ml, db);

    const mlCall = (ml.predictCutoffDate as ReturnType<typeof vi.fn>).mock.calls[0][0] as CutoffPredictionInput;
    expect(mlCall.earlyBirdTargetPct).toBe(0.30);
  });

  it('4. computes positive historicalVelocityPerDay when tickets sold', async () => {
    const ml = makeMl();
    const db = makeDb([[makeCutoffRow()]]);

    await predictEarlyBirdCutoff({ ...BASE_INPUT, ticketsSoldSinceLaunch: 50 }, ml, db);

    const mlCall = (ml.predictCutoffDate as ReturnType<typeof vi.fn>).mock.calls[0][0] as CutoffPredictionInput;
    expect(mlCall.historicalVelocityPerDay).toBeGreaterThan(0);
  });

  it('5. passes null historicalVelocityPerDay when ticketsSoldSinceLaunch is 0', async () => {
    const ml = makeMl();
    const db = makeDb([[makeCutoffRow()]]);

    await predictEarlyBirdCutoff({ ...BASE_INPUT, ticketsSoldSinceLaunch: 0 }, ml, db);

    const mlCall = (ml.predictCutoffDate as ReturnType<typeof vi.fn>).mock.calls[0][0] as CutoffPredictionInput;
    expect(mlCall.historicalVelocityPerDay).toBeNull();
  });

  it('6. throws VALIDATION_ERROR when totalCapacity <= 0', async () => {
    const ml = makeMl();
    const db = makeDb([[]]);

    await expect(
      predictEarlyBirdCutoff({ ...BASE_INPUT, totalCapacity: 0 }, ml, db),
    ).rejects.toThrow('VALIDATION_ERROR: totalCapacity must be positive');
  });

  it('7. throws VALIDATION_ERROR when totalCapacity is negative', async () => {
    const ml = makeMl();
    const db = makeDb([[]]);

    await expect(
      predictEarlyBirdCutoff({ ...BASE_INPUT, totalCapacity: -10 }, ml, db),
    ).rejects.toThrow('VALIDATION_ERROR: totalCapacity must be positive');
  });

  it('8. throws VALIDATION_ERROR when ticketsSoldSinceLaunch < 0', async () => {
    const ml = makeMl();
    const db = makeDb([[]]);

    await expect(
      predictEarlyBirdCutoff({ ...BASE_INPUT, ticketsSoldSinceLaunch: -1 }, ml, db),
    ).rejects.toThrow('VALIDATION_ERROR: ticketsSoldSinceLaunch cannot be negative');
  });

  it('9. throws VALIDATION_ERROR when eventDate is not after launchDate', async () => {
    const ml = makeMl();
    const db = makeDb([[]]);

    await expect(
      predictEarlyBirdCutoff({ ...BASE_INPUT, eventDate: LAUNCH_DATE }, ml, db),
    ).rejects.toThrow('VALIDATION_ERROR: eventDate must be after launchDate');
  });

  it('10. throws VALIDATION_ERROR when eventDate is before launchDate', async () => {
    const ml = makeMl();
    const db = makeDb([[]]);

    await expect(
      predictEarlyBirdCutoff({
        ...BASE_INPUT,
        eventDate: new Date('2024-12-01T00:00:00.000Z'),
      }, ml, db),
    ).rejects.toThrow('VALIDATION_ERROR: eventDate must be after launchDate');
  });

  it('11. upserts into DB with correct parameters', async () => {
    const ml = makeMl();
    const db = makeDb([[makeCutoffRow()]]);

    await predictEarlyBirdCutoff(BASE_INPUT, ml, db);

    expect(db.query).toHaveBeenCalledOnce();
    const [sql, params] = (db.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sql).toContain('INSERT INTO ml.early_bird_cutoffs');
    expect(sql).toContain('ON CONFLICT');
    expect(params[0]).toBe('event-1');
    expect(params[1]).toBe('promoter-1');
    expect(params[2]).toBe(CUTOFF_DATE.toISOString());
    expect(params[3]).toBe(0.85);
    expect(params[4]).toBe(0.28);
  });

  it('12. correctly maps returned row fields', async () => {
    const ml = makeMl();
    const db = makeDb([[makeCutoffRow({
      id: 'cutoff-abc',
      promoter_id: 'promoter-xyz',
      reasoning: 'high velocity',
    })]]);

    const result = await predictEarlyBirdCutoff(BASE_INPUT, ml, db);

    expect(result.id).toBe('cutoff-abc');
    expect(result.promoterId).toBe('promoter-xyz');
    expect(result.reasoning).toBe('high velocity');
    expect(result.acceptedCutoffDate).toBeNull();
    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.updatedAt).toBeInstanceOf(Date);
  });

  it('13. ML adapter receives eventDate and launchDate as Date objects', async () => {
    const ml = makeMl();
    const db = makeDb([[makeCutoffRow()]]);

    await predictEarlyBirdCutoff(BASE_INPUT, ml, db);

    const mlCall = (ml.predictCutoffDate as ReturnType<typeof vi.fn>).mock.calls[0][0] as CutoffPredictionInput;
    expect(mlCall.eventDate).toBeInstanceOf(Date);
    expect(mlCall.launchDate).toBeInstanceOf(Date);
    expect(mlCall.eventDate).toEqual(EVENT_DATE);
    expect(mlCall.launchDate).toEqual(LAUNCH_DATE);
  });

  it('14. handles ML prediction with low confidence score', async () => {
    const ml = makeMl({ confidenceScore: 0.1, estimatedSellThroughAtCutoff: 0.05 });
    const db = makeDb([[makeCutoffRow({
      confidence_score: '0.1',
      estimated_sell_through: '0.05',
    })]]);

    const result = await predictEarlyBirdCutoff(BASE_INPUT, ml, db);

    expect(result.confidenceScore).toBe(0.1);
    expect(result.estimatedSellThrough).toBe(0.05);
  });

  it('15. handles high sell-through (near capacity)', async () => {
    const ml = makeMl();
    const db = makeDb([[makeCutoffRow()]]);

    await predictEarlyBirdCutoff({
      ...BASE_INPUT,
      ticketsSoldSinceLaunch: 450,
      totalCapacity: 500,
    }, ml, db);

    const mlCall = (ml.predictCutoffDate as ReturnType<typeof vi.fn>).mock.calls[0][0] as CutoffPredictionInput;
    expect(mlCall.ticketsSoldSinceLaunch).toBe(450);
    expect(mlCall.totalCapacity).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// acceptEarlyBirdCutoff
// ---------------------------------------------------------------------------

describe('acceptEarlyBirdCutoff', () => {
  it('16. accepts recommendation with no custom date → status = accepted', async () => {
    const pendingRow = makeCutoffRow();
    const acceptedRow = makeCutoffRow({
      accepted_cutoff_date: CUTOFF_DATE.toISOString(),
      status: 'accepted',
    });
    const db = makeDb([[pendingRow], [acceptedRow]]);

    const result = await acceptEarlyBirdCutoff('event-1', 'promoter-1', null, db);

    expect(result.status).toBe('accepted');
    expect(result.acceptedCutoffDate).toEqual(CUTOFF_DATE);
  });

  it('17. accepts with custom date → status = overridden', async () => {
    const customDate = new Date('2025-02-28T00:00:00.000Z');
    const pendingRow = makeCutoffRow();
    const overriddenRow = makeCutoffRow({
      accepted_cutoff_date: customDate.toISOString(),
      status: 'overridden',
    });
    const db = makeDb([[pendingRow], [overriddenRow]]);

    const result = await acceptEarlyBirdCutoff('event-1', 'promoter-1', customDate, db);

    expect(result.status).toBe('overridden');
    expect(result.acceptedCutoffDate).toEqual(customDate);
  });

  it('18. throws CUTOFF_NOT_FOUND when no record exists', async () => {
    const db = makeDb([[]]); // empty result

    await expect(
      acceptEarlyBirdCutoff('event-1', 'promoter-1', null, db),
    ).rejects.toThrow('CUTOFF_NOT_FOUND');
  });

  it('19. throws INVALID_STATUS when status is accepted', async () => {
    const db = makeDb([[makeCutoffRow({ status: 'accepted' })]]);

    await expect(
      acceptEarlyBirdCutoff('event-1', 'promoter-1', null, db),
    ).rejects.toThrow('INVALID_STATUS: accepted');
  });

  it('20. throws INVALID_STATUS when status is overridden', async () => {
    const db = makeDb([[makeCutoffRow({ status: 'overridden' })]]);

    await expect(
      acceptEarlyBirdCutoff('event-1', 'promoter-1', null, db),
    ).rejects.toThrow('INVALID_STATUS: overridden');
  });

  it('21. throws INVALID_STATUS when status is expired', async () => {
    const db = makeDb([[makeCutoffRow({ status: 'expired' })]]);

    await expect(
      acceptEarlyBirdCutoff('event-1', 'promoter-1', null, db),
    ).rejects.toThrow('INVALID_STATUS: expired');
  });

  it('22. uses recommended_cutoff_date when customDate is null', async () => {
    const pendingRow = makeCutoffRow();
    const acceptedRow = makeCutoffRow({
      accepted_cutoff_date: CUTOFF_DATE.toISOString(),
      status: 'accepted',
    });
    const db = makeDb([[pendingRow], [acceptedRow]]);

    await acceptEarlyBirdCutoff('event-1', 'promoter-1', null, db);

    const [, params] = (db.query as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(params[2]).toBe(CUTOFF_DATE.toISOString());
    expect(params[3]).toBe('accepted');
  });

  it('23. passes custom date to UPDATE query when overriding', async () => {
    const customDate = new Date('2025-02-15T00:00:00.000Z');
    const db = makeDb([[makeCutoffRow()], [makeCutoffRow({
      accepted_cutoff_date: customDate.toISOString(),
      status: 'overridden',
    })]]);

    await acceptEarlyBirdCutoff('event-1', 'promoter-1', customDate, db);

    const [, params] = (db.query as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(params[2]).toBe(customDate.toISOString());
    expect(params[3]).toBe('overridden');
  });

  it('24. queries with correct eventId and promoterId', async () => {
    const db = makeDb([[makeCutoffRow()], [makeCutoffRow({ status: 'accepted' })]]);

    await acceptEarlyBirdCutoff('event-42', 'promoter-99', null, db);

    const [, selectParams] = (db.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(selectParams[0]).toBe('event-42');
    expect(selectParams[1]).toBe('promoter-99');
  });
});

// ---------------------------------------------------------------------------
// getEarlyBirdCutoff
// ---------------------------------------------------------------------------

describe('getEarlyBirdCutoff', () => {
  it('25. returns mapped cutoff when found', async () => {
    const db = makeDb([[makeCutoffRow()]]);

    const result = await getEarlyBirdCutoff('event-1', db);

    expect(result).not.toBeNull();
    expect(result!.id).toBe('cutoff-1');
    expect(result!.eventId).toBe('event-1');
    expect(result!.recommendedCutoffDate).toEqual(CUTOFF_DATE);
  });

  it('26. returns null when no cutoff found', async () => {
    const db = makeDb([[]]); // empty

    const result = await getEarlyBirdCutoff('event-unknown', db);

    expect(result).toBeNull();
  });

  it('27. queries by eventId only', async () => {
    const db = makeDb([[makeCutoffRow()]]);

    await getEarlyBirdCutoff('event-77', db);

    const [sql, params] = (db.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sql).toContain('WHERE event_id = $1');
    expect(params[0]).toBe('event-77');
    expect(params).toHaveLength(1);
  });

  it('28. correctly maps acceptedCutoffDate when set', async () => {
    const acceptedDate = '2025-03-01T00:00:00.000Z';
    const db = makeDb([[makeCutoffRow({
      accepted_cutoff_date: acceptedDate,
      status: 'accepted',
    })]]);

    const result = await getEarlyBirdCutoff('event-1', db);

    expect(result!.acceptedCutoffDate).toEqual(new Date(acceptedDate));
    expect(result!.status).toBe('accepted');
  });

  it('29. maps acceptedCutoffDate as null when not set', async () => {
    const db = makeDb([[makeCutoffRow({ accepted_cutoff_date: null })]]);

    const result = await getEarlyBirdCutoff('event-1', db);

    expect(result!.acceptedCutoffDate).toBeNull();
  });

  it('30. maps numeric fields from string DB values', async () => {
    const db = makeDb([[makeCutoffRow({
      confidence_score: '0.92',
      estimated_sell_through: '0.31',
    })]]);

    const result = await getEarlyBirdCutoff('event-1', db);

    expect(typeof result!.confidenceScore).toBe('number');
    expect(result!.confidenceScore).toBe(0.92);
    expect(typeof result!.estimatedSellThrough).toBe('number');
    expect(result!.estimatedSellThrough).toBe(0.31);
  });
});

// ---------------------------------------------------------------------------
// expireStaleRecommendations
// ---------------------------------------------------------------------------

describe('expireStaleRecommendations', () => {
  it('31. returns count of expired records', async () => {
    const db = makeDb([[{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]]);

    const count = await expireStaleRecommendations(db);

    expect(count).toBe(3);
  });

  it('32. returns 0 when nothing to expire', async () => {
    const db = makeDb([[]]); // empty

    const count = await expireStaleRecommendations(db);

    expect(count).toBe(0);
  });

  it('33. issues UPDATE query filtering pending and past recommended_cutoff_date', async () => {
    const db = makeDb([[{ id: 'c1' }]]);

    await expireStaleRecommendations(db);

    const [sql] = (db.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sql).toContain("status = 'expired'");
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain('recommended_cutoff_date < NOW()');
  });

  it('34. returns 1 when exactly one record expired', async () => {
    const db = makeDb([[{ id: 'c1' }]]);

    const count = await expireStaleRecommendations(db);

    expect(count).toBe(1);
  });
});
