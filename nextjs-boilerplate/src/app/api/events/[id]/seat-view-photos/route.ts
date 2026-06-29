/**
 * GET /api/events/[id]/seat-view-photos — public
 *
 * Vrací mapu { sectorPhotos: Record<sectorName, { photoUrl, thumbnailUrl, caption }> }
 * pro buyer seat picker. Bez autentizace, jen aktivní eventy.
 *
 * Fotky jsou venue-level (catalog.seat_view_photos), sdílí se přes všechny eventy
 * v daném sálu. SeatPicker je mapuje dle sector.name, ne seatId.
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

    // Event musí být published nebo v minulosti
    const ev = await client.query<{ venue_id: string | null; status: string }>(
      `SELECT venue_id, status FROM catalog.events WHERE id = $1`,
      [params.id],
    );
    if (ev.rows.length === 0 || ev.rows[0].status !== 'published') {
      await client.query('ROLLBACK');
      return NextResponse.json({ sectorPhotos: {} });
    }

    const venueId = ev.rows[0].venue_id;
    if (!venueId) {
      await client.query('ROLLBACK');
      return NextResponse.json({ sectorPhotos: {} });
    }

    const r = await client.query<{
      sector_name: string;
      photo_url: string;
      thumbnail_url: string | null;
      caption: string | null;
    }>(
      `SELECT sector_name, photo_url, thumbnail_url, caption
         FROM catalog.seat_view_photos
        WHERE venue_id = $1
        ORDER BY sort_order, sector_name`,
      [venueId],
    );

    await client.query('COMMIT');

    const sectorPhotos: Record<
      string,
      { photoUrl: string; thumbnailUrl: string | null; caption: string | null }
    > = {};
    for (const row of r.rows) {
      sectorPhotos[row.sector_name] = {
        photoUrl: row.photo_url,
        thumbnailUrl: row.thumbnail_url,
        caption: row.caption,
      };
    }

    return NextResponse.json({ sectorPhotos, count: r.rows.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[GET seat-view-photos]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }
}
