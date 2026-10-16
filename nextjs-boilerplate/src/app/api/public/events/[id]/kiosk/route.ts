import { NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

interface EventRow {
  id: string;
  title: string;
  date_start: string;
  date_end: string | null;
  cover_image_url: string | null;
  status: string;
  venue_name: string | null;
  venue_city: string | null;
}

interface TicketTypeRow {
  id: string;
  name: string;
  remaining_qty: number;
  capacity: number | null;
}

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.id)) {
    return NextResponse.json({ error: 'INVALID_ID' }, { status: 422 });
  }

  const evRes = await db().query<EventRow>(
    `SELECT e.id, e.title, e.date_start::text, e.date_end::text,
            e.cover_image_url, e.status,
            v.name AS venue_name, v.city AS venue_city
       FROM catalog.events e
  LEFT JOIN catalog.venues v ON v.id = e.venue_id
      WHERE e.id = $1 AND e.status IN ('published', 'on_sale')`,
    [params.id],
  );

  const ev = evRes.rows[0];
  if (!ev) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const ttRes = await db().query<TicketTypeRow>(
    // Dřív četl neexistující sloupce (capacity, is_active, sort_order) → 500 vždy.
    // Kapacita = total_qty; veřejný kiosk ukazuje jen veřejné typy (ne skryté / na kód).
    `SELECT id, name, remaining_qty, total_qty AS capacity
       FROM catalog.ticket_types
      WHERE event_id = $1 AND visibility = 'public' AND is_donation = FALSE
      ORDER BY base_price, name`,
    [params.id],
  );

  const ticketTypes = ttRes.rows.map((tt) => ({
    id: tt.id,
    name: tt.name,
    remainingQty: tt.remaining_qty,
    soldOut: tt.remaining_qty <= 0,
    capacity: tt.capacity,
  }));

  const totalRemaining = ticketTypes.reduce((sum, tt) => sum + tt.remainingQty, 0);
  const totalCapacity = ticketTypes.reduce((sum, tt) => sum + (tt.capacity ?? 0), 0);

  const body = {
    id: ev.id,
    title: ev.title,
    dateStart: ev.date_start,
    dateEnd: ev.date_end,
    venueName: ev.venue_name,
    venueCity: ev.venue_city,
    coverImageUrl: ev.cover_image_url,
    status: ev.status,
    ticketTypes,
    totalRemaining,
    totalCapacity,
    lastUpdated: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
