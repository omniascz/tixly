/**
 * POST /api/buyer/tickets/[ticketId]/change-request
 *
 * Eventbrite Ticket Changes — buyer žádá změnu:
 *   - ticket_type (VIP → Standard)
 *   - event (jiná akce stejného promotéra, pokud má taky allow_ticket_changes)
 *   - date (recurring event)
 *   - seat (reserved seating swap)
 *
 * Body: { changeType, newTicketTypeId?, newEventId?, newSeatId?, reason? }
 *
 * Self-service podmínky (Eventbrite-style):
 *   - event.allow_ticket_changes = true
 *   - před deadline (event.ticket_change_deadline_hours_before)
 *   - ticket.status = 'valid' (ne used/revoked)
 *   - buyer je owner ticketu
 *   - nový ticket_type/seat má místo
 *
 * Pricing diff: kalkuluje se automaticky. Buyer dostane buď charge intent
 * nebo refund schedule.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import { z } from 'zod';


const schema = z.object({
  changeType: z.enum(['ticket_type', 'event', 'date', 'seat']),
  newTicketTypeId: z.string().uuid().optional(),
  newEventId: z.string().uuid().optional(),
  newSeatId: z.string().uuid().optional(),
  reason: z.string().max(500).optional(),
});

export async function POST(req: NextRequest, props: { params: Promise<{ ticketId: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsUser(req, async (userId) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
  }

  // Load ticket + event policy
  const ticket = await db().query<{
    id: string;
    status: string;
    owner_id: string;
    ticket_type_id: string;
    event_id: string;
    event_date_start: string;
    allow_changes: boolean;
    deadline_hours: number | null;
    ticket_price: number;
    no_gifting_mode: boolean;
  }>(
    `SELECT t.id, t.status, t.owner_id, t.ticket_type_id,
            o.event_id,
            e.date_start::text AS event_date_start,
            COALESCE(e.allow_ticket_changes, true) AS allow_changes,
            COALESCE(e.ticket_change_deadline_hours_before, 24) AS deadline_hours,
            tt.base_price AS ticket_price,
            COALESCE(e.no_gifting_mode, false) AS no_gifting_mode
       FROM tickets.tickets t
       JOIN orders.orders o ON o.id = t.order_id
       JOIN catalog.events e ON e.id = o.event_id
       JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
      WHERE t.id = $1`,
    [params.ticketId],
  );

  if (ticket.rows.length === 0) {
    return NextResponse.json({ error: 'TICKET_NOT_FOUND' }, { status: 404 });
  }
  const t = ticket.rows[0];

  if (t.owner_id !== userId) {
    return NextResponse.json({ error: 'NOT_OWNER' }, { status: 403 });
  }
  if (t.status !== 'valid') {
    return NextResponse.json({ error: 'TICKET_NOT_VALID', status: t.status }, { status: 409 });
  }
  if (!t.allow_changes || t.no_gifting_mode) {
    return NextResponse.json({
      error: 'CHANGES_DISABLED',
      message: 'Tato akce neumožňuje swap lístků.',
    }, { status: 409 });
  }
  // Deadline check
  const deadlineMs = new Date(t.event_date_start).getTime() - (t.deadline_hours ?? 24) * 3_600_000;
  if (Date.now() > deadlineMs) {
    return NextResponse.json({
      error: 'PAST_DEADLINE',
      message: `Swap deadline byl ${new Date(deadlineMs).toLocaleString('cs-CZ')}.`,
    }, { status: 409 });
  }

  // Compute new ticket_type / event / pricing
  let newTicketType = t.ticket_type_id;
  let newEvent = t.event_id;
  let newPrice = t.ticket_price;

  if (parsed.data.changeType === 'ticket_type' && parsed.data.newTicketTypeId) {
    const tt = await db().query<{ base_price: number; remaining_qty: number; event_id: string }>(
      `SELECT base_price, remaining_qty, event_id
         FROM catalog.ticket_types
        WHERE id = $1 AND visibility = 'public'`,
      [parsed.data.newTicketTypeId],
    );
    if (tt.rows.length === 0 || tt.rows[0].event_id !== t.event_id) {
      return NextResponse.json({ error: 'INVALID_NEW_TICKET_TYPE' }, { status: 422 });
    }
    if (tt.rows[0].remaining_qty <= 0) {
      return NextResponse.json({ error: 'NEW_TICKET_SOLD_OUT' }, { status: 409 });
    }
    newTicketType = parsed.data.newTicketTypeId;
    newPrice = tt.rows[0].base_price;
  }

  if (parsed.data.changeType === 'event' && parsed.data.newEventId) {
    // Eventbrite policy: new event must be same promoter + also allow changes
    const ev = await db().query<{ promoter_id: string; allow_changes: boolean }>(
      `SELECT promoter_id, COALESCE(allow_ticket_changes, true) AS allow_changes
         FROM catalog.events WHERE id = $1`,
      [parsed.data.newEventId],
    );
    const cur = await db().query<{ promoter_id: string }>(
      `SELECT promoter_id FROM catalog.events WHERE id = $1`,
      [t.event_id],
    );
    if (ev.rows.length === 0 ||
        ev.rows[0].promoter_id !== cur.rows[0].promoter_id ||
        !ev.rows[0].allow_changes) {
      return NextResponse.json({ error: 'INVALID_NEW_EVENT' }, { status: 422 });
    }
    newEvent = parsed.data.newEventId;
  }

  const priceDiff = newPrice - t.ticket_price;

  // Vložit ticket_change s pending status
  const r = await db().query<{ id: string }>(
    `INSERT INTO tickets.ticket_changes
       (ticket_id, change_type,
        old_ticket_type_id, new_ticket_type_id,
        old_event_id, new_event_id,
        old_seat_id, new_seat_id,
        price_diff_halire, refund_amount_halire,
        initiated_by_user_id, initiated_by, reason, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'buyer', $12, 'pending')
     RETURNING id`,
    [
      params.ticketId, parsed.data.changeType,
      t.ticket_type_id, newTicketType,
      t.event_id, newEvent,
      null, parsed.data.newSeatId ?? null,
      Math.max(0, priceDiff),
      Math.max(0, -priceDiff),
      userId, parsed.data.reason ?? null,
    ],
  );

  return NextResponse.json({
    changeRequestId: r.rows[0].id,
    requiresPayment: priceDiff > 0,
    priceDiffHalire: priceDiff,
    refundAmountHalire: Math.max(0, -priceDiff),
    status: 'pending',
    message: priceDiff > 0
      ? `Doplatek ${(priceDiff / 100).toFixed(0)} Kč potřebný — pokračuj v checkoutu.`
      : priceDiff < 0
        ? `Vrátíme ti ${Math.abs(priceDiff / 100).toFixed(0)} Kč po schválení.`
        : 'Žádný cenový rozdíl. Žádost čeká na schválení.',
  }, { status: 201 });

  });
}
