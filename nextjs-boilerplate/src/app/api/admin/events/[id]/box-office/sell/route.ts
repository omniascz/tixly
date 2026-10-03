/**
 * POST /api/admin/events/[id]/box-office/sell
 *
 * Prodej vstupenky na pokladně. Vytvoří orders.order jako 'paid' (platba hotovostí/kartou
 * na místě), vydá vstupenku přes issueTicketsForOrder, zaznamená prodej v box_office_sales.
 *
 * Body: { sessionId, ticketTypeId, quantity, paymentType, cashTenderedHalire? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { createOrGetGuestUser } from '@/lib/identity/guest-user';
import { runAsPromoter } from '@/lib/admin-auth';
import { salesClosedResponse } from '@/lib/sales/cutoff';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    let body: {
      sessionId?: string;
      ticketTypeId?: string;
      quantity?: number;
      paymentType?: 'cash' | 'card' | 'voucher';
      cashTenderedHalire?: number;
      buyerName?: string;
      buyerEmail?: string;
    };
    try { body = (await req.json()) as typeof body; } catch {
      return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
    }

    const { sessionId, ticketTypeId, quantity = 1, paymentType = 'cash' } = body;
    if (!sessionId || !ticketTypeId) {
      return NextResponse.json({ error: 'MISSING_FIELDS' }, { status: 422 });
    }
    // Kolo 7 (C-29): pokladna na místě prodává do konce akce (date_end, jinak začátek + 12 h).
    const salesClosed = await salesClosedResponse(db(), params.id, 'box_office');
    if (salesClosed) return salesClosed;

    const client = await db().connect();
    try {
      await client.query('BEGIN');

      // Verify session open + belongs to this event + promoter
      const sessionRes = await client.query(
        `SELECT s.id FROM orders.box_office_sessions s
           JOIN catalog.events e ON e.id = s.event_id
          WHERE s.id = $1 AND s.event_id = $2 AND e.promoter_id = $3 AND s.status = 'open'`,
        [sessionId, params.id, ctx.promoterId],
      );
      if (sessionRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'SESSION_NOT_FOUND_OR_CLOSED' }, { status: 404 });
      }

      // Load ticket type + price
      const ttRes = await client.query<{
        id: string; name: string; price_halire: number; remaining_qty: number; currency: string;
      }>(
        `SELECT id, name, base_price AS price_halire, remaining_qty,
                (SELECT currency FROM catalog.events WHERE id = $2) AS currency
           FROM catalog.ticket_types
          WHERE id = $1 AND event_id = $2 AND remaining_qty >= $3
          FOR UPDATE`,
        [ticketTypeId, params.id, quantity],
      );
      if (ttRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'TICKET_TYPE_UNAVAILABLE' }, { status: 409 });
      }
      const tt = ttRes.rows[0];
      const total = tt.price_halire * quantity;
      const change = paymentType === 'cash' && body.cashTenderedHalire
        ? Math.max(0, body.cashTenderedHalire - total) : 0;

      // Create order as 'paid' (no payment gateway for box office)
      const buyerEmail = body.buyerEmail ?? `boxoffice-${Date.now()}@tixly.local`;
      const buyerName = body.buyerName ?? 'Pokladní prodej';

      // Ensure guest user exists.
      // `overwriteName` reprodukuje původní `ON CONFLICT ... DO UPDATE SET
      // name = EXCLUDED.name` (bez `updated_at`) 1:1 — pokladní prodej tedy
      // pořád přepíše jméno na účtu, i když patří registrovanému zákazníkovi.
      // Že je to takhle žádoucí, je samostatné produktové rozhodnutí; tenhle
      // refactor chování nemění.
      const userId = await runWithServiceContext(() =>
        // Zapis do identity.users je SERVISNI operace — 9 rout to tak dela,
        // 4 admin routy byly odchylka (FINDINGS 86). Pod promoterskym
        // kontextem pada SELECT faze upsertu (ON CONFLICT ... RETURNING
        // potrebuje konfliktni radek precist) — FINDINGS 87.
        // Vlastni servisni pripojeni: AsyncLocalStorage kontext se po
        // dobehnuti vraci sam, takze do zbytku requestu NEPRETECE.
        createOrGetGuestUser(db(), {
        email: buyerEmail,
        name: buyerName,
        onExisting: 'overwriteName',
        }),
      );

      const orderRes = await client.query<{ id: string }>(
        `INSERT INTO orders.orders
           (user_id, event_id, status, total_amount, currency, payment_provider,
            is_box_office, box_office_session_id, idempotency_key)
         VALUES ($1,$2,'paid',$3,$4,'box_office',true,$5,gen_random_uuid())
         RETURNING id`,
        [userId, params.id, total, tt.currency, sessionId],
      );
      const orderId = orderRes.rows[0].id;

      await client.query(
        `INSERT INTO orders.order_items (order_id, ticket_type_id, quantity, unit_price, total_price)
         VALUES ($1,$2,$3,$4,$5)`,
        [orderId, tt.id, quantity, tt.price_halire, total],
      );

      // Decrement inventory
      await client.query(
        `UPDATE catalog.ticket_types SET remaining_qty = remaining_qty - $1 WHERE id = $2`,
        [quantity, tt.id],
      );

      // Generate receipt number
      const receiptNum = `POS-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;

      // Record sale
      await client.query(
        `INSERT INTO orders.box_office_sales
           (session_id, order_id, ticket_type_id, ticket_type_name, quantity,
            unit_price_halire, total_halire, payment_type, cash_tendered_halire, change_halire, receipt_number)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [sessionId, orderId, tt.id, tt.name, quantity, tt.price_halire, total,
         paymentType, body.cashTenderedHalire ?? null, change, receiptNum],
      );

      // Update session totals
      if (paymentType === 'cash') {
        await client.query(
          `UPDATE orders.box_office_sessions
             SET cash_in_halire = cash_in_halire + $1,
                 tickets_sold = tickets_sold + $2
           WHERE id = $3`,
          [total, quantity, sessionId],
        );
      } else {
        await client.query(
          `UPDATE orders.box_office_sessions
             SET card_in_halire = card_in_halire + $1,
                 tickets_sold = tickets_sold + $2
           WHERE id = $3`,
          [total, quantity, sessionId],
        );
      }

      await client.query('COMMIT');

      return NextResponse.json({
        orderId,
        receiptNumber: receiptNum,
        totalHalire: total,
        changeHalire: change,
        ticketTypeName: tt.name,
        quantity,
      }, { status: 201 });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.error('[POST /box-office/sell]', err);
      return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
