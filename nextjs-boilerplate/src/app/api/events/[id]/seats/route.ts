/**
 * GET /api/events/[id]/seats
 * Public — vrátí layout + seat status pro buyer SVG picker.
 *
 * Query: ?eventDayId=uuid (volitelné pro multi-day)
 *
 * Lehký response — hold_user_id ani ticket_id se neexponují.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';


export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
  }
  const eventDayId = req.nextUrl.searchParams.get('eventDayId');

  // Get layout + venue
  const ev = await db().query<{ venue_id: string }>(
    `SELECT venue_id FROM catalog.events WHERE id = $1 AND status = 'published'`,
    [params.id],
  );
  if (ev.rows.length === 0 || !ev.rows[0].venue_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const layout = await db().query<{ layout: unknown }>(
    `SELECT layout FROM catalog.venue_seating_charts
     WHERE venue_id = $1 AND active = true
     ORDER BY created_at DESC LIMIT 1`,
    [ev.rows[0].venue_id],
  );
  if (layout.rows.length === 0) {
    return NextResponse.json({ error: 'NO_LAYOUT' }, { status: 404 });
  }

  // Public seat data — only essentials
  const args: unknown[] = [params.id];
  let dayClause = `AND event_day_id IS NULL`;
  if (eventDayId) {
    args.push(eventDayId);
    dayClause = `AND (event_day_id = $2 OR event_day_id IS NULL)`;
  }
  const seats = await db().query<{
    id: string;
    sector: string;
    row: string;
    seat_number: string;
    status: string;
    accessibility: boolean;
    ticket_type_id: string;
    base_price: number;
  }>(
    `SELECT es.id, es.sector, es.row, es.seat_number,
            CASE
              WHEN es.status = 'held' AND es.hold_until <= NOW() THEN 'available'
              ELSE es.status
            END AS status,
            es.accessibility, es.ticket_type_id, tt.base_price
     FROM catalog.event_seats es
     LEFT JOIN catalog.ticket_types tt ON tt.id = es.ticket_type_id
     WHERE es.event_id = $1 ${dayClause}`,
    args,
  );

  // Group ticket types
  const ticketTypes = new Map<string, { id: string; price: number; count: number }>();
  for (const s of seats.rows) {
    if (!s.ticket_type_id) continue;
    const tt = ticketTypes.get(s.ticket_type_id) ?? {
      id: s.ticket_type_id,
      price: s.base_price,
      count: 0,
    };
    tt.count += 1;
    ticketTypes.set(s.ticket_type_id, tt);
  }

  return NextResponse.json({
    layout: layout.rows[0].layout,
    seats: seats.rows.map((s) => ({
      id: s.id,
      sector: s.sector,
      row: s.row,
      num: s.seat_number,
      status: s.status,
      acc: s.accessibility,
      ttId: s.ticket_type_id,
    })),
    ticketTypes: Array.from(ticketTypes.values()),
  });
}
