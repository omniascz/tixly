/**
 * POST /api/mobile/order-confirm
 * Ověří Stripe PaymentIntent a vydá vstupenky.
 * Volá se z mobilní appky ihned po úspěšném presentPaymentSheet().
 * Idempotentní — bezpečný retry.
 *
 * Auth: Bearer JWT (x-user-id z middleware)
 */

import { NextRequest, NextResponse } from 'next/server';
import { runAsUser } from '@/lib/auth';
import { db } from '@/lib/db/rls-pool';
import { issueTicketsForOrder } from '@/lib/tickets/demo-issuer';

export const dynamic = 'force-dynamic';

async function getStripePI(piId: string): Promise<{
  id: string;
  status: string;
  metadata: { orderId?: string; userId?: string };
}> {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error('STRIPE_NOT_CONFIGURED');
  const res = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(piId)}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!res.ok) throw new Error(`Stripe ${res.status}`);
  return res.json() as Promise<{ id: string; status: string; metadata: { orderId?: string; userId?: string } }>;
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
    const body: unknown = await req.json().catch(() => ({}));
    const { paymentIntentId } = (body ?? {}) as Record<string, unknown>;
    if (typeof paymentIntentId !== 'string' || !paymentIntentId) {
      return NextResponse.json({ error: 'Missing paymentIntentId' }, { status: 422 });
    }

    // Ověřit u Stripe
    let pi: { id: string; status: string; metadata: { orderId?: string } };
    try {
      pi = await getStripePI(paymentIntentId);
    } catch {
      return NextResponse.json({ error: 'STRIPE_ERROR' }, { status: 502 });
    }

    if (pi.status !== 'succeeded') {
      return NextResponse.json({ error: 'PAYMENT_NOT_SUCCEEDED', status: pi.status }, { status: 402 });
    }

    const orderId = pi.metadata?.orderId;
    if (!orderId) return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 });

    // Ověřit vlastnictví objednávky
    const orderRes = await db().query<{ id: string; status: string; user_id: string }>(
      `SELECT id, status, user_id FROM orders.orders WHERE id = $1 LIMIT 1`,
      [orderId],
    );
    const order = orderRes.rows[0];
    if (!order || order.user_id !== userId) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    // Idempotence — již potvrzeno
    if (order.status === 'paid') {
      const tc = await db().query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM tickets.tickets WHERE order_id = $1`,
        [orderId],
      );
      return NextResponse.json({
        orderId,
        ticketCount: parseInt(tc.rows[0]?.count ?? '0', 10),
        alreadyConfirmed: true,
      });
    }

    // Zaplatit + vydat vstupenky v transakci
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE orders.orders SET status = 'paid', paid_at = NOW() WHERE id = $1`,
        [orderId],
      );
      const tickets = await issueTicketsForOrder(orderId, client);
      await client.query('COMMIT');
      return NextResponse.json({ orderId, ticketCount: tickets.length });
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('[mobile/order-confirm]', e);
      return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
