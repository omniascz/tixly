import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  enqueueFraudCase,
  listFraudQueue,
  getFraudCase,
  reviewFraudCase,
  getFraudStats,
  claimCase,
  escalateCase,
  getOverdueCases,
  computeSlaDeadline,
  CLAIM_LOCK_MINUTES,
  type FraudDeps,
  type EnqueueInput,
} from '../services/fraud-queue.service';
import { FraudError } from '../lib/fraud-errors';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb(queryResults: unknown[][] = []) {
  let idx = 0;
  return {
    query: vi.fn().mockImplementation(() => Promise.resolve(queryResults[idx++] ?? [])),
    execute: vi.fn().mockResolvedValue(undefined),
  };
}

function makeEventBus() {
  return { send: vi.fn().mockResolvedValue(undefined) };
}

function makeDeps(db: ReturnType<typeof makeDb>): FraudDeps {
  return { db: db as unknown as FraudDeps['db'], eventBus: makeEventBus() };
}

const BASE_INPUT: EnqueueInput = {
  orderId: '11111111-0000-0000-0000-000000000001',
  userId:  '22222222-0000-0000-0000-000000000002',
  amountHellers: 200000,
  riskScore: 75,
  signals: [
    { rule: 'velocity_check', detail: '4 orders in 8min', score: 35 },
    { rule: 'geo_mismatch',   detail: 'billing=CZ ip=CN',  score: 20 },
  ],
  orderHeld: true,
};

const MOCK_CASE_ROW = {
  id: 'case-uuid',
  order_id: BASE_INPUT.orderId,
  user_id: BASE_INPUT.userId,
  promoter_id: null,
  event_id: null,
  amount_hellers: 200000,
  currency: 'CZK',
  risk_score: 75,
  signals: BASE_INPUT.signals,
  status: 'pending_review',
  priority: 'high',
  order_held: true,
  ip_address: null,
  user_agent: null,
  country_code: null,
  reviewed_by: null,
  reviewed_at: null,
  created_at: '2026-04-06T10:00:00.000Z',
};

// ---------------------------------------------------------------------------
// 1. enqueueFraudCase
// ---------------------------------------------------------------------------

describe('enqueueFraudCase', () => {
  it('vytvoří nový fraud case a vrátí caseId', async () => {
    const db = makeDb([
      [],                        // SELECT existujícího → prázdno
      [{ id: 'new-case-uuid' }], // INSERT RETURNING
    ]);
    const { caseId } = await enqueueFraudCase(BASE_INPUT, makeDeps(db));
    expect(caseId).toBe('new-case-uuid');
    expect(db.execute).not.toHaveBeenCalled(); // enqueue nepoužívá execute
  });

  it('nastaví priority=high pro riskScore 60-79', async () => {
    const db = makeDb([[], [{ id: 'case-1' }]]);
    await enqueueFraudCase({ ...BASE_INPUT, riskScore: 65 }, makeDeps(db));
    const insertCall = db.query.mock.calls[1];
    expect(insertCall[1]).toContain('high'); // priority parametr
  });

  it('nastaví priority=critical pro riskScore >= 80', async () => {
    const db = makeDb([[], [{ id: 'case-2' }]]);
    await enqueueFraudCase({ ...BASE_INPUT, riskScore: 85 }, makeDeps(db));
    const insertCall = db.query.mock.calls[1];
    expect(insertCall[1]).toContain('critical');
  });

  it('nastaví priority=normal pro riskScore < 60', async () => {
    const db = makeDb([[], [{ id: 'case-3' }]]);
    await enqueueFraudCase({ ...BASE_INPUT, riskScore: 45 }, makeDeps(db));
    const insertCall = db.query.mock.calls[1];
    expect(insertCall[1]).toContain('normal');
  });

  it('hodí DUPLICATE_ORDER pokud order_id už existuje', async () => {
    const db = makeDb([[{ id: 'existing-case' }]]); // SELECT vrátí záznam
    try {
      await enqueueFraudCase(BASE_INPUT, makeDeps(db));
      expect.fail('Měla se hodit chyba');
    } catch (err) {
      expect(err instanceof FraudError && err.code).toBe('DUPLICATE_ORDER');
    }
  });

  it('emituje Kafka event po úspěšném enqueue', async () => {
    const db = makeDb([[], [{ id: 'case-ev' }]]);
    const eventBus = makeEventBus();
    await enqueueFraudCase(BASE_INPUT, { db: db as unknown as FraudDeps['db'], eventBus });
    // Event je fire-and-forget, ale mock je synchronní
    expect(eventBus.send).toHaveBeenCalledWith(
      'risk.fraud_case.created',
      expect.objectContaining({ orderId: BASE_INPUT.orderId }),
    );
  });
});

// ---------------------------------------------------------------------------
// 2. listFraudQueue
// ---------------------------------------------------------------------------

describe('listFraudQueue', () => {
  it('vrátí items a total', async () => {
    const db = makeDb([[MOCK_CASE_ROW], [{ count: '1' }]]);
    const result = await listFraudQueue({ limit: 20, offset: 0 }, makeDeps(db));
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.items[0].orderId).toBe(BASE_INPUT.orderId);
  });

  it('mapuje snake_case na camelCase', async () => {
    const db = makeDb([[MOCK_CASE_ROW], [{ count: '1' }]]);
    const result = await listFraudQueue({ limit: 10, offset: 0 }, makeDeps(db));
    const item = result.items[0];
    expect(item.riskScore).toBe(75);
    expect(item.amountHellers).toBe(200000);
    expect(item.orderHeld).toBe(true);
  });

  it('vrátí prázdné pole pokud nic není', async () => {
    const db = makeDb([[], [{ count: '0' }]]);
    const result = await listFraudQueue({ limit: 20, offset: 0 }, makeDeps(db));
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. getFraudCase
// ---------------------------------------------------------------------------

describe('getFraudCase', () => {
  it('vrátí detail případu s reviews', async () => {
    const reviewRow = {
      id: 'rev-1', admin_user_id: 'admin-uuid',
      decision: 'add_note', notes: 'Prověřuji.',
      ban_buyer: false, created_at: '2026-04-06T11:00:00.000Z',
    };
    const db = makeDb([[MOCK_CASE_ROW], [reviewRow]]);
    const detail = await getFraudCase('case-uuid', makeDeps(db));
    expect(detail.id).toBe('case-uuid');
    expect(detail.reviews).toHaveLength(1);
    expect(detail.reviews[0].decision).toBe('add_note');
  });

  it('hodí CASE_NOT_FOUND pokud neexistuje', async () => {
    const db = makeDb([[]]); // prázdný výsledek
    try {
      await getFraudCase('nope', makeDeps(db));
      expect.fail('Měla se hodit chyba');
    } catch (err) {
      expect(err instanceof FraudError && err.code).toBe('CASE_NOT_FOUND');
    }
  });
});

// ---------------------------------------------------------------------------
// 4. reviewFraudCase
// ---------------------------------------------------------------------------

describe('reviewFraudCase — happy path', () => {
  const adminId = 'admin-uuid';
  const caseId = 'case-uuid';

  it('clear: stav → cleared', async () => {
    const db = makeDb([[{ id: caseId, status: 'pending_review', order_id: 'ord-1', user_id: 'usr-1' }]]);
    await reviewFraudCase(caseId, adminId, { decision: 'clear' }, makeDeps(db));
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE risk.fraud_cases'),
      expect.arrayContaining(['cleared']),
    );
  });

  it('confirm_fraud: stav → confirmed_fraud (s notes)', async () => {
    const db = makeDb([[{ id: caseId, status: 'pending_review', order_id: 'ord-1', user_id: 'usr-1' }]]);
    await reviewFraudCase(caseId, adminId, { decision: 'confirm_fraud', notes: 'Card testing série.' }, makeDeps(db));
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE risk.fraud_cases'),
      expect.arrayContaining(['confirmed_fraud']),
    );
  });

  it('escalate: stav → escalated, priorita → critical', async () => {
    const db = makeDb([[{ id: caseId, status: 'pending_review', order_id: 'ord-1', user_id: 'usr-1' }]]);
    await reviewFraudCase(caseId, adminId, { decision: 'escalate', notes: 'Potřeba vyšší autorizace.' }, makeDeps(db));
    const updateCall = db.execute.mock.calls[0];
    expect(updateCall[1]).toContain('escalated');
    expect(updateCall[1]).toContain('critical');
  });

  it('add_note: stav se nemění', async () => {
    const db = makeDb([[{ id: caseId, status: 'pending_review', order_id: 'ord-1', user_id: 'usr-1' }]]);
    await reviewFraudCase(caseId, adminId, { decision: 'add_note', notes: 'Kontaktoval jsem promotéra.' }, makeDeps(db));
    const updateCall = db.execute.mock.calls[0];
    // pending_review stav zůstává (add_note vrací původní status)
    expect(updateCall[1]).toContain('pending_review');
  });

  it('zapíše audit záznam do fraud_reviews', async () => {
    const db = makeDb([[{ id: caseId, status: 'pending_review', order_id: 'ord-1', user_id: 'usr-1' }]]);
    await reviewFraudCase(caseId, adminId, { decision: 'clear' }, makeDeps(db));
    const insertCall = db.execute.mock.calls[1];
    expect(insertCall[0]).toContain('INSERT INTO risk.fraud_reviews');
    expect(insertCall[1]).toContain(adminId);
    expect(insertCall[1]).toContain('clear');
  });

  it('emituje správný Kafka event pro clear', async () => {
    const db = makeDb([[{ id: caseId, status: 'pending_review', order_id: 'ord-1', user_id: 'usr-1' }]]);
    const eventBus = makeEventBus();
    await reviewFraudCase(caseId, adminId, { decision: 'clear' }, { db: db as unknown as FraudDeps['db'], eventBus });
    expect(eventBus.send).toHaveBeenCalledWith(
      'risk.fraud_case.cleared',
      expect.objectContaining({ caseId, adminUserId: adminId }),
    );
  });
});

describe('reviewFraudCase — chybové stavy', () => {
  const adminId = 'admin-uuid';
  const caseId = 'case-uuid';

  it('hodí CASE_NOT_FOUND pokud case neexistuje', async () => {
    const db = makeDb([[]]);
    try {
      await reviewFraudCase(caseId, adminId, { decision: 'clear' }, makeDeps(db));
      expect.fail('Měla se hodit chyba');
    } catch (err) {
      expect(err instanceof FraudError && err.code).toBe('CASE_NOT_FOUND');
    }
  });

  it('hodí CASE_ALREADY_RESOLVED pro cleared case', async () => {
    const db = makeDb([[{ id: caseId, status: 'cleared', order_id: 'ord-1', user_id: 'usr-1' }]]);
    try {
      await reviewFraudCase(caseId, adminId, { decision: 'clear' }, makeDeps(db));
      expect.fail('Měla se hodit chyba');
    } catch (err) {
      expect(err instanceof FraudError && err.code).toBe('CASE_ALREADY_RESOLVED');
    }
  });

  it('hodí CASE_ALREADY_RESOLVED pro confirmed_fraud case', async () => {
    const db = makeDb([[{ id: caseId, status: 'confirmed_fraud', order_id: 'ord-1', user_id: 'usr-1' }]]);
    try {
      await reviewFraudCase(caseId, adminId, { decision: 'clear' }, makeDeps(db));
      expect.fail('Měla se hodit chyba');
    } catch (err) {
      expect(err instanceof FraudError && err.code).toBe('CASE_ALREADY_RESOLVED');
    }
  });

  it('hodí NOTES_REQUIRED pro confirm_fraud bez notes', async () => {
    const db = makeDb([[{ id: caseId, status: 'pending_review', order_id: 'ord-1', user_id: 'usr-1' }]]);
    try {
      await reviewFraudCase(caseId, adminId, { decision: 'confirm_fraud' }, makeDeps(db));
      expect.fail('Měla se hodit chyba');
    } catch (err) {
      expect(err instanceof FraudError && err.code).toBe('NOTES_REQUIRED');
    }
  });

  it('hodí NOTES_REQUIRED pro escalate bez notes', async () => {
    const db = makeDb([[{ id: caseId, status: 'pending_review', order_id: 'ord-1', user_id: 'usr-1' }]]);
    try {
      await reviewFraudCase(caseId, adminId, { decision: 'escalate', notes: 'AB' }, makeDeps(db));
      expect.fail('Měla se hodit chyba');
    } catch (err) {
      expect(err instanceof FraudError && err.code).toBe('NOTES_REQUIRED');
    }
  });
});

// ---------------------------------------------------------------------------
// 5. getFraudStats
// ---------------------------------------------------------------------------

describe('getFraudStats', () => {
  it('vrátí správně parsované statistiky', async () => {
    const db = makeDb([
      [{ count: '5', total_held: '750000' }],
      [{ resolved: '10', confirmed: '3', cleared: '7', avg_score: '68.5' }],
    ]);
    const stats = await getFraudStats(makeDeps(db));
    expect(stats.pendingReview).toBe(5);
    expect(stats.totalHeldHellers).toBe(750000);
    expect(stats.resolvedToday).toBe(10);
    expect(stats.confirmedFraudToday).toBe(3);
    expect(stats.clearedToday).toBe(7);
    expect(stats.avgRiskScore).toBe(68.5);
  });

  it('vrátí null pro avgRiskScore pokud není data', async () => {
    const db = makeDb([
      [{ count: '0', total_held: '0' }],
      [{ resolved: '0', confirmed: '0', cleared: '0', avg_score: null }],
    ]);
    const stats = await getFraudStats(makeDeps(db));
    expect(stats.avgRiskScore).toBeNull();
    expect(stats.totalHeldHellers).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. FraudError — chybová třída
// ---------------------------------------------------------------------------

describe('FraudError', () => {
  it('má správný statusCode pro CASE_NOT_FOUND', () => {
    const err = new FraudError('CASE_NOT_FOUND');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('CASE_NOT_FOUND');
  });

  it('má správný statusCode pro DUPLICATE_ORDER', () => {
    expect(new FraudError('DUPLICATE_ORDER').statusCode).toBe(409);
  });

  it('má správný statusCode pro NOTES_REQUIRED', () => {
    expect(new FraudError('NOTES_REQUIRED').statusCode).toBe(422);
  });

  it('toHttpError vrátí správný tvar', () => {
    const http = new FraudError('CASE_NOT_FOUND').toHttpError();
    expect(http).toMatchObject({ error: 'CASE_NOT_FOUND', statusCode: 404 });
    expect(typeof http.message).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// SLA deadline per severity
// ---------------------------------------------------------------------------

describe('computeSlaDeadline', () => {
  const NOW = new Date('2026-04-08T12:00:00.000Z');

  it('critical = NOW + 2h', () => {
    const d = computeSlaDeadline('critical', NOW);
    expect(d.toISOString()).toBe('2026-04-08T14:00:00.000Z');
  });

  it('high = NOW + 6h', () => {
    const d = computeSlaDeadline('high', NOW);
    expect(d.toISOString()).toBe('2026-04-08T18:00:00.000Z');
  });

  it('normal = NOW + 24h', () => {
    const d = computeSlaDeadline('normal', NOW);
    expect(d.toISOString()).toBe('2026-04-09T12:00:00.000Z');
  });

  it('low = NOW + 72h', () => {
    const d = computeSlaDeadline('low', NOW);
    expect(d.toISOString()).toBe('2026-04-11T12:00:00.000Z');
  });

  it('unknown priority → fallback normal', () => {
    const d = computeSlaDeadline('weird', NOW);
    expect(d.toISOString()).toBe('2026-04-09T12:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// Dedup ingest by (source_module, source_ref_id)
// ---------------------------------------------------------------------------

describe('enqueueFraudCase — dedup by source', () => {
  it('odmítne druhý ingest se stejným source_module + source_ref_id', async () => {
    // 1) no duplicate order, 2) existing source ref
    const db = makeDb([
      [],                          // SELECT by order_id
      [{ id: 'existing-case' }],   // SELECT by source_module + source_ref_id
    ]);
    const deps = makeDeps(db);

    await expect(
      enqueueFraudCase(
        { ...BASE_INPUT, sourceModule: 'gopay-payments', sourceRefId: 'gp-tx-777' },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'DUPLICATE_SOURCE_REF' });

    // No insert occurred
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('povolí ingest, pokud source_ref neexistuje, a uloží sla_deadline_at', async () => {
    const db = makeDb([
      [],                      // no duplicate order
      [],                      // no duplicate source ref
      [{ id: 'new-case-id' }], // INSERT RETURNING id
    ]);
    const deps = makeDeps(db);

    const result = await enqueueFraudCase(
      { ...BASE_INPUT, sourceModule: 'device-fingerprinting', sourceRefId: 'fp-42' },
      deps,
    );

    expect(result.caseId).toBe('new-case-id');

    // Find INSERT call
    const insertCall = db.query.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO risk.fraud_cases'),
    );
    expect(insertCall).toBeDefined();
    const params = insertCall![1] as unknown[];
    // source_module, source_ref_id, sla_deadline_at jsou v posledních třech pozicích
    expect(params).toContain('device-fingerprinting');
    expect(params).toContain('fp-42');
    const slaParam = params[params.length - 1];
    expect(typeof slaParam).toBe('string');
    expect(new Date(slaParam as string).getTime()).toBeGreaterThan(Date.now());
  });
});

// ---------------------------------------------------------------------------
// Audit trail rows on review
// ---------------------------------------------------------------------------

describe('reviewFraudCase — audit trail', () => {
  it('zapisuje řádek do fraud_case_audit při každém review', async () => {
    const db = makeDb([
      [{ id: 'case-1', status: 'pending_review', order_id: 'order-1', user_id: 'user-1' }],
    ]);
    const deps = makeDeps(db);

    await reviewFraudCase(
      'case-1',
      'cs-agent-1',
      { decision: 'clear', notes: 'legitimate' },
      deps,
    );

    const auditCall = db.execute.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('fraud_case_audit'),
    );
    expect(auditCall).toBeDefined();
    const params = auditCall![1] as unknown[];
    expect(params[0]).toBe('case-1');
    expect(params[1]).toBe('cs-agent-1');
    expect(params[2]).toBe('pending_review');
    expect(params[3]).toBe('cleared');
  });
});

// ---------------------------------------------------------------------------
// Claim conflict scenario
// ---------------------------------------------------------------------------

describe('claimCase', () => {
  it('povolí claim nepřiřazeného případu', async () => {
    const db = makeDb([
      [{ id: 'c1', status: 'pending_review', claimed_by_user_id: null, claimed_at: null }],
    ]);
    const deps = makeDeps(db);
    await expect(claimCase('c1', 'cs-A', deps)).resolves.toBeUndefined();
    expect(db.execute).toHaveBeenCalled();
  });

  it('odmítne claim, pokud je případ claimed jiným agentem v posledních 30 min', async () => {
    const recentClaim = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const db = makeDb([
      [{ id: 'c1', status: 'reviewing', claimed_by_user_id: 'cs-B', claimed_at: recentClaim }],
    ]);
    const deps = makeDeps(db);
    await expect(claimCase('c1', 'cs-A', deps)).rejects.toMatchObject({
      code: 'CASE_ALREADY_CLAIMED',
    });
  });

  it('povolí re-claim, pokud starý lock vypršel (>30 min)', async () => {
    const oldClaim = new Date(Date.now() - (CLAIM_LOCK_MINUTES + 5) * 60 * 1000).toISOString();
    const db = makeDb([
      [{ id: 'c1', status: 'reviewing', claimed_by_user_id: 'cs-B', claimed_at: oldClaim }],
    ]);
    const deps = makeDeps(db);
    await expect(claimCase('c1', 'cs-A', deps)).resolves.toBeUndefined();
  });

  it('stejný uživatel může re-claimnout svůj případ', async () => {
    const db = makeDb([
      [{
        id: 'c1',
        status: 'reviewing',
        claimed_by_user_id: 'cs-A',
        claimed_at: new Date().toISOString(),
      }],
    ]);
    const deps = makeDeps(db);
    await expect(claimCase('c1', 'cs-A', deps)).resolves.toBeUndefined();
  });

  it('odmítne claim neexistujícího case', async () => {
    const db = makeDb([[]]);
    const deps = makeDeps(db);
    await expect(claimCase('nope', 'cs-A', deps)).rejects.toMatchObject({
      code: 'CASE_NOT_FOUND',
    });
  });
});

// ---------------------------------------------------------------------------
// escalateCase
// ---------------------------------------------------------------------------

describe('escalateCase', () => {
  it('emituje fraud.case.escalated a bumpne priority na critical', async () => {
    const db = makeDb([
      [{ id: 'c1', status: 'pending_review', order_id: 'o1', priority: 'high' }],
    ]);
    const eventBus = { send: vi.fn().mockResolvedValue(undefined) };
    const deps: FraudDeps = { db: db as unknown as FraudDeps['db'], eventBus };

    await escalateCase('c1', 'Suspicious patterns across 3 modules', 'cs-A', deps);

    // wait microtask so the fire-and-forget catch attaches
    await Promise.resolve();

    expect(eventBus.send).toHaveBeenCalledWith(
      'fraud.case.escalated',
      expect.objectContaining({ caseId: 'c1', csUserId: 'cs-A' }),
    );

    const updateCall = db.execute.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes("priority = 'critical'"),
    );
    expect(updateCall).toBeDefined();
  });

  it('odmítne krátký reason', async () => {
    const db = makeDb([]);
    const deps = makeDeps(db);
    await expect(escalateCase('c1', 'no', 'cs-A', deps)).rejects.toMatchObject({
      code: 'NOTES_REQUIRED',
    });
  });
});

// ---------------------------------------------------------------------------
// getOverdueCases
// ---------------------------------------------------------------------------

describe('getOverdueCases', () => {
  it('vrátí pouze případy po SLA deadline', async () => {
    const db = makeDb([
      [
        {
          id: 'c1',
          order_id: 'o1',
          priority: 'high',
          risk_score: 80,
          sla_deadline_at: '2026-04-08T10:00:00.000Z',
          overdue_minutes: '125.5',
        },
      ],
    ]);
    const deps = makeDeps(db);
    const result = await getOverdueCases(deps);
    expect(result).toHaveLength(1);
    expect(result[0].overdueMinutes).toBe(125);
  });
});
