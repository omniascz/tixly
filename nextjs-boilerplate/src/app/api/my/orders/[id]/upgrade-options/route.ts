/**
 * GET /api/my/orders/[id]/upgrade-options
 *
 * Vrací dostupné upgrady pro objednávku: lepší sektory / řady na stejném eventu.
 * Pouze pro orders kde event.date_start > now().
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const client = await db().connect();
  try {
    // Fetch original tickets in the order
    const orderRes = await client.query<{
      id: string; event_id: string; status: string;
    }>(
      `SELECT o.id, o.event_id, o.status
         FROM orders.orders o
        WHERE o.id = $1 AND o.user_id = $2 AND o.status = 'paid'`,
      [params.id, userId],
    );
    if (orderRes.rowCount === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const order = orderRes.rows[0];

    // Check event not started
    const evRes = await client.query<{ date_start: string; has_seating: boolean }>(
      `SELECT date_start, (SELECT COUNT(*) > 0 FROM catalog.seat_maps WHERE event_id = e.id) AS has_seating
         FROM catalog.events e WHERE e.id = $1`,
      [order.event_id],
    );
    if (!evRes.rows[0] || new Date(evRes.rows[0].date_start) < new Date()) {
      return NextResponse.json({ error: 'EVENT_STARTED' }, { status: 409 });
    }

    // Get tickets for this order with current seat info
    const ticketsRes = await client.query(
      `SELECT tt.id AS ticket_id, tt.ticket_type_id, tt.original_price,
              tty.name AS ticket_type_name, tty.section_id,
              s.id AS seat_id, s.row_label, s.seat_number, s.section_name,
              sm.price_modifier
         FROM tickets.tickets tt
         JOIN catalog.ticket_types tty ON tty.id = tt.ticket_type_id
         LEFT JOIN catalog.seats s ON s.id = (
           SELECT seat_id FROM orders.seat_assignments WHERE ticket_id = tt.id LIMIT 1
         )
         LEFT JOIN catalog.seat_map_entries sm ON sm.seat_id = s.id AND sm.event_id = $1
        WHERE tt.order_id = $2 AND tt.status = 'valid'`,
      [order.event_id, params.id],
    );

    if (ticketsRes.rowCount === 0) return NextResponse.json({ upgrades: [] });

    // Find better seats: higher price_modifier seats that are still available
    const upgradesRes = await client.query(
      `SELECT
           s.id AS seat_id, s.row_label, s.seat_number, s.section_name,
           sm.price_modifier,
           tty2.id AS ticket_type_id, tty2.name AS ticket_type_name, tty2.price_halire
         FROM catalog.seats s
         JOIN catalog.seat_map_entries sm ON sm.seat_id = s.id AND sm.event_id = $1
         JOIN catalog.ticket_types tty2 ON tty2.event_id = $1
           AND tty2.price_halire > (
             SELECT MIN(tt.original_price) FROM tickets.tickets tt WHERE tt.order_id = $2
           )
        WHERE s.venue_id = (SELECT venue_id FROM catalog.events WHERE id = $1)
          AND NOT EXISTS (
            SELECT 1 FROM orders.seat_assignments sa
             JOIN tickets.tickets tt2 ON tt2.id = sa.ticket_id
             JOIN orders.orders o2 ON o2.id = tt2.order_id
            WHERE sa.seat_id = s.id AND o2.event_id = $1 AND o2.status IN ('pending','paid')
          )
          AND NOT EXISTS (
            SELECT 1 FROM orders.seat_upgrades su
             WHERE su.new_seat_id = s.id AND su.status IN ('pending','paid')
          )
        ORDER BY sm.price_modifier DESC NULLS LAST, tty2.price_halire DESC
        LIMIT 50`,
      [order.event_id, params.id],
    );

    return NextResponse.json({
      tickets: ticketsRes.rows,
      availableUpgrades: upgradesRes.rows,
    });
  } catch (err) {
    console.error('[GET /upgrade-options]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }
}
