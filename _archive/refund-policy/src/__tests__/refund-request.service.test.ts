import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createRefundRequest,
  processSelfServiceRefund,
  decideRefundRequest,
  markRefundProcessed,
  listRequestsForPromoter,
  listRequestsForUser,
  bulkRefundEventCancellation,
  csOverrideApproveRefund,
} from '../services/refund-request.service';
import { RefundError } from '../lib/refund-errors';
import type { ServiceDeps } from '../lib/service-container';

// ------------------------------------------------------------------ //
// Helpers
// ------------------------------------------------------------------ //

const FUTURE_EVENT = new Date(Date.now() + 60 * 86_400_000).toISOString();
const PURCHASED_AT = new Date(Date.now() - 2 * 86_400_000).toISOString();
const ORDER_AMOUNT = 50_000; // 500 Kč v haléřích

function makeOrderRow(overrides?: Record<string, unknown>) {
  return {
    id: 'order-1',
    promoter_id: 'promoter-1',
    user_id: 'user-1',
    amount: ORDER_AMOUNT,
    event_id: null,
    event_date: FUTURE_EVENT,
    purchased_at: PURCHASED_AT,
    ...overrides,
  };
}

function makeRequestRow(overrides?: Record<string, unknown>) {
  return {
    id: 'req-1',
    order_id: 'order-1',
    ticket_id: null,
    promoter_id: 'promoter-1',
    user_id: 'user-1',
    reason: 'Test reason',
    requested_amount: null,
    status: 'pending',
    decided_by: null,
    decided_at: null,
    decision_notes: null,
    refunded_amount: null,
    refund_method: null,
    processed_at: null,
    idempotency_key: 'idem-1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
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

/**
 * Build a deps where each deps.db.query call returns the next item from `responses`.
 */
function makeSequentialDeps(responses: unknown[][], kafkaSend = vi.fn().mockResolvedValue(undefined)): ServiceDeps {
  let idx = 0;
  const db = {
    query: vi.fn(async () => responses[idx++] ?? []),
    execute: vi.fn(async () => {}),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return { db, kafka: { send: kafkaSend } } as unknown as ServiceDeps;
}

// ------------------------------------------------------------------ //
// createRefundRequest
// ------------------------------------------------------------------ //

describe('createRefundRequest', () => {
  it('úspěch → status=pending, Kafka emitován', async () => {
    const kafkaSend = vi.fn().mockResolvedValue(undefined);
    const requestRow = makeRequestRow();
    // Sequence (eventId=null so override query is skipped):
    // 1. idempotency check
    // 2. loadOrder
    // 3. checkRefundEligibility: default policy
    // 4. checkRefundEligibility: tiers
    // 5. INSERT refund_requests
    const deps = makeSequentialDeps(
      [
        [],                 // idempotency check (no existing)
        [makeOrderRow()],   // load order
        [makePolicyRow()],  // default policy (no override since event_id=null)
        [],                 // tiers
        [requestRow],       // INSERT
      ],
      kafkaSend,
    );

    const result = await createRefundRequest({
      orderId: 'order-1',
      userId: 'user-1',
      promoterId: 'promoter-1',
      reason: 'Test reason',
      idempotencyKey: 'idem-1',
    }, deps);

    expect(result.status).toBe('pending');
    expect(kafkaSend).toHaveBeenCalledWith('refund.requested', expect.objectContaining({
      orderId: 'order-1',
    }));
  });

  it('idempotency — DUPLICATE_REQUEST', async () => {
    const deps = makeSequentialDeps([
      [makeRequestRow()], // existing record found
    ]);

    await expect(
      createRefundRequest({
        orderId: 'order-1',
        userId: 'user-1',
        promoterId: 'promoter-1',
        reason: 'Test',
        idempotencyKey: 'idem-1',
      }, deps),
    ).rejects.toThrow(expect.objectContaining({ code: 'DUPLICATE_REQUEST' }));
  });

  it('no_refund policy → NO_REFUND_POLICY', async () => {
    const deps = makeSequentialDeps([
      [],                                             // idempotency
      [makeOrderRow()],                               // order
      [makePolicyRow({ policy_type: 'no_refund' })],  // policy (event_id=null → no override query)
      [],                                             // tiers
    ]);

    await expect(
      createRefundRequest({
        orderId: 'order-1',
        userId: 'user-1',
        promoterId: 'promoter-1',
        reason: 'Test',
        idempotencyKey: 'idem-2',
      }, deps),
    ).rejects.toThrow(expect.objectContaining({ code: 'NO_REFUND_POLICY' }));
  });

  it('mimo lhůtu (event za 3 dny, minDays=7) → REFUND_NOT_ELIGIBLE', async () => {
    const nearEvent = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const deps = makeSequentialDeps([
      [],
      [makeOrderRow({ event_date: nearEvent })],
      [makePolicyRow({ policy_type: 'full_refund', min_days_before_event: 7 })],
      [],
    ]);

    await expect(
      createRefundRequest({
        orderId: 'order-1',
        userId: 'user-1',
        promoterId: 'promoter-1',
        reason: 'Mimo lhůtu',
        idempotencyKey: 'idem-3',
      }, deps),
    ).rejects.toThrow(expect.objectContaining({ code: 'REFUND_NOT_ELIGIBLE' }));
  });

  it('partial amount → uložen requestedAmount', async () => {
    const requestRow = makeRequestRow({ requested_amount: 10_000 });
    const kafkaSend = vi.fn().mockResolvedValue(undefined);
    const deps = makeSequentialDeps([
      [],
      [makeOrderRow()],
      [makePolicyRow()],
      [],
      [requestRow],
    ], kafkaSend);

    const result = await createRefundRequest({
      orderId: 'order-1',
      userId: 'user-1',
      promoterId: 'promoter-1',
      reason: 'Partial',
      requestedAmount: 10_000,
      idempotencyKey: 'idem-4',
    }, deps);

    expect(result.requestedAmount).toBe(10_000);
  });
});

// ------------------------------------------------------------------ //
// processSelfServiceRefund
// ------------------------------------------------------------------ //

describe('processSelfServiceRefund', () => {
  it('allow_self_service=true → zpracuje bez review, status=processed', async () => {
    const kafkaSend = vi.fn().mockResolvedValue(undefined);
    const requestRow = makeRequestRow({
      status: 'processed',
      refunded_amount: ORDER_AMOUNT,
      refund_method: 'original_payment',
    });
    // Sequence (event_id=null → no override query):
    // 1. idempotency, 2. loadOrder, 3. defaultPolicy, 4. tiers, 5. INSERT
    const deps = makeSequentialDeps([
      [],               // idempotency
      [makeOrderRow()], // order
      [makePolicyRow({ allow_self_service: true })], // policy
      [],               // tiers
      [requestRow],     // INSERT
    ], kafkaSend);

    const result = await processSelfServiceRefund(
      'order-1', null, 'user-1', 'idem-ss-1', deps,
    );

    expect(result.refundedAmount).toBe(ORDER_AMOUNT);
    expect(kafkaSend).toHaveBeenCalledWith('refund.processed', expect.objectContaining({
      refundedAmount: ORDER_AMOUNT,
    }));
  });

  it('allow_self_service=false → SELF_SERVICE_NOT_ALLOWED', async () => {
    const deps = makeSequentialDeps([
      [],
      [makeOrderRow()],
      [makePolicyRow({ allow_self_service: false })],
      [],
    ]);

    await expect(
      processSelfServiceRefund('order-1', null, 'user-1', 'idem-ss-2', deps),
    ).rejects.toThrow(expect.objectContaining({ code: 'SELF_SERVICE_NOT_ALLOWED' }));
  });

  it('emituje Kafka refund.processed', async () => {
    const kafkaSend = vi.fn().mockResolvedValue(undefined);
    const requestRow = makeRequestRow({
      status: 'processed',
      refunded_amount: ORDER_AMOUNT,
      refund_method: 'original_payment',
    });
    const deps = makeSequentialDeps([
      [],
      [makeOrderRow()],
      [makePolicyRow({ allow_self_service: true })],
      [],
      [requestRow],
    ], kafkaSend);

    await processSelfServiceRefund('order-1', null, 'user-1', 'idem-ss-3', deps);

    expect(kafkaSend).toHaveBeenCalledWith('refund.processed', expect.any(Object));
  });

  it('refundedAmount je INTEGER haléře (nikdy float)', async () => {
    const kafkaSend = vi.fn().mockResolvedValue(undefined);
    const oddAmount = 33_333; // lichá částka
    const expectedRefund = Math.round(oddAmount * 5000 / 10_000);
    const requestRow = makeRequestRow({
      status: 'processed',
      refunded_amount: expectedRefund,
      refund_method: 'original_payment',
    });
    const deps = makeSequentialDeps([
      [],
      [makeOrderRow({ amount: oddAmount })],
      [makePolicyRow({ allow_self_service: true, policy_type: 'partial_refund', refund_percentage: 5000 })],
      [],
      [requestRow],
    ], kafkaSend);

    const result = await processSelfServiceRefund('order-1', null, 'user-1', 'idem-ss-4', deps);
    expect(Number.isInteger(result.refundedAmount)).toBe(true);
  });
});

// ------------------------------------------------------------------ //
// decideRefundRequest
// ------------------------------------------------------------------ //

describe('decideRefundRequest', () => {
  it('approved → status=approved, Kafka refund.approved', async () => {
    const kafkaSend = vi.fn().mockResolvedValue(undefined);
    const updatedRow = makeRequestRow({ status: 'approved', decided_by: 'admin-1' });
    const deps = makeSequentialDeps([
      [makeRequestRow()], // load pending request
      [updatedRow],       // UPDATE
    ], kafkaSend);

    const result = await decideRefundRequest('req-1', 'approved', 'admin-1', undefined, undefined, deps);

    expect(result.status).toBe('approved');
    expect(kafkaSend).toHaveBeenCalledWith('refund.approved', expect.objectContaining({
      requestId: 'req-1',
    }));
  });

  it('rejected → status=rejected, Kafka refund.rejected', async () => {
    const kafkaSend = vi.fn().mockResolvedValue(undefined);
    const updatedRow = makeRequestRow({ status: 'rejected', decided_by: 'admin-1', decision_notes: 'Zamítnuto' });
    const deps = makeSequentialDeps([
      [makeRequestRow()],
      [updatedRow],
    ], kafkaSend);

    const result = await decideRefundRequest('req-1', 'rejected', 'admin-1', 'Zamítnuto', undefined, deps);

    expect(result.status).toBe('rejected');
    expect(kafkaSend).toHaveBeenCalledWith('refund.rejected', expect.objectContaining({
      requestId: 'req-1',
    }));
  });

  it('notes uloženy při rejected', async () => {
    const kafkaSend = vi.fn().mockResolvedValue(undefined);
    const updatedRow = makeRequestRow({ status: 'rejected', decision_notes: 'Důvod zamítnutí' });
    const deps = makeSequentialDeps([
      [makeRequestRow()],
      [updatedRow],
    ], kafkaSend);

    const result = await decideRefundRequest('req-1', 'rejected', 'admin-1', 'Důvod zamítnutí', undefined, deps);

    expect(result.decisionNotes).toBe('Důvod zamítnutí');
  });

  it('already decided → REQUEST_ALREADY_DECIDED', async () => {
    const deps = makeSequentialDeps([
      [makeRequestRow({ status: 'approved' })], // already decided
    ]);

    await expect(
      decideRefundRequest('req-1', 'rejected', 'admin-1', undefined, undefined, deps),
    ).rejects.toThrow(expect.objectContaining({ code: 'REQUEST_ALREADY_DECIDED' }));
  });

  it('overrideAmount > eligible → INVALID_AMOUNT', async () => {
    // decideRefundRequest with overrideAmount calls loadOrder + checkRefundEligibility
    // checkRefundEligibility with event_id=null skips override query
    const deps = makeSequentialDeps([
      [makeRequestRow()],               // load pending request
      [makeOrderRow()],                 // load order for eligibility
      [makePolicyRow()],                // default policy (full_refund, amount=50_000)
      [],                               // tiers
    ]);

    await expect(
      decideRefundRequest('req-1', 'approved', 'admin-1', undefined, ORDER_AMOUNT + 1, deps),
    ).rejects.toThrow(expect.objectContaining({ code: 'INVALID_AMOUNT' }));
  });

  it('REQUEST_NOT_FOUND pokud žádost neexistuje', async () => {
    const deps = makeSequentialDeps([
      [], // no request found
    ]);

    await expect(
      decideRefundRequest('nonexistent', 'approved', 'admin-1', undefined, undefined, deps),
    ).rejects.toThrow(expect.objectContaining({ code: 'REQUEST_NOT_FOUND' }));
  });
});

// ------------------------------------------------------------------ //
// markRefundProcessed
// ------------------------------------------------------------------ //

describe('markRefundProcessed', () => {
  it('status=processed, refunded_amount uložen', async () => {
    const kafkaSend = vi.fn().mockResolvedValue(undefined);
    const updatedRow = makeRequestRow({
      status: 'processed',
      refunded_amount: ORDER_AMOUNT,
      refund_method: 'original_payment',
      processed_at: new Date().toISOString(),
    });
    const deps = makeSequentialDeps([[updatedRow]], kafkaSend);

    const result = await markRefundProcessed('req-1', ORDER_AMOUNT, 'original_payment', deps);

    expect(result.status).toBe('processed');
    expect(result.refundedAmount).toBe(ORDER_AMOUNT);
    expect(kafkaSend).toHaveBeenCalledWith('refund.completed', expect.objectContaining({
      refundedAmount: ORDER_AMOUNT,
    }));
  });

  it('REQUEST_NOT_FOUND pokud UPDATE vrátí prázdno', async () => {
    const deps = makeSequentialDeps([[]]);

    await expect(
      markRefundProcessed('nonexistent', ORDER_AMOUNT, 'original_payment', deps),
    ).rejects.toThrow(expect.objectContaining({ code: 'REQUEST_NOT_FOUND' }));
  });
});

// ------------------------------------------------------------------ //
// listRequestsForPromoter
// ------------------------------------------------------------------ //

describe('listRequestsForPromoter', () => {
  it('filtr status=pending vrátí správná data', async () => {
    const row1 = makeRequestRow({ id: 'r1', status: 'pending' });
    const row2 = makeRequestRow({ id: 'r2', status: 'pending' });
    const deps = makeSequentialDeps([
      [{ count: '2' }],   // COUNT
      [row1, row2],       // SELECT
    ]);

    const result = await listRequestsForPromoter(
      'promoter-1',
      { status: 'pending' },
      { limit: 50, offset: 0 },
      deps,
    );

    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(result.items.every((r) => r.status === 'pending')).toBe(true);
  });

  it('paginace funguje — vrátí total i items', async () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      makeRequestRow({ id: `r${i}`, status: 'pending' }),
    );
    const deps = makeSequentialDeps([
      [{ count: '100' }], // COUNT = 100 celkem
      rows,               // SELECT prvních 5
    ]);

    const result = await listRequestsForPromoter(
      'promoter-1',
      {},
      { limit: 5, offset: 0 },
      deps,
    );

    expect(result.total).toBe(100);
    expect(result.items).toHaveLength(5);
  });
});

// ------------------------------------------------------------------ //
// listRequestsForUser
// ------------------------------------------------------------------ //

describe('listRequestsForUser', () => {
  it('vrátí jen žádosti daného userId', async () => {
    const row1 = makeRequestRow({ id: 'r1', user_id: 'user-42' });
    const row2 = makeRequestRow({ id: 'r2', user_id: 'user-42' });
    const deps = makeSequentialDeps([[row1, row2]]);

    const result = await listRequestsForUser('user-42', {}, deps);

    expect(result).toHaveLength(2);
    expect(result.every((r) => r.userId === 'user-42')).toBe(true);
  });

  it('prázdný seznam pro neznámého uživatele', async () => {
    const deps = makeSequentialDeps([[]]);
    const result = await listRequestsForUser('unknown-user', {}, deps);
    expect(result).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ //
// Kafka fire-and-forget — selhání Kafky neblokuje response
// ------------------------------------------------------------------ //

describe('Kafka fire-and-forget', () => {
  it('selhání Kafky neblokuje createRefundRequest', async () => {
    const kafkaSend = vi.fn().mockRejectedValue(new Error('Kafka down'));
    const requestRow = makeRequestRow();
    const deps = makeSequentialDeps([
      [],
      [makeOrderRow()],
      [makePolicyRow()],
      [],
      [requestRow],
    ], kafkaSend);

    // Should NOT throw even though Kafka fails
    const result = await createRefundRequest({
      orderId: 'order-1',
      userId: 'user-1',
      promoterId: 'promoter-1',
      reason: 'Test',
      idempotencyKey: 'idem-kafka-1',
    }, deps);

    expect(result.status).toBe('pending');
  });

  it('selhání Kafky neblokuje markRefundProcessed', async () => {
    const kafkaSend = vi.fn().mockRejectedValue(new Error('Kafka down'));
    const updatedRow = makeRequestRow({
      status: 'processed',
      refunded_amount: ORDER_AMOUNT,
      refund_method: 'original_payment',
    });
    const deps = makeSequentialDeps([[updatedRow]], kafkaSend);

    const result = await markRefundProcessed('req-1', ORDER_AMOUNT, 'original_payment', deps);
    expect(result.status).toBe('processed');
  });
});

// ------------------------------------------------------------------ //
// bulkRefundEventCancellation
// ------------------------------------------------------------------ //

describe('bulkRefundEventCancellation', () => {
  it('creates approved refund_requests for paid orders, emits Kafka, returns counts', async () => {
    const kafkaSend = vi.fn().mockResolvedValue(undefined);
    const order1 = makeOrderRow({ id: 'order-1', user_id: 'u1', amount: 50_000 });
    const order2 = makeOrderRow({ id: 'order-2', user_id: 'u2', amount: 30_000 });

    // Sequence:
    // 1. SELECT paid orders → [order1, order2]
    // 2. existing check order-1 → []
    // 3. INSERT refund_request order-1 → [row]
    // 4. existing check order-2 → []
    // 5. INSERT refund_request order-2 → [row]
    const deps = makeSequentialDeps(
      [
        [order1, order2],
        [],
        [makeRequestRow({ id: 'r1', order_id: 'order-1', status: 'approved' })],
        [],
        [makeRequestRow({ id: 'r2', order_id: 'order-2', status: 'approved' })],
      ],
      kafkaSend,
    );

    const result = await bulkRefundEventCancellation(
      'event-1', 'promoter-1', 'Event cancelled', 'admin-1', deps,
    );

    expect(result).toEqual({ total: 2, refunded: 2, skipped: 0 });
    expect(kafkaSend).toHaveBeenCalledWith(
      'refund.bulk_event_cancellation',
      expect.objectContaining({ eventId: 'event-1', promoterId: 'promoter-1', total: 2, refunded: 2 }),
    );
  });

  it('skips orders that already have an approved or processed refund_request', async () => {
    const kafkaSend = vi.fn().mockResolvedValue(undefined);
    const order1 = makeOrderRow({ id: 'order-1' });
    const order2 = makeOrderRow({ id: 'order-2', user_id: 'u2' });

    // Sequence:
    // 1. SELECT paid orders
    // 2. existing check order-1 → already approved
    // 3. existing check order-2 → empty
    // 4. INSERT refund_request order-2
    const deps = makeSequentialDeps(
      [
        [order1, order2],
        [{ id: 'existing-req' }],
        [],
        [makeRequestRow({ id: 'r2', order_id: 'order-2', status: 'approved' })],
      ],
      kafkaSend,
    );

    const result = await bulkRefundEventCancellation(
      'event-1', 'promoter-1', 'Cancelled', 'admin-1', deps,
    );

    expect(result).toEqual({ total: 2, refunded: 1, skipped: 1 });
  });
});

// ------------------------------------------------------------------ //
// csOverrideApproveRefund
// ------------------------------------------------------------------ //

describe('csOverrideApproveRefund', () => {
  it('marks request approved with CS override note, emits Kafka', async () => {
    const kafkaSend = vi.fn().mockResolvedValue(undefined);
    const pendingRow = makeRequestRow({ status: 'pending', requested_amount: 20_000 });
    const updatedRow = makeRequestRow({
      status: 'approved',
      decided_by: 'admin-1',
      decision_notes: 'CS override: Customer complaint',
      refunded_amount: 20_000,
    });

    // Sequence: 1. SELECT request, 2. UPDATE request
    const deps = makeSequentialDeps(
      [
        [pendingRow],
        [updatedRow],
      ],
      kafkaSend,
    );

    const result = await csOverrideApproveRefund(
      'req-1', 'admin-1', 'Customer complaint', deps,
    );

    expect(result.status).toBe('approved');
    expect(result.decisionNotes).toBe('CS override: Customer complaint');
    expect(kafkaSend).toHaveBeenCalledWith(
      'refund.cs_override',
      expect.objectContaining({ requestId: 'req-1', adminUserId: 'admin-1' }),
    );
  });

  it('throws REFUND_ALREADY_PROCESSED when request is already approved', async () => {
    const deps = makeSequentialDeps([
      [makeRequestRow({ status: 'approved' })],
    ]);

    await expect(
      csOverrideApproveRefund('req-1', 'admin-1', 'reason', deps),
    ).rejects.toThrow(expect.objectContaining({ code: 'REFUND_ALREADY_PROCESSED' }));
  });

  it('throws REFUND_ALREADY_PROCESSED when request is already processed', async () => {
    const deps = makeSequentialDeps([
      [makeRequestRow({ status: 'processed' })],
    ]);

    await expect(
      csOverrideApproveRefund('req-1', 'admin-1', 'reason', deps),
    ).rejects.toThrow(expect.objectContaining({ code: 'REFUND_ALREADY_PROCESSED' }));
  });
});

// ------------------------------------------------------------------ //
// tiered_refund výpočet — INTEGER haléře
// ------------------------------------------------------------------ //

describe('tiered_refund haléře', () => {
  it('Math.round(amount * pct / 10000) → vždy INTEGER', async () => {
    const amount = 99_99; // 99,99 Kč — lichá částka
    const kafkaSend = vi.fn().mockResolvedValue(undefined);

    const tier50 = {
      id: 't1', policy_id: 'p1', min_days_before: 0,
      refund_pct: 5000, label: '50%', sort_order: 0,
    };

    // Sequence: idempotency, loadOrder, policy, tiers, INSERT
    const deps = makeSequentialDeps([
      [],
      [makeOrderRow({ amount })],
      [makePolicyRow({
        allow_self_service: true,
        policy_type: 'tiered_refund',
        refund_method: 'original_payment',
      })],
      [tier50],
      [makeRequestRow({ refunded_amount: Math.round(amount * 5000 / 10_000), status: 'processed' })],
    ], kafkaSend);

    const result = await processSelfServiceRefund('order-1', null, 'user-1', 'idem-tier-1', deps);
    expect(Number.isInteger(result.refundedAmount)).toBe(true);
  });
});
