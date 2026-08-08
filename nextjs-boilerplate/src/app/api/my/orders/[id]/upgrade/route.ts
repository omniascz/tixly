/**
 * POST /api/my/orders/[id]/upgrade
 *
 * Zahájí upgrade sedadla pro danou vstupenku v objednávce.
 * Body: { ticketId, newSeatId, newTicketTypeId }
 * Vrací upgrade ID + payment URL (pokud je upgrade_fee > 0)
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithUserContext } from '@/lib/db/rls-pool';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  let body: { ticketId?: string; newSeatId?: string; newTicketTypeId?: string };
  try { body = (await req.json()) as typeof body; } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }
  if (!body.ticketId || !body.newTicketTypeId) {
    return NextResponse.json({ error: 'MISSING_FIELDS' }, { status: 422 });
  }

  // Uzivatelska data — bez app.current_user_id RLS odfiltruje vse a routa
  // vraci prazdno (FINDINGS 91).
  return runWithUserContext(userId, async () => {
    const client = await db().connect();
    try {
      await client.query('BEGIN');

      // Verify ownership
      const ticketRes = await client.query<{
        id: string; original_price: number; status: string; event_id: string;
      }>(
        `SELECT tt.id, tt.original_price, tt.status, o.event_id
           FROM tickets.tickets tt
           JOIN orders.orders o ON o.id = tt.order_id
          WHERE tt.id = $1 AND tt.order_id = $2 AND o.user_id = $3 AND tt.status = 'valid'`,
        [body.ticketId, params.id, userId],
      );
      if (ticketRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'TICKET_NOT_FOUND' }, { status: 404 });
      }
      const ticket = ticketRes.rows[0];

      // Check no pending upgrade for this ticket
      const existingUpgrade = await client.query(
        `SELECT 1 FROM orders.seat_upgrades WHERE original_ticket_id=$1 AND status='pending'`,
        [body.ticketId],
      );
      if ((existingUpgrade.rowCount ?? 0) > 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'UPGRADE_PENDING' }, { status: 409 });
      }

      // Get new ticket type price
      const ttRes = await client.query<{ base_price: number; name: string }>(
        `SELECT base_price, name FROM catalog.ticket_types
          WHERE id=$1 AND event_id=$2 AND remaining_qty>0 FOR UPDATE`,
        [body.newTicketTypeId, ticket.event_id],
      );
      if (ttRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'TICKET_TYPE_UNAVAILABLE' }, { status: 409 });
      }

      const upgradeFee = Math.max(0, ttRes.rows[0].base_price - ticket.original_price);

      // If new seat specified, verify it's available
      if (body.newSeatId) {
        const seatCheck = await client.query(
          `SELECT 1 FROM orders.seat_assignments sa
            JOIN tickets.tickets t2 ON t2.id = sa.ticket_id
            JOIN orders.orders o2 ON o2.id = t2.order_id
           WHERE sa.seat_id=$1 AND o2.event_id=$2 AND o2.status IN ('pending','paid')`,
          [body.newSeatId, ticket.event_id],
        );
        if ((seatCheck.rowCount ?? 0) > 0) {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'SEAT_TAKEN' }, { status: 409 });
        }
      }

      // Create upgrade record
      const upgradeRes = await client.query<{ id: string }>(
        `INSERT INTO orders.seat_upgrades
           (original_order_id, original_ticket_id, original_seat_id,
            new_seat_id, new_ticket_type_id, upgrade_fee_halire, status)
         VALUES ($1,$2,
           (SELECT seat_id FROM orders.seat_assignments WHERE ticket_id=$2 LIMIT 1),
           $3,$4,$5,'pending')
         RETURNING id`,
        [params.id, body.ticketId, body.newSeatId ?? null, body.newTicketTypeId, upgradeFee],
      );
      const upgradeId = upgradeRes.rows[0].id;

      if (upgradeFee === 0) {
        // Free upgrade — apply immediately
        if (body.newSeatId) {
          await client.query(
            `UPDATE orders.seat_assignments SET seat_id=$1 WHERE ticket_id=$2`,
            [body.newSeatId, body.ticketId],
          );
        }
        await client.query(
          `UPDATE tickets.tickets SET ticket_type_id=$1 WHERE id=$2`,
          [body.newTicketTypeId, body.ticketId],
        );
        await client.query(
          `UPDATE orders.seat_upgrades SET status='paid', completed_at=now() WHERE id=$1`,
          [upgradeId],
        );
        await client.query('COMMIT');
        return NextResponse.json({ upgradeId, upgradeFeeHalire: 0, applied: true });
      }

      await client.query('COMMIT');
      return NextResponse.json({
        upgradeId,
        upgradeFeeHalire: upgradeFee,
        applied: false,
        newTicketTypeName: ttRes.rows[0].name,
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.error('[POST /upgrade]', err);
      return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
