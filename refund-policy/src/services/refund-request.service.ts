import { RefundError } from '../lib/refund-errors';
import { ServiceDeps } from '../lib/service-container';
import { RefundMethod, RefundRequest, RefundRequestStatus } from '../types/refund';
import { checkRefundEligibility } from './refund-policy.service';
import { withTenantContext } from '@tixly/rls-multitenancy';

// ------------------------------------------------------------------ //
// TenantContext
// ------------------------------------------------------------------ //

export type TenantContext = {
  promoterId?: string;
  userId?: string;
  role: 'service' | 'admin' | 'promoter' | 'buyer';
};

// ------------------------------------------------------------------ //
// DB row shape
// ------------------------------------------------------------------ //

interface DbRefundRequest {
  id: string;
  order_id: string;
  ticket_id: string | null;
  promoter_id: string;
  user_id: string;
  reason: string;
  requested_amount: number | null;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_notes: string | null;
  refunded_amount: number | null;
  refund_method: string | null;
  processed_at: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

// ------------------------------------------------------------------ //
// DB order/ticket row (minimal shape used internally)
// ------------------------------------------------------------------ //

interface DbOrderLookup {
  id: string;
  promoter_id: string;
  user_id: string;
  amount: number;         // haléře — celková částka objednávky
  event_id: string | null;
  event_date: string;
  purchased_at: string;
}

// ------------------------------------------------------------------ //
// Mapper
// ------------------------------------------------------------------ //

function mapRequest(row: DbRefundRequest): RefundRequest {
  return {
    id: row.id,
    orderId: row.order_id,
    ticketId: row.ticket_id,
    promoterId: row.promoter_id,
    userId: row.user_id,
    reason: row.reason,
    requestedAmount: row.requested_amount,
    status: row.status as RefundRequestStatus,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    decisionNotes: row.decision_notes,
    refundedAmount: row.refunded_amount,
    refundMethod: row.refund_method as RefundMethod | null,
    processedAt: row.processed_at,
    createdAt: row.created_at,
  };
}

// ------------------------------------------------------------------ //
// Helper: load order
// ------------------------------------------------------------------ //

async function loadOrder(orderId: string, db: ServiceDeps['db']): Promise<DbOrderLookup> {
  const rows = await db.query<DbOrderLookup>(
    `SELECT id, promoter_id, user_id, amount, event_id, event_date, purchased_at
       FROM orders.orders
      WHERE id = $1`,
    [orderId],
  );
  if (rows.length === 0) {
    throw new RefundError('ORDER_NOT_FOUND');
  }
  return rows[0];
}

// ------------------------------------------------------------------ //
// createRefundRequest
// ------------------------------------------------------------------ //

export async function createRefundRequest(
  input: {
    orderId: string;
    ticketId?: string;
    userId: string;
    promoterId: string;
    reason: string;
    requestedAmount?: number;
    idempotencyKey: string;
  },
  deps: ServiceDeps,
  context: TenantContext = { role: 'buyer', userId: undefined },
): Promise<RefundRequest> {
  return withTenantContext(deps.db, context, async (db) => {
  // Idempotency guard — atomický pre-check; skutečný upsert proběhne při INSERT níže
  const existingCheck = await db.query<DbRefundRequest>(
    `SELECT * FROM platform.refund_requests WHERE idempotency_key = $1`,
    [input.idempotencyKey],
  );
  if (existingCheck.length > 0) {
    throw new RefundError('DUPLICATE_REQUEST');
  }

  const order = await loadOrder(input.orderId, db);

  const eligibility = await checkRefundEligibility(
    input.orderId,
    input.ticketId ?? null,
    new Date(order.event_date),
    new Date(order.purchased_at),
    order.amount,
    input.promoterId,
    order.event_id,
    deps,
  );

  if (!eligibility.eligible) {
    if (eligibility.code === 'POLICY_NO_REFUND') {
      throw new RefundError('NO_REFUND_POLICY', eligibility.reason ?? undefined);
    }
    throw new RefundError('REFUND_NOT_ELIGIBLE', eligibility.reason ?? undefined);
  }

  if (input.requestedAmount != null && input.requestedAmount > eligibility.refundableAmount) {
    throw new RefundError('INVALID_AMOUNT', 'Požadovaná částka překračuje maximální eligible částku');
  }

  const insertResult = await db.query<DbRefundRequest>(
    `INSERT INTO platform.refund_requests
       (order_id, ticket_id, promoter_id, user_id, reason, requested_amount,
        status, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING *`,
    [
      input.orderId,
      input.ticketId ?? null,
      input.promoterId,
      input.userId,
      input.reason,
      input.requestedAmount ?? null,
      input.idempotencyKey,
    ],
  );

  let row: DbRefundRequest;
  if (insertResult.length === 0) {
    // Conflict — souběžný request se stejným idempotency key; vrátíme existující záznam
    const existing = await db.query<DbRefundRequest>(
      `SELECT * FROM platform.refund_requests WHERE idempotency_key = $1`,
      [input.idempotencyKey],
    );
    row = existing[0];
  } else {
    row = insertResult[0];
  }

  deps.kafka
    .send('refund.requested', {
      requestId: row.id,
      orderId: input.orderId,
      userId: input.userId,
      promoterId: input.promoterId,
    })
    .catch(() => {});

  return mapRequest(row);
  }); // end withTenantContext
}

// ------------------------------------------------------------------ //
// processSelfServiceRefund
// ------------------------------------------------------------------ //

export async function processSelfServiceRefund(
  orderId: string,
  ticketId: string | null,
  userId: string,
  idempotencyKey: string,
  deps: ServiceDeps,
  context: TenantContext = { role: 'buyer', userId },
): Promise<{ refundedAmount: number; refundMethod: RefundMethod }> {
  return withTenantContext(deps.db, context, async (db) => {
  // Idempotency guard — vrátí předchozí výsledek při opakovaném volání
  const existingCheck = await db.query<DbRefundRequest>(
    `SELECT * FROM platform.refund_requests WHERE idempotency_key = $1`,
    [idempotencyKey],
  );
  if (existingCheck.length > 0) {
    const prev = existingCheck[0];
    return {
      refundedAmount: prev.refunded_amount ?? 0,
      refundMethod: (prev.refund_method as RefundMethod) ?? 'original_payment',
    };
  }

  const order = await loadOrder(orderId, db);

  const eligibility = await checkRefundEligibility(
    orderId,
    ticketId,
    new Date(order.event_date),
    new Date(order.purchased_at),
    order.amount,
    order.promoter_id,
    order.event_id,
    deps,
  );

  if (!eligibility.eligible) {
    throw new RefundError('REFUND_NOT_ELIGIBLE', eligibility.reason ?? undefined);
  }

  if (!eligibility.eligible || eligibility.requiresRequest) {
    // policy requires a support request
    throw new RefundError('SELF_SERVICE_NOT_ALLOWED');
  }

  const refundedAmount = eligibility.refundableAmount;
  const refundMethod = eligibility.refundMethod;

  const selfServiceInsert = await db.query<DbRefundRequest>(
    `INSERT INTO platform.refund_requests
       (order_id, ticket_id, promoter_id, user_id, reason,
        requested_amount, status, refunded_amount, refund_method,
        processed_at, idempotency_key)
     VALUES ($1,$2,$3,$4,'self-service',$5,'processed',$6,$7,NOW(),$8)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING *`,
    [
      orderId,
      ticketId,
      order.promoter_id,
      userId,
      refundedAmount,
      refundedAmount,
      refundMethod,
      idempotencyKey,
    ],
  );

  let row: DbRefundRequest;
  if (selfServiceInsert.length === 0) {
    const existing = await db.query<DbRefundRequest>(
      `SELECT * FROM platform.refund_requests WHERE idempotency_key = $1`,
      [idempotencyKey],
    );
    row = existing[0];
  } else {
    row = selfServiceInsert[0];
  }

  deps.kafka
    .send('refund.processed', {
      requestId: row.id,
      orderId,
      userId,
      refundedAmount,
      refundMethod,
    })
    .catch(() => {});

  return { refundedAmount, refundMethod };
  }); // end withTenantContext
}

// ------------------------------------------------------------------ //
// decideRefundRequest
// ------------------------------------------------------------------ //

export async function decideRefundRequest(
  requestId: string,
  decision: 'approved' | 'rejected',
  decidedBy: string,
  notes?: string,
  overrideAmount?: number,
  deps?: ServiceDeps,
  context: TenantContext = { role: 'admin' },
): Promise<RefundRequest> {
  if (!deps) {
    throw new RefundError('REQUEST_NOT_FOUND', 'ServiceDeps je povinné');
  }

  return withTenantContext(deps.db, context, async (db) => {
  const rows = await db.query<DbRefundRequest>(
    `SELECT * FROM platform.refund_requests WHERE id = $1`,
    [requestId],
  );
  if (rows.length === 0) {
    throw new RefundError('REQUEST_NOT_FOUND');
  }

  const request = rows[0];

  if (request.status !== 'pending') {
    throw new RefundError('REQUEST_ALREADY_DECIDED');
  }

  if (decision === 'approved' && overrideAmount != null) {
    // Zjisti max eligible amount
    const order = await loadOrder(request.order_id, db);
    const eligibility = await checkRefundEligibility(
      request.order_id,
      request.ticket_id,
      new Date(order.event_date),
      new Date(order.purchased_at),
      order.amount,
      request.promoter_id,
      order.event_id,
      deps,
      context,
    );
    if (overrideAmount > eligibility.refundableAmount) {
      throw new RefundError('INVALID_AMOUNT', 'overrideAmount překračuje maximální eligible částku');
    }
  }

  const [updated] = await db.query<DbRefundRequest>(
    `UPDATE platform.refund_requests
        SET status        = $1,
            decided_by    = $2,
            decided_at    = NOW(),
            decision_notes= $3,
            updated_at    = NOW()
      WHERE id = $4
      RETURNING *`,
    [decision, decidedBy, notes ?? null, requestId],
  );

  if (decision === 'approved') {
    deps.kafka
      .send('refund.approved', {
        requestId,
        orderId: updated.order_id,
        overrideAmount: overrideAmount ?? null,
      })
      .catch(() => {});
  } else {
    deps.kafka
      .send('refund.rejected', {
        requestId,
        orderId: updated.order_id,
        userId: updated.user_id,
        notes,
      })
      .catch(() => {});
  }

  return mapRequest(updated);
  }); // end withTenantContext
}

// ------------------------------------------------------------------ //
// markRefundProcessed
// ------------------------------------------------------------------ //

export async function markRefundProcessed(
  requestId: string,
  refundedAmount: number,
  refundMethod: RefundMethod,
  deps: ServiceDeps,
  context: TenantContext = { role: 'service' },
): Promise<RefundRequest> {
  return withTenantContext(deps.db, context, async (db) => {
  const [updated] = await db.query<DbRefundRequest>(
    `UPDATE platform.refund_requests
        SET status          = 'processed',
            refunded_amount = $1,
            refund_method   = $2,
            processed_at    = NOW(),
            updated_at      = NOW()
      WHERE id = $3
      RETURNING *`,
    [refundedAmount, refundMethod, requestId],
  );
  if (!updated) {
    throw new RefundError('REQUEST_NOT_FOUND');
  }

  deps.kafka
    .send('refund.completed', {
      requestId,
      orderId: updated.order_id,
      refundedAmount,
      refundMethod,
    })
    .catch(() => {});

  return mapRequest(updated);
  }); // end withTenantContext
}

// ------------------------------------------------------------------ //
// listRequestsForPromoter
// ------------------------------------------------------------------ //

export async function listRequestsForPromoter(
  promoterId: string,
  filters: { status?: RefundRequestStatus; from?: string; to?: string },
  pagination: { limit?: number; offset?: number },
  deps: ServiceDeps,
  context: TenantContext = { role: 'promoter', promoterId },
): Promise<{ items: RefundRequest[]; total: number }> {
  return withTenantContext(deps.db, context, async (db) => {
  const limit = pagination.limit ?? 50;
  const offset = pagination.offset ?? 0;

  const conditions: string[] = ['promoter_id = $1'];
  const params: unknown[] = [promoterId];
  let idx = 2;

  if (filters.status) {
    conditions.push(`status = $${idx++}`);
    params.push(filters.status);
  }
  if (filters.from) {
    conditions.push(`created_at >= $${idx++}`);
    params.push(filters.from);
  }
  if (filters.to) {
    conditions.push(`created_at <= $${idx++}`);
    params.push(filters.to);
  }

  const where = conditions.join(' AND ');

  const countRows = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM platform.refund_requests WHERE ${where}`,
    params,
  );
  const total = parseInt(countRows[0].count, 10);

  const dataParams = [...params, limit, offset];
  const rows = await db.query<DbRefundRequest>(
    `SELECT * FROM platform.refund_requests
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}`,
    dataParams,
  );

  return { items: rows.map(mapRequest), total };
  }); // end withTenantContext
}

// ------------------------------------------------------------------ //
// bulkRefundEventCancellation
// ------------------------------------------------------------------ //

export async function bulkRefundEventCancellation(
  eventId: string,
  promoterId: string,
  reason: string,
  adminUserId: string,
  deps: ServiceDeps,
): Promise<{ total: number; refunded: number; skipped: number }> {
  const context: TenantContext = { role: 'admin' };

  return withTenantContext(deps.db, context, async (db) => {
    return db.transaction(async (tx) => {
      // Find all paid orders for this event and promoter
      const orders = await tx.query<DbOrderLookup>(
        `SELECT id, promoter_id, user_id, amount, event_id, event_date, purchased_at
           FROM orders.orders
          WHERE event_id = $1
            AND promoter_id = $2
            AND status = 'paid'`,
        [eventId, promoterId],
      );

      const total = orders.length;
      let refunded = 0;
      let skipped = 0;

      for (const order of orders) {
        // Check idempotency: skip if already approved or processed
        const existing = await tx.query<{ id: string }>(
          `SELECT id FROM platform.refund_requests
            WHERE order_id = $1
              AND status IN ('approved', 'processed')`,
          [order.id],
        );

        if (existing.length > 0) {
          skipped++;
          continue;
        }

        // Create approved refund_request
        await tx.query<DbRefundRequest>(
          `INSERT INTO platform.refund_requests
             (order_id, ticket_id, promoter_id, user_id, reason,
              requested_amount, status, refunded_amount, refund_method,
              decided_by, decided_at, idempotency_key)
           VALUES ($1, NULL, $2, $3, $4,
                   $5, 'approved', $5, 'original_payment',
                   $6, NOW(), $7)`,
          [
            order.id,
            promoterId,
            order.user_id,
            reason,
            order.amount,
            adminUserId,
            `bulk-cancel-${eventId}-${order.id}`,
          ],
        );

        // Mark order as refunded
        await tx.execute(
          `UPDATE orders.orders SET status = 'refunded', updated_at = NOW() WHERE id = $1`,
          [order.id],
        );

        refunded++;
      }

      // Fire-and-forget Kafka event
      deps.kafka
        .send('refund.bulk_event_cancellation', { eventId, promoterId, total, refunded })
        .catch(() => {});

      return { total, refunded, skipped };
    });
  });
}

// ------------------------------------------------------------------ //
// csOverrideApproveRefund
// ------------------------------------------------------------------ //

export async function csOverrideApproveRefund(
  requestId: string,
  adminUserId: string,
  overrideReason: string,
  deps: ServiceDeps,
): Promise<RefundRequest> {
  const context: TenantContext = { role: 'admin' };

  return withTenantContext(deps.db, context, async (db) => {
    // Load refund request
    const rows = await db.query<DbRefundRequest>(
      `SELECT * FROM platform.refund_requests WHERE id = $1`,
      [requestId],
    );
    if (rows.length === 0) {
      throw new RefundError('REQUEST_NOT_FOUND');
    }

    const request = rows[0];

    // Guard: already approved or processed
    if (request.status === 'approved' || request.status === 'processed') {
      throw new RefundError('REFUND_ALREADY_PROCESSED');
    }

    // Resolve refunded_amount: use requested_amount if set, otherwise load order amount
    let refundedAmount: number;
    if (request.requested_amount != null) {
      refundedAmount = request.requested_amount;
    } else {
      const order = await loadOrder(request.order_id, db);
      refundedAmount = order.amount;
    }

    const [updated] = await db.query<DbRefundRequest>(
      `UPDATE platform.refund_requests
          SET status         = 'approved',
              decided_by     = $1,
              decided_at     = NOW(),
              decision_notes = $2,
              refunded_amount= $3,
              updated_at     = NOW()
        WHERE id = $4
        RETURNING *`,
      [adminUserId, `CS override: ${overrideReason}`, refundedAmount, requestId],
    );

    // Mark order as refunded
    await db.execute(
      `UPDATE orders.orders SET status = 'refunded', updated_at = NOW() WHERE id = $1`,
      [updated.order_id],
    );

    // Fire-and-forget Kafka event
    deps.kafka
      .send('refund.cs_override', {
        requestId,
        orderId: updated.order_id,
        adminUserId,
        overrideReason,
      })
      .catch(() => {});

    return mapRequest(updated);
  });
}

// ------------------------------------------------------------------ //
// listRequestsForUser
// ------------------------------------------------------------------ //

export async function listRequestsForUser(
  userId: string,
  pagination: { limit?: number; offset?: number },
  deps: ServiceDeps,
  context: TenantContext = { role: 'buyer', userId },
): Promise<RefundRequest[]> {
  return withTenantContext(deps.db, context, async (db) => {
  const limit = pagination.limit ?? 50;
  const offset = pagination.offset ?? 0;

  const rows = await db.query<DbRefundRequest>(
    `SELECT * FROM platform.refund_requests
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );
  return rows.map(mapRequest);
  }); // end withTenantContext
}
