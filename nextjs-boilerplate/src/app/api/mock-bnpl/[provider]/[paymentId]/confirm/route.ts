/**
 * POST /api/mock-bnpl/[provider]/[paymentId]/confirm
 *
 * Body: { action: 'approve' | 'reject', installments?: 3|4|6 }
 *
 * Mock BNPL provider (Twisto / Skip Pay) confirm. V dev mode action='approve'
 * mark order paid + auto-issue tickets přes /api/internal/order-completed
 * (existing mock-gopay/internal pattern).
 *
 * CZ priority #2 (FR/UK/IT audit, ROI 8/10).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { mockPaymentBlockedResponse } from '@/lib/payment/mock-guard';
import { z } from 'zod';


const schema = z.object({
  action: z.enum(['approve', 'reject']),
  installments: z.number().int().min(2).max(12).default(3),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string; paymentId: string }> },
): Promise<Response> {
  const blocked = mockPaymentBlockedResponse();
  if (blocked) return blocked;
  return runWithServiceContext(async () => {

  const { provider, paymentId } = await params;
  if (provider !== 'twisto' && provider !== 'skippay') {
    return NextResponse.json({ error: 'UNKNOWN_PROVIDER' }, { status: 400 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(paymentId)) {
    return NextResponse.json({ error: 'INVALID_PAYMENT_ID' }, { status: 400 });
  }
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    // Kolo 3: servisní kontext (runWithServiceContext) stačí — politiky mají větev app_is_service(); admin eskalace odstraněna.

    const or = await client.query<{
      id: string;
      status: string;
      total_amount: number;
      user_id: string;
    }>(
      `SELECT id, status, total_amount, user_id
         FROM orders.orders
        WHERE gopay_payment_id = $1
        FOR UPDATE`,
      [paymentId],
    );
    if (or.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 });
    }
    const order = or.rows[0];

    if (order.status === 'paid') {
      await client.query('ROLLBACK');
      return NextResponse.json({ orderId: order.id, message: 'Already paid' });
    }

    if (parsed.data.action === 'reject') {
      await client.query(
        `UPDATE orders.orders
            SET status = 'cancelled', updated_at = NOW()
          WHERE id = $1`,
        [order.id],
      );
      await client.query('COMMIT');
      return NextResponse.json({ orderId: order.id, status: 'cancelled' });
    }

    // Approve — mark paid
    await client.query(
      `UPDATE orders.orders
          SET status = 'paid', paid_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [order.id],
    );
    await client.query('COMMIT');

    // Trigger ticket issuance přes existing internal hook (stejný pattern
    // jako mock-gopay → /api/internal/order-completed). Server-side fetch.
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const internalToken = process.env.INTERNAL_SERVICE_TOKEN ?? 'dev-token';
    try {
      await fetch(`${appUrl}/api/internal/order-completed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-token': internalToken,
        },
        body: JSON.stringify({ orderId: order.id, paymentProvider: provider }),
      });
    } catch (err) {
      console.error('[mock-bnpl] internal order-completed fetch failed', err);
    }

    return NextResponse.json({
      orderId: order.id,
      status: 'paid',
      installments: parsed.data.installments,
      provider,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[POST /api/mock-bnpl/.../confirm]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
