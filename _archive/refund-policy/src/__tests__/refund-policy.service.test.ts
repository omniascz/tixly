import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createPolicy,
  updatePolicy,
  setEventOverride,
  checkRefundEligibility,
  getDefaultPolicy,
  listPolicies,
} from '../services/refund-policy.service';
import { RefundError } from '../lib/refund-errors';
import type { ServiceDeps } from '../lib/service-container';
import type { RefundPolicy, RefundPolicyTier } from '../types/refund';

// ------------------------------------------------------------------ //
// Mock factories
// ------------------------------------------------------------------ //

function makeTierRow(overrides?: Partial<{
  id: string; policy_id: string; min_days_before: number;
  refund_pct: number; label: string | null; sort_order: number;
}>) {
  return {
    id: 'tier-1',
    policy_id: 'policy-1',
    min_days_before: 0,
    refund_pct: 10000,
    label: null,
    sort_order: 0,
    ...overrides,
  };
}

function makePolicyRow(overrides?: Record<string, unknown>) {
  return {
    id: 'policy-1',
    promoter_id: 'promoter-1',
    name: 'Výchozí politika',
    policy_type: 'full_refund',
    refund_percentage: null,
    refund_method: 'original_payment',
    allow_self_service: false,
    min_days_before_event: null,
    max_days_after_purchase: null,
    is_default: true,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeDeps(queryResponses: unknown[][], kafkaSend?: ReturnType<typeof vi.fn>): ServiceDeps {
  let callIdx = 0;
  const db = {
    query: vi.fn(async () => {
      const resp = queryResponses[callIdx++] ?? [];
      return resp;
    }),
    execute: vi.fn(async () => {}),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      // For transaction, pass a tx that also uses queryResponses
      const tx = {
        query: async () => {
          const resp = queryResponses[callIdx++] ?? [];
          return resp;
        },
        execute: vi.fn(async () => {}),
        transaction: async (fn2: (tx2: unknown) => Promise<unknown>) => fn2(tx),
      };
      return fn(tx);
    }),
  };
  const kafka = {
    send: kafkaSend ?? vi.fn().mockResolvedValue(undefined),
  };
  return { db, kafka } as unknown as ServiceDeps;
}

// ------------------------------------------------------------------ //
// createPolicy
// ------------------------------------------------------------------ //

describe('createPolicy', () => {
  it('full_refund — vytvoří policy bez tiers', async () => {
    const policyRow = makePolicyRow({ policy_type: 'full_refund' });
    const kafkaSend = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps(
      [
        // transaction: UPDATE previous default
        // INSERT policy → returns row
        [policyRow],
        // loadTiersForPolicy → no tiers (called after insert inside transaction)
        [],
      ],
      kafkaSend,
    );

    const result = await createPolicy('promoter-1', {
      policyType: 'full_refund',
      isDefault: true,
    }, deps);

    expect(result.policyType).toBe('full_refund');
    expect(result.tiers).toHaveLength(0);
    expect(kafkaSend).toHaveBeenCalledWith('refund_policy.created', expect.objectContaining({
      promoterId: 'promoter-1',
    }));
  });

  it('partial_refund bez refundPercentage → validační chyba', async () => {
    const deps = makeDeps([], vi.fn());
    await expect(
      createPolicy('promoter-1', { policyType: 'partial_refund' }, deps),
    ).rejects.toThrow();
  });

  it('tiered_refund bez tiers → validační chyba', async () => {
    const deps = makeDeps([], vi.fn());
    await expect(
      createPolicy('promoter-1', { policyType: 'tiered_refund', tiers: [] }, deps),
    ).rejects.toThrow();
  });

  it('partial_refund s refundPercentage 5000 → uloží percentage', async () => {
    const policyRow = makePolicyRow({
      policy_type: 'partial_refund',
      refund_percentage: 5000,
    });
    const kafkaSend = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps([[policyRow], []], kafkaSend);

    const result = await createPolicy('promoter-1', {
      policyType: 'partial_refund',
      refundPercentage: 5000,
    }, deps);

    expect(result.refundPercentage).toBe(5000);
  });

  it('nový default deaktivuje starý default (execute voláno)', async () => {
    const policyRow = makePolicyRow({ is_default: true });
    const kafkaSend = vi.fn().mockResolvedValue(undefined);

    let executeCallCount = 0;
    const db = {
      query: vi.fn(),
      execute: vi.fn(async () => { executeCallCount++; }),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        let qIdx = 0;
        const responses = [[policyRow], []];
        const tx = {
          query: vi.fn(async () => responses[qIdx++] ?? []),
          execute: vi.fn(async () => { executeCallCount++; }),
          transaction: async (fn2: (tx2: unknown) => Promise<unknown>) => fn2(tx),
        };
        return fn(tx);
      }),
    };
    const kafka = { send: kafkaSend };
    const deps = { db, kafka } as unknown as ServiceDeps;

    await createPolicy('promoter-1', { policyType: 'full_refund', isDefault: true }, deps);

    expect(executeCallCount).toBeGreaterThanOrEqual(1);
  });

  it('emituje Kafka refund_policy.created', async () => {
    const kafkaSend = vi.fn().mockResolvedValue(undefined);
    const policyRow = makePolicyRow();
    const deps = makeDeps([[policyRow], []], kafkaSend);

    await createPolicy('promoter-1', { policyType: 'full_refund' }, deps);

    expect(kafkaSend).toHaveBeenCalledWith(
      'refund_policy.created',
      expect.objectContaining({ policyId: 'policy-1' }),
    );
  });

  it('tiered_refund s tiery → uloží tiery', async () => {
    const policyRow = makePolicyRow({ policy_type: 'tiered_refund' });
    const tierRow1 = makeTierRow({ id: 't1', min_days_before: 30, refund_pct: 10000 });
    const tierRow2 = makeTierRow({ id: 't2', min_days_before: 0, refund_pct: 0 });
    const kafkaSend = vi.fn().mockResolvedValue(undefined);

    let qIdx = 0;
    const responses = [[policyRow], [tierRow1], [tierRow2]];
    const db = {
      query: vi.fn(),
      execute: vi.fn(async () => {}),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          query: vi.fn(async () => responses[qIdx++] ?? []),
          execute: vi.fn(async () => {}),
          transaction: async (fn2: (tx2: unknown) => Promise<unknown>) => fn2(tx),
        };
        return fn(tx);
      }),
    };
    const deps = { db, kafka: { send: kafkaSend } } as unknown as ServiceDeps;

    const result = await createPolicy('promoter-1', {
      policyType: 'tiered_refund',
      tiers: [
        { minDaysBefore: 30, refundPct: 10000, label: '30+ dní', sortOrder: 0 },
        { minDaysBefore: 0, refundPct: 0, label: '< 0 dní', sortOrder: 1 },
      ],
    }, deps);

    expect(result.tiers).toHaveLength(2);
  });
});

// ------------------------------------------------------------------ //
// checkRefundEligibility
// ------------------------------------------------------------------ //

describe('checkRefundEligibility', () => {
  const futureEvent = new Date(Date.now() + 60 * 86_400_000); // 60 dní v budoucnosti
  const purchasedAt = new Date(Date.now() - 5 * 86_400_000);  // koupeno 5 dní zpět
  const orderAmount = 100_00; // 100 Kč v haléřích

  function makeDefaultDeps(policyRow: Record<string, unknown>, tiers: unknown[] = []) {
    // checkRefundEligibility with eventId=null skips the event override query entirely
    // so sequence is: [defaultPolicy], [tiers]
    let qIdx = 0;
    const responses: unknown[][] = [
      [policyRow],   // default policy query
      tiers,         // tiers query
    ];
    const db = {
      query: vi.fn(async () => responses[qIdx++] ?? []),
      execute: vi.fn(async () => {}),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
    };
    return { db, kafka: { send: vi.fn() } } as unknown as ServiceDeps;
  }

  it('no_refund → eligible=false', async () => {
    const deps = makeDefaultDeps(makePolicyRow({ policy_type: 'no_refund' }));
    const result = await checkRefundEligibility(
      'order-1', null, futureEvent, purchasedAt, orderAmount, 'promoter-1', null, deps,
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('neumožňuje refundace');
    expect(result.code).toBe('POLICY_NO_REFUND');
    expect(result.refundableAmount).toBe(0);
  });

  it('full_refund → eligible=true, refundableAmount=orderAmount', async () => {
    const deps = makeDefaultDeps(makePolicyRow({ policy_type: 'full_refund' }));
    const result = await checkRefundEligibility(
      'order-1', null, futureEvent, purchasedAt, orderAmount, 'promoter-1', null, deps,
    );
    expect(result.eligible).toBe(true);
    expect(result.refundableAmount).toBe(orderAmount);
    expect(result.reason).toBeNull();
    expect(result.code).toBeNull();
  });

  it('partial_refund 50% → refundableAmount = orderAmount / 2', async () => {
    const deps = makeDefaultDeps(
      makePolicyRow({ policy_type: 'partial_refund', refund_percentage: 5000 }),
    );
    const result = await checkRefundEligibility(
      'order-1', null, futureEvent, purchasedAt, orderAmount, 'promoter-1', null, deps,
    );
    expect(result.eligible).toBe(true);
    expect(result.refundableAmount).toBe(Math.round(orderAmount * 5000 / 10_000));
  });

  it('partial_refund 50% — výsledek je INTEGER haléře (nikdy float)', async () => {
    const oddAmount = 10_001; // lichá částka
    const deps = makeDefaultDeps(
      makePolicyRow({ policy_type: 'partial_refund', refund_percentage: 5000 }),
    );
    const result = await checkRefundEligibility(
      'order-1', null, futureEvent, purchasedAt, oddAmount, 'promoter-1', null, deps,
    );
    expect(Number.isInteger(result.refundableAmount)).toBe(true);
  });

  it('credit_only → refundMethod=platform_credit', async () => {
    const deps = makeDefaultDeps(
      makePolicyRow({ policy_type: 'credit_only', refund_method: 'original_payment' }),
    );
    const result = await checkRefundEligibility(
      'order-1', null, futureEvent, purchasedAt, orderAmount, 'promoter-1', null, deps,
    );
    expect(result.eligible).toBe(true);
    expect(result.refundMethod).toBe('platform_credit');
    expect(result.refundableAmount).toBe(orderAmount);
  });

  it('minDaysBeforeEvent=7, event za 3 dny → ineligible', async () => {
    const nearEvent = new Date(Date.now() + 3 * 86_400_000);
    const deps = makeDefaultDeps(
      makePolicyRow({ policy_type: 'full_refund', min_days_before_event: 7 }),
    );
    const result = await checkRefundEligibility(
      'order-1', null, nearEvent, purchasedAt, orderAmount, 'promoter-1', null, deps,
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('Lhůta pro refundaci uplynula');
    expect(result.code).toBe('DEADLINE_PASSED');
  });

  it('maxDaysAfterPurchase=14, koupeno 20 dní zpět → ineligible', async () => {
    const oldPurchase = new Date(Date.now() - 20 * 86_400_000);
    const deps = makeDefaultDeps(
      makePolicyRow({ policy_type: 'full_refund', max_days_after_purchase: 14 }),
    );
    const result = await checkRefundEligibility(
      'order-1', null, futureEvent, oldPurchase, orderAmount, 'promoter-1', null, deps,
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('Uplynula lhůta od nákupu');
    expect(result.code).toBe('PURCHASE_WINDOW_EXPIRED');
  });

  it('tiered_refund 30+ dní = 100% → plná refundace', async () => {
    const tier100 = makeTierRow({ id: 't1', min_days_before: 30, refund_pct: 10000 });
    const tier0 = makeTierRow({ id: 't2', min_days_before: 0, refund_pct: 0 });
    const deps = makeDefaultDeps(
      makePolicyRow({ policy_type: 'tiered_refund' }),
      [tier100, tier0],
    );
    const result = await checkRefundEligibility(
      'order-1', null, futureEvent, purchasedAt, orderAmount, 'promoter-1', null, deps,
    );
    expect(result.eligible).toBe(true);
    expect(result.refundableAmount).toBe(orderAmount);
    expect(result.appliedTier).not.toBeNull();
    expect(result.appliedTier?.refundPct).toBe(10000);
  });

  it('tiered_refund 5 dní před akcí, nejnižší tier = 0% → ineligible', async () => {
    const nearEvent = new Date(Date.now() + 5 * 86_400_000);
    const tier30 = makeTierRow({ id: 't1', min_days_before: 30, refund_pct: 10000 });
    const tier7 = makeTierRow({ id: 't2', min_days_before: 7, refund_pct: 5000 });
    const tier0 = makeTierRow({ id: 't3', min_days_before: 0, refund_pct: 0 });
    const deps = makeDefaultDeps(
      makePolicyRow({ policy_type: 'tiered_refund' }),
      [tier30, tier7, tier0],
    );
    const result = await checkRefundEligibility(
      'order-1', null, nearEvent, purchasedAt, orderAmount, 'promoter-1', null, deps,
    );
    // 5 days < 7 days tier → falls to 0 pct tier
    expect(result.eligible).toBe(false);
    expect(result.refundableAmount).toBe(0);
  });

  it('tiered_refund — správný výpočet haléřů Math.round', async () => {
    const daysAway = new Date(Date.now() + 10 * 86_400_000); // 10 dní
    // tier: min_days_before=7 → refund_pct=7500 (75%)
    const tier30 = makeTierRow({ id: 't1', min_days_before: 30, refund_pct: 10000 });
    const tier7 = makeTierRow({ id: 't2', min_days_before: 7, refund_pct: 7500 });
    const tier0 = makeTierRow({ id: 't3', min_days_before: 0, refund_pct: 0 });
    const amount = 333_33; // 333,33 Kč
    const deps = makeDefaultDeps(
      makePolicyRow({ policy_type: 'tiered_refund' }),
      [tier30, tier7, tier0],
    );
    const result = await checkRefundEligibility(
      'order-1', null, daysAway, purchasedAt, amount, 'promoter-1', null, deps,
    );
    expect(result.eligible).toBe(true);
    expect(Number.isInteger(result.refundableAmount)).toBe(true);
    expect(result.refundableAmount).toBe(Math.round(amount * 7500 / 10_000));
  });

  it('event override přebije default policy', async () => {
    const overridePolicyRow = makePolicyRow({
      id: 'override-policy',
      policy_type: 'no_refund',
    });
    let qIdx = 0;
    const responses: unknown[][] = [
      [{ policy_id: 'override-policy' }], // event override found
      [overridePolicyRow],                 // load override policy
      [],                                  // tiers for override policy
    ];
    const db = {
      query: vi.fn(async () => responses[qIdx++] ?? []),
      execute: vi.fn(async () => {}),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
    };
    const deps = { db, kafka: { send: vi.fn() } } as unknown as ServiceDeps;

    const result = await checkRefundEligibility(
      'order-1', null, futureEvent, purchasedAt, orderAmount,
      'promoter-1', 'event-1', deps,
    );
    expect(result.policyId).toBe('override-policy');
    expect(result.eligible).toBe(false); // no_refund
  });
});

// ------------------------------------------------------------------ //
// setEventOverride
// ------------------------------------------------------------------ //

describe('setEventOverride', () => {
  it('UPSERT funguje — execute voláno', async () => {
    const db = {
      query: vi.fn().mockResolvedValue([{ id: 'policy-1' }]),
      execute: vi.fn().mockResolvedValue(undefined),
      transaction: vi.fn(),
    };
    const deps = { db, kafka: { send: vi.fn() } } as unknown as ServiceDeps;

    await setEventOverride('event-1', 'promoter-1', 'policy-1', deps);

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT'),
      expect.arrayContaining(['event-1', 'promoter-1', 'policy-1']),
    );
  });

  it('policy nepatří promotérovi → POLICY_NOT_FOUND', async () => {
    const db = {
      query: vi.fn().mockResolvedValue([]), // empty = not found
      execute: vi.fn(),
      transaction: vi.fn(),
    };
    const deps = { db, kafka: { send: vi.fn() } } as unknown as ServiceDeps;

    await expect(
      setEventOverride('event-1', 'promoter-1', 'wrong-policy', deps),
    ).rejects.toThrow(RefundError);
  });
});

// ------------------------------------------------------------------ //
// listPolicies
// ------------------------------------------------------------------ //

describe('listPolicies', () => {
  it('vrátí jen policy daného promotéra', async () => {
    const policy1 = makePolicyRow({ id: 'p1', promoter_id: 'promoter-1' });
    const policy2 = makePolicyRow({ id: 'p2', promoter_id: 'promoter-1', is_default: false });
    let qIdx = 0;
    // query[0] = list of policies, query[1] = bulk tiers for ALL policies (1 query, not N)
    const responses: unknown[][] = [[policy1, policy2], []];
    const db = {
      query: vi.fn(async () => responses[qIdx++] ?? []),
      execute: vi.fn(),
      transaction: vi.fn(),
    };
    const deps = { db, kafka: { send: vi.fn() } } as unknown as ServiceDeps;

    const result = await listPolicies('promoter-1', deps);
    expect(result).toHaveLength(2);
    expect(result.every((p) => p.promoterId === 'promoter-1')).toBe(true);
    // Verify only 2 DB queries fired (list + bulk tiers), not N+1
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it('vrátí prázdné pole když promotér nemá policies', async () => {
    const db = {
      query: vi.fn().mockResolvedValueOnce([]),
      execute: vi.fn(),
      transaction: vi.fn(),
    };
    const deps = { db, kafka: { send: vi.fn() } } as unknown as ServiceDeps;

    const result = await listPolicies('promoter-1', deps);
    expect(result).toHaveLength(0);
    // Only 1 query — no tiers query when policies list is empty
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('správně mapuje tiers k odpovídajícím policies', async () => {
    const policy1 = makePolicyRow({ id: 'p1', policy_type: 'tiered_refund' });
    const policy2 = makePolicyRow({ id: 'p2', policy_type: 'full_refund', is_default: false });
    const tier1 = makeTierRow({ id: 't1', policy_id: 'p1', min_days_before: 30, refund_pct: 10000 });
    const tier2 = makeTierRow({ id: 't2', policy_id: 'p1', min_days_before: 0, refund_pct: 0 });
    let qIdx = 0;
    const responses: unknown[][] = [[policy1, policy2], [tier1, tier2]];
    const db = {
      query: vi.fn(async () => responses[qIdx++] ?? []),
      execute: vi.fn(),
      transaction: vi.fn(),
    };
    const deps = { db, kafka: { send: vi.fn() } } as unknown as ServiceDeps;

    const result = await listPolicies('promoter-1', deps);
    const p1 = result.find((p) => p.id === 'p1')!;
    const p2 = result.find((p) => p.id === 'p2')!;
    expect(p1.tiers).toHaveLength(2);
    expect(p2.tiers).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ //
// getDefaultPolicy
// ------------------------------------------------------------------ //

describe('getDefaultPolicy', () => {
  it('vrátí is_default=true policy', async () => {
    const policy = makePolicyRow({ is_default: true });
    let qIdx = 0;
    const responses: unknown[][] = [[policy], []];
    const db = {
      query: vi.fn(async () => responses[qIdx++] ?? []),
      execute: vi.fn(),
      transaction: vi.fn(),
    };
    const deps = { db, kafka: { send: vi.fn() } } as unknown as ServiceDeps;

    const result = await getDefaultPolicy('promoter-1', deps);
    expect(result.isDefault).toBe(true);
  });

  it('žádná default policy → POLICY_NOT_FOUND', async () => {
    const db = {
      query: vi.fn().mockResolvedValue([]),
      execute: vi.fn(),
      transaction: vi.fn(),
    };
    const deps = { db, kafka: { send: vi.fn() } } as unknown as ServiceDeps;

    await expect(getDefaultPolicy('promoter-1', deps)).rejects.toThrow(RefundError);
  });
});
