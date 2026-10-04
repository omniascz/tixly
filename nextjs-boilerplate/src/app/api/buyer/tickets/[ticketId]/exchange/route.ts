import { NextRequest, NextResponse } from 'next/server';
import { asSystemInTx, db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import { z } from 'zod';
import { saleBlockedResponse } from '@/lib/sales/cutoff';

interface TicketInfo {
  id: string;
  status: string;
  owner_id: string;
  ticket_type_id: string;
  event_id: string;
  event_seat_id: string | null;
  production_id: string | null;
  allow_self_service_exchange: boolean;
  exchange_fee_halire: number;
}

interface AvailableEvent {
  id: string;
  title: string;
  date_start: string;
  available_seats_count: number;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { ticketId: string } },
): Promise<Response> {
  return runAsUser(req, async (userId) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.ticketId)) {
      return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
    }

    const ticketRes = await db().query<TicketInfo>(
      `SELECT t.id, t.status, t.owner_id, t.ticket_type_id, t.event_seat_id,
              o.event_id,
              e.production_id,
              COALESCE(e.allow_self_service_exchange, false) AS allow_self_service_exchange,
              COALESCE(e.exchange_fee_halire, 0) AS exchange_fee_halire
         FROM tickets.tickets t
         JOIN orders.orders o ON o.id = t.order_id
         JOIN catalog.events e ON e.id = o.event_id
        WHERE t.id = $1`,
      [params.ticketId],
    );

    if (ticketRes.rows.length === 0) {
      return NextResponse.json({ error: 'TICKET_NOT_FOUND' }, { status: 404 });
    }
    const ticket = ticketRes.rows[0];

    if (ticket.owner_id !== userId) {
      return NextResponse.json({ error: 'NOT_OWNER' }, { status: 403 });
    }
    if (ticket.status !== 'valid') {
      return NextResponse.json({ error: 'TICKET_NOT_VALID', status: ticket.status }, { status: 409 });
    }
    if (!ticket.allow_self_service_exchange) {
      return NextResponse.json({ error: 'EXCHANGE_DISABLED' }, { status: 409 });
    }
    if (!ticket.production_id) {
      return NextResponse.json({ error: 'NO_PRODUCTION' }, { status: 409 });
    }

    const eventsRes = await db().query<AvailableEvent>(
      `SELECT e.id, e.title, e.date_start::text AS date_start,
              (SELECT COUNT(*)::int FROM catalog.ticket_types tt
                WHERE tt.event_id = e.id
                  AND tt.remaining_qty > 0) AS available_seats_count
         FROM catalog.events e
        WHERE e.production_id = $1
          AND e.id <> $2
          AND e.date_start > NOW()
          AND COALESCE(e.allow_self_service_exchange, false) = true
          AND EXISTS (
            SELECT 1 FROM catalog.ticket_types tt
             WHERE tt.event_id = e.id AND tt.remaining_qty > 0
          )
        ORDER BY e.date_start ASC`,
      [ticket.production_id, ticket.event_id],
    );

    return NextResponse.json({
      ticketId: ticket.id,
      currentEventId: ticket.event_id,
      exchangeFeeHalire: ticket.exchange_fee_halire,
      availableEvents: eventsRes.rows,
    });
  });
}

const postSchema = z.object({
  targetEventId: z.string().uuid(),
  targetSeatId: z.string().uuid().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { ticketId: string } },
): Promise<Response> {
  return runAsUser(req, async (userId) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.ticketId)) {
      return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
    }

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    }
    // Kolo 7 (C-29): výměna na jinou akci je nový nákup — cílová akce musí mít otevřený online prodej.
    const salesClosed = await saleBlockedResponse(db(), parsed.data.targetEventId, 'online');
    if (salesClosed) return salesClosed;

    const client = await db().connect();
    try {
      await client.query('BEGIN');

      const ticketRes = await client.query<{
        id: string;
        status: string;
        owner_id: string;
        ticket_type_id: string;
        event_id: string;
        event_seat_id: string | null;
        order_id: string;
        production_id: string | null;
        allow_self_service_exchange: boolean;
        exchange_fee_halire: number;
      }>(
        `SELECT t.id, t.status, t.owner_id, t.ticket_type_id, t.event_seat_id, t.order_id,
                o.event_id,
                e.production_id,
                COALESCE(e.allow_self_service_exchange, false) AS allow_self_service_exchange,
                COALESCE(e.exchange_fee_halire, 0) AS exchange_fee_halire
           FROM tickets.tickets t
           JOIN orders.orders o ON o.id = t.order_id
           JOIN catalog.events e ON e.id = o.event_id
          WHERE t.id = $1
            FOR UPDATE OF t`,
        [params.ticketId],
      );

      if (ticketRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'TICKET_NOT_FOUND' }, { status: 404 });
      }
      const ticket = ticketRes.rows[0];

      if (ticket.owner_id !== userId) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'NOT_OWNER' }, { status: 403 });
      }
      if (ticket.status !== 'valid') {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'TICKET_NOT_VALID', status: ticket.status }, { status: 409 });
      }
      if (!ticket.allow_self_service_exchange) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'EXCHANGE_DISABLED' }, { status: 409 });
      }
      if (!ticket.production_id) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'NO_PRODUCTION' }, { status: 409 });
      }

      const targetEventRes = await client.query<{
        id: string;
        title: string;
        date_start: string;
        production_id: string | null;
        allow_self_service_exchange: boolean;
      }>(
        `SELECT id, title, date_start::text AS date_start, production_id,
                COALESCE(allow_self_service_exchange, false) AS allow_self_service_exchange
           FROM catalog.events
          WHERE id = $1`,
        [parsed.data.targetEventId],
      );

      if (targetEventRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'TARGET_EVENT_NOT_FOUND' }, { status: 404 });
      }
      const targetEvent = targetEventRes.rows[0];

      if (targetEvent.production_id !== ticket.production_id) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'DIFFERENT_PRODUCTION' }, { status: 409 });
      }
      if (!targetEvent.allow_self_service_exchange) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'TARGET_EXCHANGE_DISABLED' }, { status: 409 });
      }
      if (new Date(targetEvent.date_start) <= new Date()) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'TARGET_EVENT_PAST' }, { status: 409 });
      }

      // Kolo 2 / V8: kapacita a sedadla cílové akce = systémový efekt výměny (kupec je
      // měnit ani zamykat nesmí); vstupenka je výše ověřena jako kupcova (FOR UPDATE OF t).
      const targetTtRes = await asSystemInTx(client, () => client.query<{
        id: string;
        remaining_qty: number;
      }>(
        `SELECT id, remaining_qty
           FROM catalog.ticket_types
          WHERE event_id = $1
            AND remaining_qty > 0
          ORDER BY base_price ASC
          LIMIT 1
            FOR UPDATE`,
        [parsed.data.targetEventId],
      ));

      if (targetTtRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'TARGET_SOLD_OUT' }, { status: 409 });
      }
      const targetTt = targetTtRes.rows[0];

      let newSeatId: string | null = null;
      let newSeatInfo: string | null = null;

      if (parsed.data.targetSeatId) {
        const seatRes = await asSystemInTx(client, () => client.query<{
          id: string;
          status: string;
          row_label: string | null;
          seat_num: string | null;
        }>(
          `SELECT id, status, row AS row_label, seat_number AS seat_num
             FROM catalog.event_seats
            WHERE id = $1 AND event_id = $2
              FOR UPDATE`,
          [parsed.data.targetSeatId, parsed.data.targetEventId],
        ));
        if (seatRes.rows.length === 0 || seatRes.rows[0].status !== 'available') {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'SEAT_NOT_AVAILABLE' }, { status: 409 });
        }
        newSeatId = seatRes.rows[0].id;
        const s = seatRes.rows[0];
        newSeatInfo = s.row_label && s.seat_num ? `${s.row_label}${s.seat_num}` : null;
      } else {
        const autoSeatRes = await asSystemInTx(client, () => client.query<{
          id: string;
          row_label: string | null;
          seat_num: string | null;
        }>(
          `SELECT id, row AS row_label, seat_number AS seat_num
             FROM catalog.event_seats
            WHERE event_id = $1 AND status = 'available'
            ORDER BY row, seat_number
            LIMIT 1
              FOR UPDATE`,
          [parsed.data.targetEventId],
        ));
        if (autoSeatRes.rows.length > 0) {
          newSeatId = autoSeatRes.rows[0].id;
          const s = autoSeatRes.rows[0];
          newSeatInfo = s.row_label && s.seat_num ? `${s.row_label}${s.seat_num}` : null;
        }
      }

      if (ticket.event_seat_id) {
        await asSystemInTx(client, () => client.query(
          `UPDATE catalog.event_seats
              SET status = 'available', order_id = NULL, ticket_id = NULL,
                  hold_user_id = NULL, hold_until = NULL, updated_at = NOW()
            WHERE id = $1`,
          [ticket.event_seat_id],
        ));
      }

      if (newSeatId) {
        await asSystemInTx(client, () => client.query(
          `UPDATE catalog.event_seats
              SET status = 'sold', ticket_id = $1, updated_at = NOW()
            WHERE id = $2`,
          [ticket.id, newSeatId],
        ));
      }

      // Kolo 3 (guard 486): sedadlo lístku a akce objednávky jsou chráněné sloupce —
      // systémový efekt výměny; vstupenka ověřena výše jako kupcova (FOR UPDATE OF t).
      await asSystemInTx(client, () => client.query(
        `UPDATE tickets.tickets
            SET event_seat_id = $1, updated_at = NOW()
          WHERE id = $2`,
        [newSeatId, ticket.id],
      ));

      // Kolo 4: dřív `UPDATE orders SET event_id` pro CELOU objednávku — akce vstupenky se
      // odvozuje z objednávky, takže na nový termín se „přestěhovaly" i ostatní vstupenky
      // objednávky; vyměněná navíc zůstala typem původní akce.
      //  - jediná vstupenka v objednávce → přepne se objednávka i typ lístku/položky;
      //  - víc vstupenek → vyměněná se přesune do nové objednávky výměny (cílový termín,
      //    cena 0 — zaplacené peníze zůstávají u původní objednávky), ostatní zůstanou.
      const siblings = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM tickets.tickets WHERE order_id = $1 AND id <> $2`,
        [ticket.order_id, ticket.id],
      );
      if ((siblings.rows[0]?.n ?? 0) === 0) {
        await asSystemInTx(client, async () => {
          await client.query(
            `UPDATE orders.orders SET event_id = $1, updated_at = NOW() WHERE id = $2`,
            [parsed.data.targetEventId, ticket.order_id],
          );
          await client.query(
            `UPDATE orders.order_items SET ticket_type_id = $1 WHERE order_id = $2`,
            [targetTt.id, ticket.order_id],
          );
          await client.query(
            `UPDATE tickets.tickets SET ticket_type_id = $1, updated_at = NOW() WHERE id = $2`,
            [targetTt.id, ticket.id],
          );
        });
      } else {
        await asSystemInTx(client, async () => {
          const created = await client.query<{ id: string }>(
            `INSERT INTO orders.orders
               (user_id, event_id, status, total_amount, currency, payment_provider, paid_at, expires_at)
             SELECT $1, $2, 'paid', 0, o.currency, 'free', NOW(), NOW()
               FROM orders.orders o WHERE o.id = $3
             RETURNING id`,
            [userId, parsed.data.targetEventId, ticket.order_id],
          );
          const newOrderId = created.rows[0].id;
          await client.query(
            `INSERT INTO orders.order_items (order_id, ticket_type_id, quantity, unit_price, total_price)
             VALUES ($1, $2, 1, 0, 0)`,
            [newOrderId, targetTt.id],
          );
          await client.query(
            `UPDATE tickets.tickets SET order_id = $1, ticket_type_id = $2, updated_at = NOW() WHERE id = $3`,
            [newOrderId, targetTt.id, ticket.id],
          );
        });
      }

      await asSystemInTx(client, () => client.query(
        `UPDATE catalog.ticket_types
            SET remaining_qty = remaining_qty - 1
          WHERE id = $1`,
        [targetTt.id],
      ));

      const sourceTtRes = await asSystemInTx(client, () => client.query<{ id: string }>(
        `SELECT id FROM catalog.ticket_types WHERE event_id = $1 AND id = $2`,
        [ticket.event_id, ticket.ticket_type_id],
      ));
      if (sourceTtRes.rows.length > 0) {
        await asSystemInTx(client, () => client.query(
          `UPDATE catalog.ticket_types
              SET remaining_qty = remaining_qty + 1
            WHERE id = $1`,
          [ticket.ticket_type_id],
        ));
      }

      await client.query('COMMIT');

      return NextResponse.json({
        success: true,
        newEventId: parsed.data.targetEventId,
        newEventTitle: targetEvent.title,
        newEventDate: targetEvent.date_start,
        newSeatInfo,
        exchangeFeePaid: ticket.exchange_fee_halire,
      });
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('[exchange POST]', e);
      return NextResponse.json({ error: 'DB_ERROR' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
