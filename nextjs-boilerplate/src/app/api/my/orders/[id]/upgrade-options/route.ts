/**
 * GET /api/my/orders/[id]/upgrade-options
 *
 * Vrací dostupné upgrady pro objednávku: lepší sektory / řady na stejném eventu.
 * Pouze pro orders kde event.date_start > now().
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithUserContext } from '@/lib/db/rls-pool';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  // Uzivatelska data — bez app.current_user_id RLS odfiltruje vse a routa
  // vraci prazdno (FINDINGS 91).
  return runWithUserContext(userId, async () => {
    // Kolo 4: dřív dotazy na neexistující schéma (catalog.seat_maps, seat_map_entries,
    // orders.seat_assignments, ticket_types.section_id/price_halire, seats.row_label) → vždy 500.
    // Sedadlo vstupenky je tickets.event_seat_id → catalog.event_seats; cena typu je base_price.
    const client = await db().connect();
    try {
      const orderRes = await client.query<{ id: string; event_id: string; date_start: string }>(
        `SELECT o.id, o.event_id, e.date_start::text AS date_start
           FROM orders.orders o
           JOIN catalog.events e ON e.id = o.event_id
          WHERE o.id = $1 AND o.user_id = $2 AND o.status = 'paid'`,
        [params.id, userId],
      );
      if (orderRes.rowCount === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
      const order = orderRes.rows[0];
      if (new Date(order.date_start) < new Date()) {
        return NextResponse.json({ error: 'EVENT_STARTED' }, { status: 409 });
      }

      const ticketsRes = await client.query<{
        ticket_id: string; ticket_type_id: string; original_price: number; ticket_type_name: string;
        event_seat_id: string | null; sector: string | null; row: string | null; seat_number: string | null;
      }>(
        `SELECT t.id AS ticket_id, t.ticket_type_id, t.original_price, tt.name AS ticket_type_name,
                es.id AS event_seat_id, es.sector, es.row, es.seat_number
           FROM tickets.tickets t
           JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
           LEFT JOIN catalog.event_seats es ON es.id = t.event_seat_id
          WHERE t.order_id = $1 AND t.status = 'valid'
          ORDER BY t.id`,
        [params.id],
      );
      const tickets = ticketsRes.rows.map((t) => ({
        ticketId: t.ticket_id,
        ticketTypeId: t.ticket_type_id,
        ticketTypeName: t.ticket_type_name,
        pricePaidHalire: t.original_price,
        seat: t.event_seat_id ? { seatId: t.event_seat_id, sector: t.sector, row: t.row, seatNumber: t.seat_number } : null,
      }));
      if (tickets.length === 0) return NextResponse.json({ tickets: [], availableUpgrades: [] });
      const cheapestPaid = Math.min(...tickets.map((t) => t.pricePaidHalire));

      // Dražší veřejné typy téže akce s volnou kapacitou; u sedadlových i volná sedadla.
      const typesRes = await client.query<{ id: string; name: string; base_price: number; remaining_qty: number }>(
        `SELECT id, name, base_price, remaining_qty
           FROM catalog.ticket_types
          WHERE event_id = $1 AND base_price > $2 AND remaining_qty > 0
            AND visibility = 'public' AND is_donation = FALSE
          ORDER BY base_price ASC`,
        [order.event_id, cheapestPaid],
      );
      const seatsRes = typesRes.rows.length === 0 ? { rows: [] as { id: string; ticket_type_id: string; sector: string; row: string; seat_number: string }[] } :
        await client.query<{ id: string; ticket_type_id: string; sector: string; row: string; seat_number: string }>(
          `SELECT id, ticket_type_id, sector, row, seat_number
             FROM catalog.event_seats
            WHERE event_id = $1 AND status = 'available' AND ticket_type_id = ANY($2::uuid[])
            ORDER BY sector, lpad(row, 8, '0'), lpad(seat_number, 8, '0')
            LIMIT 200`,
          [order.event_id, typesRes.rows.map((t) => t.id)],
        );

      return NextResponse.json({
        tickets,
        availableUpgrades: typesRes.rows.map((t) => ({
          ticketTypeId: t.id,
          name: t.name,
          priceHalire: t.base_price,
          diffHalire: t.base_price - cheapestPaid,
          remaining: t.remaining_qty,
          seats: seatsRes.rows
            .filter((s) => s.ticket_type_id === t.id)
            .map((s) => ({ seatId: s.id, sector: s.sector, row: s.row, seatNumber: s.seat_number })),
        })),
      });
    } catch (err) {
      console.error('[GET /upgrade-options]', err);
      return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
