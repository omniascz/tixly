/**
 * POST /api/buyer/orders/[orderId]/payment-plan
 *
 * Body: { planId: uuid }
 *
 * Připojí payment plan k existující objednávce ve status='pending'.
 * Spočítá splátky, vytvoří `order_payment_plans` + `payment_installments`.
 * Buyer pak zaplatí "deposit" přes mock-gopay → order status = 'paid_partial',
 * další splátky čeká cron.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const schema = z.object({
  planId: z.string().uuid(),
});

interface OrderRow {
  id: string;
  user_id: string;
  event_id: string;
  total_amount: number;
  currency: string;
  status: string;
}

interface PlanRow {
  id: string;
  event_id: string | null;
  deposit_pct: number;
  installments_count: number;
  interval_days: number;
  active: boolean;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { orderId: string } },
): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const ord = await client.query<OrderRow>(
      `SELECT id, user_id, event_id, total_amount, currency, status
       FROM orders.orders
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [params.orderId, userId],
    );
    if (ord.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const order = ord.rows[0];
    if (order.status !== 'pending') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'INVALID_STATE', message: `Order is "${order.status}", plan can only be attached to pending.` },
        { status: 409 },
      );
    }

    const exists = await client.query(
      `SELECT 1 FROM orders.order_payment_plans WHERE order_id = $1`,
      [order.id],
    );
    if (exists.rows.length > 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'PLAN_ALREADY_ATTACHED' }, { status: 409 });
    }

    const plan = await client.query<PlanRow>(
      `SELECT id, event_id, deposit_pct, installments_count, interval_days, active
       FROM catalog.payment_plans
       WHERE id = $1`,
      [parsed.data.planId],
    );
    if (plan.rows.length === 0 || !plan.rows[0].active) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'PLAN_NOT_FOUND' }, { status: 404 });
    }
    const p = plan.rows[0];
    if (p.event_id !== order.event_id) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'PLAN_NOT_FOR_EVENT' }, { status: 422 });
    }

    const total = order.total_amount;
    const depositAmount = Math.floor((total * p.deposit_pct) / 100);
    const remaining = total - depositAmount;
    const installmentsCount = p.installments_count;

    const oppRes = await client.query<{ id: string }>(
      `INSERT INTO orders.order_payment_plans
         (order_id, plan_id, total_amount, currency, deposit_amount, status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       RETURNING id`,
      [order.id, p.id, total, order.currency, depositAmount],
    );
    const oppId = oppRes.rows[0].id;

    if (installmentsCount > 0) {
      // Equal-split (last absorbs remainder)
      const baseAmount = Math.floor(remaining / installmentsCount);
      const lastAmount = remaining - baseAmount * (installmentsCount - 1);
      const now = Date.now();
      for (let i = 1; i <= installmentsCount; i++) {
        const amount = i === installmentsCount ? lastAmount : baseAmount;
        const dueAt = new Date(now + p.interval_days * i * 24 * 60 * 60 * 1000);
        await client.query(
          `INSERT INTO orders.payment_installments
             (order_payment_plan_id, sequence, amount, due_at, status)
           VALUES ($1, $2, $3, $4, 'pending')`,
          [oppId, i, amount, dueAt.toISOString()],
        );
      }
    }

    await client.query('COMMIT');
    return NextResponse.json({
      ok: true,
      orderPaymentPlanId: oppId,
      depositAmount,
      installmentsCount,
      remainingAmount: remaining,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[attach payment plan]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
