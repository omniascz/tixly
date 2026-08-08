/**
 * POST /api/internal/cron/charge-installments
 *
 * Cron — charge due instalments (mock):
 *   - Najde `payment_installments` ve status='pending' s due_at <= NOW()
 *   - V demu auto-success → status='paid', charged_at=NOW()
 *   - V produkci: Stripe paymentIntent.create, fail → retry up to 3x, pak status='failed'
 *   - Pokud všechny instalments paid → order_payment_plans.status='completed' + order.status='paid'
 *
 * Auth: x-internal-token.
 */

import { timingSafeEqual } from 'crypto';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { NextRequest, NextResponse } from 'next/server';


function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {

  const token = req.headers.get('x-internal-token') ?? '';
  const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  if (!expected || !safeEqual(token, expected)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const due = await db().query<{
    id: string;
    order_payment_plan_id: string;
    sequence: number;
    amount: number;
    retry_count: number;
  }>(
    `SELECT id, order_payment_plan_id, sequence, amount, retry_count
     FROM orders.payment_installments
     WHERE status = 'pending' AND due_at <= NOW()
     ORDER BY due_at ASC
     LIMIT 500`,
  );

  let paid = 0;
  let failed = 0;
  let completedPlans = 0;

  for (const inst of due.rows) {
    const client = await db().connect();
    try {
      await client.query('BEGIN');

      // Re-check + lock
      const recheck = await client.query<{ status: string }>(
        `SELECT status FROM orders.payment_installments
         WHERE id = $1 FOR UPDATE`,
        [inst.id],
      );
      if (recheck.rows.length === 0 || recheck.rows[0].status !== 'pending') {
        await client.query('ROLLBACK');
        continue;
      }

      // Real Stripe charge pokud máme Customer + PaymentMethod, jinak mock
      let providerRef = `mock-cron-${inst.id.slice(0, 8)}`;
      const useStripe = Boolean(process.env.STRIPE_SECRET_KEY);

      if (useStripe) {
        const ctx = await client.query<{
          customer_id: string | null;
          payment_method_id: string | null;
          currency: string;
        }>(
          `SELECT u.stripe_customer_id AS customer_id,
                  o.stripe_payment_method_id AS payment_method_id,
                  o.currency
           FROM orders.payment_installments pi
           JOIN orders.order_payment_plans opp ON opp.id = pi.order_payment_plan_id
           JOIN orders.orders o ON o.id = opp.order_id
           JOIN identity.users u ON u.id = o.user_id
           WHERE pi.id = $1`,
          [inst.id],
        );
        const row = ctx.rows[0];
        if (row?.customer_id && row?.payment_method_id) {
          const { chargeSavedPaymentMethod } = await import('@/lib/payment/stripe');
          const result = await chargeSavedPaymentMethod({
            customerId: row.customer_id,
            paymentMethodId: row.payment_method_id,
            amountHalire: inst.amount,
            currency: row.currency,
            description: `Splatka ${inst.sequence} (instalment ${inst.id.slice(0, 8)})`,
            idempotencyKey: `inst-${inst.id}`,
          });
          if (result.ok) {
            providerRef = result.paymentIntentId;
          } else {
            await client.query(
              `UPDATE orders.payment_installments
               SET retry_count = retry_count + 1,
                   last_attempt_at = NOW(),
                   last_error = $2,
                   status = CASE WHEN retry_count >= 2 THEN 'failed' ELSE 'pending' END,
                   grace_period_ends_at = CASE
                     WHEN retry_count >= 2 THEN NULL
                     ELSE NOW() + INTERVAL '3 days'
                   END
               WHERE id = $1`,
              [inst.id, result.reason.slice(0, 500)],
            );
            await client.query('COMMIT');
            failed += 1;
            continue;
          }
        }
        // Pokud chybí customer_id/payment_method_id, fallback na mock charge
      }

      await client.query(
        `UPDATE orders.payment_installments
         SET status = 'paid', charged_at = NOW(),
             payment_provider_ref = $2,
             last_error = NULL
         WHERE id = $1`,
        [inst.id, providerRef],
      );
      paid += 1;

      // Last one? → mark plan completed + order paid
      const remaining = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM orders.payment_installments
         WHERE order_payment_plan_id = $1 AND status != 'paid'`,
        [inst.order_payment_plan_id],
      );
      if (Number(remaining.rows[0]?.count ?? 0) === 0) {
        const opp = await client.query<{ order_id: string }>(
          `UPDATE orders.order_payment_plans
           SET status = 'completed', completed_at = NOW()
           WHERE id = $1
           RETURNING order_id`,
          [inst.order_payment_plan_id],
        );
        if (opp.rows.length > 0) {
          await client.query(
            `UPDATE orders.orders SET status = 'paid', paid_at = NOW(), updated_at = NOW()
             WHERE id = $1 AND status IN ('paid_partial', 'pending')`,
            [opp.rows[0].order_id],
          );
          completedPlans += 1;
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[charge-installments]', inst.id, err);
      failed += 1;
      try {
        await db().query(
          `UPDATE orders.payment_installments
           SET retry_count = retry_count + 1,
               status = CASE WHEN retry_count >= 2 THEN 'failed' ELSE 'pending' END
           WHERE id = $1`,
          [inst.id],
        );
      } catch {
        // ignore
      }
    } finally {
      client.release();
    }
  }

  return NextResponse.json({      // R-46: driv `ok: true` natvrdo, i kdyz `failed > 0`. Audit C2 sel po
      // jmennem seznamu devíti rout, takze tahle proklouzla (FINDINGS 174).

    ok: failed === 0,
    processed: due.rows.length,
    paid,
    failed,
    completedPlans,
  });

  });
}
