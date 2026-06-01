/**
 * GET /api/events/[id]/seat-view-photos — public
 *
 * Vrací mapu { eventSeatId: { photoUrl, thumbnailUrl, caption } } pro buyer
 * seat picker. Bez autentizace, jen aktivní eventy.
 *
 * DACH P2-6 (Reservix Click&View).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';


export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ error: 'INVALID_EVENT_ID' }, { status: 400 });
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.is_platform_admin = 'true'`);

    // Event musí být published (public)
    const ev = await client.query<{ status: string }>(
      `SELECT status FROM catalog.events WHERE id = $1`,
      [params.id],
    );
    if (ev.rows.length === 0 || ev.rows[0].status !== 'published') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'EVENT_NOT_FOUND' }, { status: 404 });
    }

    const r = await client.query<{
      event_seat_id: string;
      photo_url: string;
      thumbnail_url: string | null;
      caption: string | null;
    }>(
      `SELECT p.event_seat_id, p.photo_url, p.thumbnail_url, p.caption
         FROM catalog.event_seat_view_photos p
         JOIN catalog.event_seats es ON es.id = p.event_seat_id
        WHERE es.event_id = $1`,
      [params.id],
    );

    await client.query('COMMIT');

    const photos: Record<
      string,
      { photoUrl: string; thumbnailUrl: string | null; caption: string | null }
    > = {};
    for (const row of r.rows) {
      photos[row.event_seat_id] = {
        photoUrl: row.photo_url,
        thumbnailUrl: row.thumbnail_url,
        caption: row.caption,
      };
    }

    return NextResponse.json({
      eventId: params.id,
      count: r.rows.length,
      photos,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[GET seat-view-photos]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }
}
