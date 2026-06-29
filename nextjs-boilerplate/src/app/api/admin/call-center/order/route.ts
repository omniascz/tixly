/**
 * POST /api/admin/call-center/order
 * Call center agent creates a phone order on behalf of a buyer.
 * Returns a payment link to forward to the buyer.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';
import { createHmac } from 'crypto';

const schema = z.object({
  buyerEmail: z.string().email(),
  buyerName: z.string().min(1).max(100),
  eventId: z.string().uuid(),
  ticketTypeId: z.string().uuid(),
  quantity: z.number().int().min(1).max(20),
});

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'BAD_INPUT', issues: parsed.error.issues }, { status: 422 });
    }
    const { buyerEmail, buyerName, eventId, ticketTypeId, quantity } = parsed.data;

    const client = await db().connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_promoter_id = '${promoter.promoterId}'`);
      await client.query(`SET LOCAL app.current_user_id = '${promoter.userId}'`);

      const evRes = await client.query<{ id: string; name: string }>(
        `SELECT id, name FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
        [eventId, promoter.promoterId],
      );
      if (!evRes.rows[0]) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'EVENT_NOT_FOUND' }, { status: 404 });
      }

      const ttRes = await client.query<{ id: string; base_price: number; name: string }>(
        `SELECT id, base_price, name FROM catalog.ticket_types WHERE id = $1 AND event_id = $2 AND active = true`,
        [ticketTypeId, eventId],
      );
      if (!ttRes.rows[0]) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'TICKET_TYPE_NOT_FOUND' }, { status: 404 });
      }
      const tt = ttRes.rows[0];

      const totalAmount = tt.base_price * quantity;
      const secret = process.env.INTERNAL_SERVICE_TOKEN ?? 'fallback-secret-change-me';
      const token = createHmac('sha256', secret)
        .update(`phone:${eventId}:${buyerEmail}:${Date.now()}`)
        .digest('hex')
        .slice(0, 40);
      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
      const paymentLink = `${baseUrl}/checkout/pay-by-link/${token}`;

      const orderRes = await client.query<{ id: string }>(
        `INSERT INTO orders.orders
           (event_id, buyer_email, buyer_name, total_amount, currency, status,
            order_source, placed_by_agent_id, phone_payment_link, phone_payment_expires_at)
         VALUES ($1, $2, $3, $4, 'CZK', 'pending_payment',
                 'phone', $5, $6, $7)
         RETURNING id`,
        [eventId, buyerEmail, buyerName, totalAmount, promoter.userId, paymentLink, expiresAt.toISOString()],
      );
      const orderId = orderRes.rows[0].id;

      await client.query(
        `INSERT INTO orders.order_items (order_id, ticket_type_id, quantity, unit_price, total_price)
         VALUES ($1, $2, $3, $4, $5)`,
        [orderId, ticketTypeId, quantity, tt.base_price, totalAmount],
      );

      await client.query('COMMIT');
      return NextResponse.json({ orderId, paymentLink, expiresAt, buyerEmail });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.error('[POST /api/admin/call-center/order]', err);
      return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
