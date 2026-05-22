/**
 * POST /api/vouchers/holders/[paymentId]/confirm — voucher mock payment confirm
 *
 * Body: { action: 'pay' | 'cancel' }
 *
 * Flow PAY:
 *   - SELECT voucher FOR UPDATE
 *   - UPDATE payment_status='paid', vytvoří order shell s paid_order_id
 *
 * Flow CANCEL:
 *   - UPDATE payment_status='cancelled', balance_halire=0
 *
 * Idempotent (already-processed vrátí current state).
 */
import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
): Promise<Response> {
  const { paymentId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(paymentId)) {
    return NextResponse.json({ error: 'INVALID_PAYMENT_ID' }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { action?: 'pay' | 'cancel' };
  const action = body.action ?? 'pay';

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    // RLS bypass — payment_id je shared secret z checkout flow.
    await client.query(`SET LOCAL app.is_platform_admin = 'true'`);

    const r = await client.query<{
      id: string;
      code: string;
      amount_halire: number;
      promoter_id: string | null;
      issued_by_user: string | null;
      buyer_email: string | null;
      payment_status: string;
    }>(
      `SELECT id, code, amount_halire, promoter_id, issued_by_user, buyer_email, payment_status
         FROM marketing.gift_vouchers
        WHERE payment_id = $1
        FOR UPDATE`,
      [paymentId],
    );

    if (r.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'PAYMENT_NOT_FOUND' }, { status: 404 });
    }
    const voucher = r.rows[0];

    if (voucher.payment_status !== 'pending') {
      await client.query('ROLLBACK');
      return NextResponse.json({
        voucherId: voucher.id,
        voucherCode: voucher.code,
        paymentStatus: voucher.payment_status,
        message: 'Already processed',
      });
    }

    if (action === 'cancel') {
      await client.query(
        `UPDATE marketing.gift_vouchers
            SET payment_status = 'cancelled', balance_halire = 0, updated_at = NOW()
          WHERE id = $1`,
        [voucher.id],
      );
      await client.query('COMMIT');
      return NextResponse.json({
        voucherId: voucher.id,
        paymentStatus: 'cancelled',
      });
    }

    // PAY → mark paid + create order shell (no event_id; voucher purchase je event-agnostic)
    const orderId = randomUUID();
    await client.query(
      `INSERT INTO orders.orders
         (id, user_id, status, total_amount, currency, expires_at, paid_at)
       VALUES ($1, $2, 'paid', $3, 'CZK', NOW() + INTERVAL '30 days', NOW())
       ON CONFLICT DO NOTHING`,
      [orderId, voucher.issued_by_user, voucher.amount_halire],
    );

    await client.query(
      `UPDATE marketing.gift_vouchers
          SET payment_status = 'paid',
              paid_order_id = $2,
              updated_at = NOW()
        WHERE id = $1`,
      [voucher.id, orderId],
    );

    await client.query('COMMIT');

    return NextResponse.json({
      voucherId: voucher.id,
      voucherCode: voucher.code,
      paymentStatus: 'paid',
      amountHalire: voucher.amount_halire,
      buyerEmail: voucher.buyer_email,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /api/vouchers/holders/.../confirm]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }
}
