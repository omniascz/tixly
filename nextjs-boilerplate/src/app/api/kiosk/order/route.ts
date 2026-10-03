/**
 * POST /api/kiosk/order
 *
 * Vytvoří objednávku z kiosku (pokladní terminál).
 * Ekvivalent POS sale. FIX K1: vyžaduje PŘIHLÁŠENOU OBSLUHU (x-user-id z JWT přes
 * middleware) s oprávněním k dané akci (platform admin nebo člen promotéra).
 * Fyzickou platbu (karta/hotovost) provádí obsluha na terminálu, jako u POS.
 *
 * Body: { promoterSlug, eventId, ticketTypeId, quantity, buyerEmail?, buyerName? }
 * Auth: x-user-id (obsluha) — bez něj 401; bez oprávnění k akci 403.
 * Returns: { orderId, totalAmountHalire, currency, tickets[] }
 */
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { salesClosedResponse } from '@/lib/sales/cutoff';
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

  // Kolo 7 (C-29): kiosk je kupcový kanál — po uzávěrce online prodeje nový nákup nejde.
  const salesClosed = await salesClosedResponse(db(), input.eventId, 'online');
  if (salesClosed) return salesClosed;

  // FIX K1: kiosk NEMĚL žádné ověření identity — kdokoli nepřihlášený přes něj
  // dostal placené vstupenky zdarma (promoterSlug i eventId jsou veřejné). Nově
  // vyžaduje přihlášenou obsluhu pokladny: `x-user-id` (injektuje middleware z JWT)
  // + oprávnění k DANÉ akci (platform admin NEBO aktivní člen promotéra akce).
  // Fyzickou platbu (karta/hotovost na terminálu) provádí obsluha, jako u POS.
  const operatorId = req.headers.get('x-user-id');
  if (!operatorId) {
    return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Přihlášení obsluhy pokladny je povinné.' }, { status: 401 });
  }

  return runWithServiceContext(async () => {
    const client = await db().connect();
    try {
      await client.query('BEGIN');

      // 1) Ověř, že event patří promotérovi se zadaným slugem a je publikovaný
      const evRes = await client.query<{ id: string; title: string; currency: string; promoter_slug: string; promoter_id: string }>(
        `SELECT e.id, e.title, e.currency, p.slug AS promoter_slug, e.promoter_id
           FROM catalog.events e
           JOIN platform.promoters p ON p.id = e.promoter_id
          WHERE e.id = $1
            AND p.slug = $2
            AND e.status = 'published'
            AND e.date_start > NOW()`,
        [input.eventId, input.promoterSlug],
      );
      const ev = evRes.rows[0];
      if (!ev) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'EVENT_NOT_FOUND' }, { status: 404 });
      }

      // 1b) Oprávnění obsluhy k této akci: platform admin NEBO aktivní člen promotéra.
      const authRes = await client.query<{ ok: boolean }>(
        `SELECT (
           EXISTS (SELECT 1 FROM identity.users WHERE id = $1 AND is_platform_admin = TRUE)
           OR EXISTS (SELECT 1 FROM platform.promoter_members
                       WHERE user_id = $1 AND promoter_id = $2)
         ) AS ok`,
        [operatorId, ev.promoter_id],
      );
      if (!authRes.rows[0]?.ok) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'FORBIDDEN', message: 'Obsluha nemá oprávnění k prodeji na této akci.' }, { status: 403 });
      }

      // 2) Ticket type
      const ttRes = await client.query<{
        id: string; name: string; base_price: number; remaining_qty: number; is_seated: boolean;
      }>(
        `SELECT id, name, base_price, remaining_qty, is_seated
           FROM catalog.ticket_types
          WHERE id = $1 AND event_id = $2
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
