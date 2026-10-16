/**
 * GET /api/events/[id]/seatmap
 *
 * Ticketmaster-style seatmap metadata endpoint.
 * Vrátí staticUrl, interactiveUrl, kapacitu a dostupnost.
 *
 * Použití (partner API):
 *   const { seatmap } = await client.events.get(eventId, ['seatmap']);
 *   // → { staticUrl, interactiveUrl, totalSeats, availableSeats }
 *
 * CORS: * (veřejné)
 * Cache: 30s
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
  }

  return runWithServiceContext(async () => {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.tixly.cz';

    const evRow = await db().query<{
      id: string; slug: string | null; venue_id: string | null; status: string;
    }>(
      `SELECT id, slug, venue_id, status FROM catalog.events WHERE id = $1`,
      [params.id],
    );
    const ev = evRow.rows[0];
    if (!ev || ev.status !== 'published') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (!ev.venue_id) {
      return NextResponse.json({ error: 'NO_SEATING', message: 'This event has no seat map.' }, { status: 404 });
    }

    // Má venue aktivní chart?
    const chartRow = await db().query<{ total_seats: number }>(
      `SELECT total_seats FROM catalog.venue_seating_charts
        WHERE venue_id = $1 AND active = true
        ORDER BY created_at DESC LIMIT 1`,
      [ev.venue_id],
    );
    if (!chartRow.rows[0]) {
      return NextResponse.json({ error: 'NO_LAYOUT' }, { status: 404 });
    }

    // Počty sedadel
    const stats = await db().query<{
      total: string; available: string; held: string; sold: string;
    }>(
      `SELECT
         COUNT(*)                                                          AS total,
         COUNT(*) FILTER (WHERE status = 'available'
                          OR   (status = 'held' AND hold_until <= NOW())) AS available,
         COUNT(*) FILTER (WHERE status = 'held' AND hold_until > NOW())  AS held,
         COUNT(*) FILTER (WHERE status = 'sold')                          AS sold
       FROM catalog.event_seats WHERE event_id = $1`,
      [params.id],
    );
    const s = stats.rows[0];

    const eventPath = ev.slug ? `/cs/p/${ev.slug}` : `/cs/events/${ev.id}`;

    return NextResponse.json(
      {
        seatmap: {
          staticUrl:       `${baseUrl}/api/events/${ev.id}/seats/preview.svg`,
          staticUrlDark:   `${baseUrl}/api/events/${ev.id}/seats/preview.svg?theme=dark`,
          interactiveUrl:  `${baseUrl}${eventPath}/seats`,
          totalSeats:      Number(s.total),
          availableSeats:  Number(s.available),
          heldSeats:       Number(s.held),
          soldSeats:       Number(s.sold),
        },
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=15',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
}
