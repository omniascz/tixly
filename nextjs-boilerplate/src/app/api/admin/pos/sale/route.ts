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
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';
import { saleBlockedResponse } from '@/lib/sales/cutoff';
import { issueTicketsForOrder } from '@/lib/tickets/demo-issuer';


const inputSchema = z.object({
  eventId: z.string().uuid(),
  ticketTypeId: z.string().uuid(),
  quantity: z.number().int().min(1).max(20),
  buyerName: z.string().min(1).max(120).optional(),
  paymentMethod: z.enum(['cash', 'card_terminal']).default('cash'),
  seatIds: z.array(z.string().uuid()).min(1).max(20).optional(),
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
  // Kolo 7 (C-29): pokladna obsluhy prodává do konce akce (date_end, jinak začátek + 12 h).
  const salesClosed = await saleBlockedResponse(db(), input.eventId, 'box_office');
  if (salesClosed) return salesClosed;

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

    // 3) Seats pro seated event — buď manuální výběr z pokladny, nebo auto-pick
    let seatIds: string[] = [];
    if (tt.is_seated) {
      if (input.seatIds && input.seatIds.length > 0) {
        // Manuální výběr pokladní (POS seat grid)
        if (input.seatIds.length !== input.quantity) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            { error: 'SEAT_COUNT_MISMATCH', expected: input.quantity, got: input.seatIds.length },
            { status: 422 },
          );
        }
        const seatsRes = await client.query<{
          id: string;
          status: string;
          ticket_type_id: string;
        }>(
          `SELECT id, status, ticket_type_id
           FROM catalog.event_seats
           WHERE id = ANY($1::uuid[])
             AND event_id = $2
           FOR UPDATE`,
          [input.seatIds, input.eventId],
        );
        if (seatsRes.rows.length !== input.seatIds.length) {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'SEAT_NOT_FOUND' }, { status: 422 });
        }
        const unavailable = seatsRes.rows.filter(
          (s) =>
            (s.status !== 'available' && !(s.status === 'held')) ||
            s.ticket_type_id !== input.ticketTypeId,
        );
        if (unavailable.length > 0) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            { error: 'SEAT_UNAVAILABLE', seats: unavailable.map((s) => s.id) },
            { status: 422 },
          );
        }
        seatIds = input.seatIds;
      } else {
        // Auto-pick — fallback (nemělo by nastat z POS UI, ale pro jistotu)
        const seatsRes = await client.query<{ id: string }>(
          `SELECT id
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
      }
      await client.query(
        `UPDATE catalog.event_seats SET status = 'sold' WHERE id = ANY($1::uuid[])`,
        [seatIds],
      );
    }

    // 4) Vyrobit walk-in user
    const walkinEmail = `walkin+${randomUUID().slice(0, 8)}@${promoter.promoterSlug || 'pos'}.local`;
    // Kolo 2 / V2: id generujeme v aplikaci a INSERT je BEZ `RETURNING`. Pod tixly_app
    // RETURNING vyžaduje, aby nový řádek prošel i SELECT politikou — walk-in ještě nemá
    // objednávku u promotéra (app_can_see_user_as_promoter = false) → 42501 → POS 500.
    // Po vložení objednávky níže ho promotér vidí legitimně (má objednávku na jeho akci).
    const userId = randomUUID();
    await client.query(
      `INSERT INTO identity.users (id, email, name, password_hash, gdpr_consent_at)
       VALUES ($1, $2, $3, '!walk-in-no-password', now())`,
      [userId, walkinEmail, input.buyerName ?? 'Walk-in kupující'],
    );

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
