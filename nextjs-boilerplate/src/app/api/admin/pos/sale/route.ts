/**
 * POST /api/admin/pos/sale — walk-in pokladna u dveří
 *
 * Tvar:
 *   { eventId, ticketTypeId, quantity, buyerName?, paymentMethod: 'cash' | 'card_terminal' }
 *
 * Co dělá:
 *   1. Ověří promotéra (pouze vlastní akce — promoter_id na eventu musí sedět)
 *   2. Vyrobí anonymního walk-in usera (`walkin+<random>@<slug>.local`)
 *   3. Vytvoří order status='paid', payment_provider='free', paid_at=now()
 *   4. Pokud je ticket_type seated → auto-pick prvních N available seatů ze stejné zone
 *   5. Vytvoří order_items + tickets (přes existing issueTicketsForOrder)
 *   6. Vrátí list lístků s TOTP secret base32 → klient si vyrenderuje QR pro tisk
 *
 * **Bez platební brány** — tohle je hotovostní/terminálový kanál, peníze
 * inkasuje promotér sám u kasy. Tixly jen vystaví lístek.
 */

import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { issueTicketsForOrder } from '@/lib/tickets/demo-issuer';


const inputSchema = z.object({
  eventId: z.string().uuid(),
  ticketTypeId: z.string().uuid(),
  quantity: z.number().int().min(1).max(20),
  buyerName: z.string().min(1).max(120).optional(),
  paymentMethod: z.enum(['cash', 'card_terminal']).default('cash'),
});

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const input = parsed.data;

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    // 1) Ověř, že event patří tomuto promotérovi
    const evRes = await client.query<{
      id: string;
      promoter_id: string | null;
      title: string;
      currency: string;
    }>(
      `SELECT id, promoter_id, title, currency FROM catalog.events WHERE id = $1`,
      [input.eventId],
    );
    const ev = evRes.rows[0];
    if (!ev) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'EVENT_NOT_FOUND' }, { status: 404 });
    }
    if (ev.promoter_id !== promoter.promoterId) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'FORBIDDEN', message: 'Tato akce nepatří vašemu promotérovi.' },
        { status: 403 },
      );
    }

    // 2) Načti ticket_type + zkontroluj remaining_qty
    const ttRes = await client.query<{
      id: string;
      event_id: string;
      name: string;
      base_price: number;
      remaining_qty: number;
      zone: string | null;
      is_seated: boolean;
    }>(
      `SELECT id, event_id, name, base_price, remaining_qty, zone, is_seated
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
      return NextResponse.json(
        { error: 'OUT_OF_STOCK', remaining: tt.remaining_qty },
        { status: 422 },
      );
    }

    // 3) Auto-pick seats pro seated event
    let seatIds: string[] = [];
    if (tt.is_seated) {
      const seatsRes = await client.query<{ id: string; sector: string; row: string; seat_number: string }>(
        `SELECT id, sector, row, seat_number
         FROM catalog.event_seats
         WHERE event_id = $1
           AND ticket_type_id = $2
           AND status = 'available'
         ORDER BY sector, row, seat_number
         LIMIT $3
         FOR UPDATE SKIP LOCKED`,
        [input.eventId, input.ticketTypeId, input.quantity],
      );
      if (seatsRes.rows.length < input.quantity) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'NOT_ENOUGH_AVAILABLE_SEATS',
            available: seatsRes.rows.length,
            requested: input.quantity,
          },
          { status: 422 },
        );
      }
      seatIds = seatsRes.rows.map((r) => r.id);
      // Mark seats as sold (atomically)
      await client.query(
        `UPDATE catalog.event_seats SET status = 'sold' WHERE id = ANY($1::uuid[])`,
        [seatIds],
      );
    }

    // 4) Vyrobit walk-in user
    const walkinEmail = `walkin+${randomUUID().slice(0, 8)}@${promoter.promoterSlug || 'pos'}.local`;
    const userRes = await client.query<{ id: string }>(
      `INSERT INTO identity.users (email, name, password_hash, gdpr_consent_at)
       VALUES ($1, $2, '!walk-in-no-password', now())
       RETURNING id`,
      [walkinEmail, input.buyerName ?? 'Walk-in kupující'],
    );
    const userId = userRes.rows[0].id;

    // 5) Order
    const totalAmount = tt.base_price * input.quantity;
    const orderRes = await client.query<{ id: string }>(
      `INSERT INTO orders.orders
         (user_id, status, total_amount, currency, paid_at,
          expires_at, event_id, payment_provider)
       VALUES ($1, 'paid', $2, $3, now(),
               now() + interval '1 hour', $4, 'free')
       RETURNING id`,
      [userId, totalAmount, ev.currency, input.eventId],
    );
    const orderId = orderRes.rows[0].id;

    // 6) Order items — pro seated 1 item per seat, pro standing 1 item × quantity
    if (tt.is_seated) {
      for (const seatId of seatIds) {
        await client.query(
          `INSERT INTO orders.order_items
             (order_id, ticket_type_id, quantity, unit_price, total_price, seat_id)
           VALUES ($1, $2, 1, $3, $3, $4)`,
          [orderId, tt.id, tt.base_price, seatId],
        );
      }
    } else {
      await client.query(
        `INSERT INTO orders.order_items
           (order_id, ticket_type_id, quantity, unit_price, total_price)
         VALUES ($1, $2, $3, $4, $5)`,
        [orderId, tt.id, input.quantity, tt.base_price, totalAmount],
      );
    }

    // 7) Decrement remaining_qty
    await client.query(
      `UPDATE catalog.ticket_types
         SET remaining_qty = remaining_qty - $1
       WHERE id = $2`,
      [input.quantity, tt.id],
    );

    // 8) Vystav lístky (přes existing issuer — TOTP secret + insert do tickets.tickets)
    const issued = await issueTicketsForOrder(orderId, client);

    await client.query('COMMIT');

    return NextResponse.json({
      success: true,
      orderId,
      eventTitle: ev.title,
      ticketTypeName: tt.name,
      paymentMethod: input.paymentMethod,
      totalAmountHalire: totalAmount,
      buyerName: input.buyerName ?? 'Walk-in kupující',
      tickets: issued.map((t) => ({
        ticketId: t.ticketId,
        totpSecretBase32: t.totpSecretBase32,
        qrPayload: `tixly:${t.ticketId}:CURRENT`, // placeholder, klient regeneruje TOTP přes otpauth
      })),
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[pos/sale]', e);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
