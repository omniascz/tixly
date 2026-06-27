/**
 * POST /api/kiosk/order
 *
 * Vytvoří objednávku z kiosku (samoobslužný terminál).
 * Ekvivalent POS sale, ale bez promotér session — běží v service kontextu.
 * Kiosk je fyzické zařízení na místě → ověření přes promoterSlug + eventId.
 *
 * Body: { promoterSlug, eventId, ticketTypeId, quantity, buyerEmail?, buyerName? }
 * Returns: { orderId, totalAmountHalire, currency, tickets[] }
 */
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { issueTicketsForOrder } from '@/lib/tickets/demo-issuer';

const schema = z.object({
  promoterSlug:  z.string().min(1).max(120),
  eventId:       z.string().uuid(),
  ticketTypeId:  z.string().uuid(),
  quantity:      z.number().int().min(1).max(10),
  buyerEmail:    z.string().email().optional(),
  buyerName:     z.string().min(1).max(120).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_INPUT', issues: parsed.error.issues }, { status: 422 });
  }
  const input = parsed.data;

  return runWithServiceContext(async () => {
    const client = await db().connect();
    try {
      await client.query('BEGIN');

      // 1) Ověř, že event patří promotérovi se zadaným slugem a je publikovaný
      const evRes = await client.query<{ id: string; title: string; currency: string; promoter_slug: string }>(
        `SELECT e.id, e.title, e.currency, p.slug AS promoter_slug
           FROM catalog.events e
           JOIN catalog.promoters p ON p.id = e.promoter_id
          WHERE e.id = $1
            AND p.slug = $2
            AND e.status = 'published'
            AND e.starts_at > NOW()`,
        [input.eventId, input.promoterSlug],
      );
      const ev = evRes.rows[0];
      if (!ev) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'EVENT_NOT_FOUND' }, { status: 404 });
      }

      // 2) Ticket type
      const ttRes = await client.query<{
        id: string; name: string; base_price: number; remaining_qty: number; is_seated: boolean;
      }>(
        `SELECT id, name, base_price, remaining_qty, is_seated
           FROM catalog.ticket_types
          WHERE id = $1 AND event_id = $2 AND is_active = true
          FOR UPDATE`,
        [input.ticketTypeId, input.eventId],
      );
      const tt = ttRes.rows[0];
      if (!tt) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'TICKET_TYPE_NOT_FOUND' }, { status: 404 });
      }
      if (tt.remaining_qty < input.quantity) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'OUT_OF_STOCK', remaining: tt.remaining_qty }, { status: 422 });
      }
      if (tt.is_seated) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'SEATED_NOT_SUPPORTED_IN_KIOSK' }, { status: 422 });
      }

      // 3) Buyer — existující nebo walk-in
      let userId: string;
      if (input.buyerEmail) {
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM identity.users WHERE email = $1 LIMIT 1`,
          [input.buyerEmail.toLowerCase()],
        );
        if (existing.rows[0]) {
          userId = existing.rows[0].id;
        } else {
          const ins = await client.query<{ id: string }>(
            `INSERT INTO identity.users (email, name, password_hash, gdpr_consent_at)
             VALUES ($1, $2, '!kiosk-no-password', now())
             RETURNING id`,
            [input.buyerEmail.toLowerCase(), input.buyerName ?? 'Kiosk zákazník'],
          );
          userId = ins.rows[0].id;
        }
      } else {
        const ins = await client.query<{ id: string }>(
          `INSERT INTO identity.users (email, name, password_hash, gdpr_consent_at)
           VALUES ($1, $2, '!kiosk-no-password', now())
           RETURNING id`,
          [`kiosk+${randomUUID().slice(0, 8)}@${input.promoterSlug}.kiosk.local`,
           input.buyerName ?? 'Kiosk zákazník'],
        );
        userId = ins.rows[0].id;
      }

      // 4) Order
      const totalAmount = tt.base_price * input.quantity;
      const orderRes = await client.query<{ id: string }>(
        `INSERT INTO orders.orders
           (user_id, status, total_amount, currency, paid_at, expires_at, event_id, payment_provider)
         VALUES ($1, 'paid', $2, $3, now(), now() + interval '1 hour', $4, 'kiosk_card')
         RETURNING id`,
        [userId, totalAmount, ev.currency, input.eventId],
      );
      const orderId = orderRes.rows[0].id;

      // 5) Order item
      await client.query(
        `INSERT INTO orders.order_items (order_id, ticket_type_id, quantity, unit_price, total_price)
         VALUES ($1, $2, $3, $4, $5)`,
        [orderId, tt.id, input.quantity, tt.base_price, totalAmount],
      );

      // 6) Decrement
      await client.query(
        `UPDATE catalog.ticket_types SET remaining_qty = remaining_qty - $1 WHERE id = $2`,
        [input.quantity, tt.id],
      );

      // 7) Issue tickets
      const issued = await issueTicketsForOrder(orderId, client);

      await client.query('COMMIT');

      return NextResponse.json({
        ok: true,
        orderId,
        eventTitle: ev.title,
        ticketTypeName: tt.name,
        totalAmountHalire: totalAmount,
        currency: ev.currency,
        tickets: issued.map((t) => ({
          ticketId: t.ticketId,
          totpSecretBase32: t.totpSecretBase32,
        })),
      });
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('[kiosk/order]', e);
      return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
