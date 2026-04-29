/**
 * POST /api/buyer/orders/[orderId]/insurance-claim
 *
 * Body: { reason: string (3-500 chars) }
 *
 * Buyer s aktivní pojistkou si může zažádat o refund. V demu auto-approve = full premium back +
 * order amount minus premium. V produkci by tu byla integrace na XCover / Booking Protect API
 * (provider zhodnotí důvod a vyplatí samostatně).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const schema = z.object({
  reason: z.string().min(3).max(500),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { orderId: string } },
): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
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
    const ord = await client.query<{
      id: string;
      total_amount: number;
      status: string;
    }>(
      `SELECT id, total_amount, status FROM orders.orders
       WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [params.orderId, userId],
    );
    if (ord.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (ord.rows[0]!.status !== 'paid') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'INVALID_STATE', message: 'Pojistku můžeš uplatnit jen na zaplacené objednávky.' },
        { status: 409 },
      );
    }

    const ins = await client.query<{
      id: string;
      premium_amount: number;
      status: string;
    }>(
      `SELECT id, premium_amount, status FROM orders.order_insurance
       WHERE order_id = $1 FOR UPDATE`,
      [params.orderId],
    );
    if (ins.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'NO_INSURANCE', message: 'K této objednávce nemáš aktivní pojistku.' },
        { status: 404 },
      );
    }
    if (ins.rows[0]!.status !== 'active') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'INSURANCE_NOT_ACTIVE', status: ins.rows[0]!.status },
        { status: 409 },
      );
    }

    const claimAmount = ord.rows[0]!.total_amount - ins.rows[0]!.premium_amount;

    await client.query(
      `UPDATE orders.order_insurance
       SET status = 'claimed', claim_filed_at = NOW(), claim_resolved_at = NOW(),
           claim_amount = $2, claim_reason = $3
       WHERE id = $1`,
      [ins.rows[0]!.id, claimAmount, parsed.data.reason],
    );
    await client.query(
      `UPDATE orders.orders SET status = 'refunded', updated_at = NOW() WHERE id = $1`,
      [ord.rows[0]!.id],
    );
    // Revoke tickets so they can't be scanned
    await client.query(
      `UPDATE tickets.tickets SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
       WHERE order_id = $1 AND status = 'valid'`,
      [ord.rows[0]!.id],
    );

    await client.query('COMMIT');
    return NextResponse.json({
      ok: true,
      claimAmount,
      message: 'Refund schválen, lístky zrušeny.',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[insurance-claim]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
