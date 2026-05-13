import { randomUUID } from 'crypto';
import type { DbAdapter, RefundRequest, RefundResult, RefundPolicy, Order, SendEmailFn, CallGopayApiFn, CallStripeApiFn } from '../lib/types.js';
import { evaluateRefundRules } from '../lib/refund-rules.js';
import { getReversalAdapter } from '../lib/payment-reversals.js';

export interface RefundEngineDeps {
  db: DbAdapter;
  gopayCallFn?: CallGopayApiFn;
  stripeCallFn?: CallStripeApiFn;
  sendEmail?: SendEmailFn;
}

async function getOrder(orderId: string, promoterId: string, db: DbAdapter): Promise<Order> {
  const rows = await db.query<Order>(
    `SELECT id, promoter_id, event_id, status, total_amount_halire as "totalAmountHalire",
            payment_gateway as "paymentGateway", external_payment_id as "externalPaymentId", created_at as "createdAt"
     FROM orders WHERE id = $1 AND promoter_id = $2`,
    [orderId, promoterId]
  );
  if (!rows[0]) throw new Error(`Order not found: ${orderId}`);
  return rows[0];
}

async function getRefundPolicy(eventId: string, promoterId: string, db: DbAdapter): Promise<RefundPolicy | null> {
  const rows = await db.query<RefundPolicy>(
    `SELECT promoter_id as "promoterId", event_id as "eventId",
            refund_window_days as "refundWindowDays",
            allow_customer_refunds as "allowCustomerRefunds",
            max_refund_percentage as "maxRefundPercentage"
     FROM refund_policies WHERE promoter_id = $1 AND (event_id = $2 OR event_id IS NULL)
     ORDER BY event_id NULLS LAST LIMIT 1`,
    [promoterId, eventId]
  );
  return rows[0] ?? null;
}

export async function checkRefundEligibility(
  orderId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<{ eligible: boolean; reason?: string; policy?: RefundPolicy }> {
  const order = await getOrder(orderId, promoterId, db);
  const policy = await getRefundPolicy(order.eventId, promoterId, db);
  const eligibility = evaluateRefundRules(order, policy);
  return {
    eligible: eligibility.eligible,
    reason: eligibility.reason,
    policy: policy ?? undefined,
  };
}

export async function processRefund(
  request: RefundRequest,
  deps: RefundEngineDeps,
): Promise<RefundResult> {
  const { db, gopayCallFn, stripeCallFn, sendEmail } = deps;

  const order = await getOrder(request.orderId, request.promoterId, db);
  const policy = await getRefundPolicy(order.eventId, request.promoterId, db);
  const eligibility = evaluateRefundRules(order, policy);

  if (!eligibility.eligible) {
    throw new Error(`REFUND_NOT_ELIGIBLE: ${eligibility.reason}`);
  }

  const amountHalire = request.amountHalire ?? order.totalAmountHalire;
  if (amountHalire <= 0) throw new Error('VALIDATION_ERROR: amount must be positive');
  if (eligibility.maxRefundableHalire !== undefined && amountHalire > eligibility.maxRefundableHalire) {
    throw new Error(`VALIDATION_ERROR: amount exceeds max refundable ${eligibility.maxRefundableHalire}`);
  }

  const refundId = randomUUID();
  let gatewayRefundId: string | undefined;
  let status: 'completed' | 'failed' = 'completed';

  try {
    if (order.totalAmountHalire > 0 && order.externalPaymentId) {
      const adapter = getReversalAdapter(order.paymentGateway, { gopayCallFn, stripeCallFn });
      const result = await adapter.reversePayment(order.externalPaymentId, amountHalire);
      gatewayRefundId = result.gatewayRefundId;
    }
  } catch (err) {
    status = 'failed';
    await db.execute(
      `INSERT INTO refunds (id, order_id, promoter_id, amount_halire, reason, requested_by, status, payment_gateway, processed_at)
       VALUES ($1,$2,$3,$4,$5,$6,'failed',$7,NOW())`,
      [refundId, request.orderId, request.promoterId, amountHalire, request.reason, request.requestedBy, order.paymentGateway]
    );
    throw err;
  }

  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO refunds (id, order_id, promoter_id, amount_halire, reason, requested_by, status, payment_gateway, gateway_refund_id, processed_at)
       VALUES ($1,$2,$3,$4,$5,$6,'completed',$7,$8,NOW())`,
      [refundId, request.orderId, request.promoterId, amountHalire, request.reason, request.requestedBy, order.paymentGateway, gatewayRefundId ?? null]
    );
    await tx.execute(
      `UPDATE orders SET status = 'refunded', updated_at = NOW() WHERE id = $1`,
      [request.orderId]
    );
  });

  if (sendEmail) {
    await sendEmail(
      request.orderId,
      'Refund processed',
      `Your refund of ${amountHalire / 100} CZK has been processed.`
    ).catch(() => {/* email failure doesn't break refund */});
  }

  return {
    refundId,
    orderId: request.orderId,
    amountHalire,
    status,
    paymentGateway: order.paymentGateway as 'gopay' | 'stripe' | 'free',
    gatewayRefundId,
    processedAt: new Date().toISOString(),
  };
}

export async function processEventCancellationRefunds(
  eventId: string,
  promoterId: string,
  deps: RefundEngineDeps,
): Promise<{ processed: number; failed: number; total: number }> {
  const orders = await deps.db.query<Order>(
    `SELECT id, promoter_id, event_id, status, total_amount_halire as "totalAmountHalire",
            payment_gateway as "paymentGateway", external_payment_id as "externalPaymentId", created_at as "createdAt"
     FROM orders WHERE event_id = $1 AND promoter_id = $2 AND status = 'paid'`,
    [eventId, promoterId]
  );

  // Mark event as cancelled first
  await deps.db.execute(`UPDATE events SET status = 'cancelled' WHERE id = $1`, [eventId]);

  let processed = 0;
  let failed = 0;

  for (const order of orders) {
    // Temporarily mark order as event_cancelled for evaluateRefundRules
    const cancellationOrder = { ...order, status: 'event_cancelled' };
    try {
      const adapter = cancellationOrder.totalAmountHalire > 0 && cancellationOrder.externalPaymentId
        ? getReversalAdapter(cancellationOrder.paymentGateway, { gopayCallFn: deps.gopayCallFn, stripeCallFn: deps.stripeCallFn })
        : null;

      let gatewayRefundId: string | undefined;
      if (adapter && cancellationOrder.externalPaymentId) {
        const result = await adapter.reversePayment(cancellationOrder.externalPaymentId, cancellationOrder.totalAmountHalire);
        gatewayRefundId = result.gatewayRefundId;
      }

      await deps.db.transaction(async (tx) => {
        await tx.execute(
          `INSERT INTO refunds (id, order_id, promoter_id, amount_halire, reason, requested_by, status, payment_gateway, gateway_refund_id, processed_at)
           VALUES ($1,$2,$3,$4,'event_cancelled','system','completed',$5,$6,NOW())`,
          [randomUUID(), order.id, promoterId, order.totalAmountHalire, order.paymentGateway, gatewayRefundId ?? null]
        );
        await tx.execute(`UPDATE orders SET status = 'refunded' WHERE id = $1`, [order.id]);
      });
      processed++;
    } catch {
      failed++;
    }
  }

  return { processed, failed, total: orders.length };
}

export async function processBatchRefunds(
  requests: RefundRequest[],
  deps: RefundEngineDeps,
): Promise<{ results: RefundResult[]; failedCount: number }> {
  const results: RefundResult[] = [];
  let failedCount = 0;

  for (const request of requests) {
    try {
      const result = await processRefund(request, deps);
      results.push(result);
    } catch {
      failedCount++;
    }
  }

  return { results, failedCount };
}
