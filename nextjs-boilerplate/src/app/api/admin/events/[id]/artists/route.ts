/**
 * POST   /api/admin/events/[id]/artists       — link artist to event
 *   Body: { artistId, isHeadliner?, setStartsAt?, setDurationMinutes?, stage? }
 * DELETE /api/admin/events/[id]/artists?artistId=...  — unlink
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

async function ownsEventAndArtist(
  eventId: string, artistId: string, promoterId: string,
): Promise<boolean> {
  const r = await db().query(
    `SELECT 1
       FROM catalog.events e, lineups.artists a
      WHERE e.id = $1 AND a.id = $2
        AND e.promoter_id = $3 AND a.promoter_id = $3`,
    [eventId, artistId, promoterId],
  );
  return r.rows.length > 0;
}

const schema = z.object({
  artistId: z.string().uuid(),
  isHeadliner: z.boolean().default(false),
  setStartsAt: z.string().datetime().optional(),
  setDurationMinutes: z.number().int().min(1).max(600).optional(),
  stage: z.string().max(100).optional(),
  orderIndex: z.number().int().min(0).default(0),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const { id: eventId } = await params;

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
  }

  if (!(await ownsEventAndArtist(eventId, parsed.data.artistId, promoter.promoterId))) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  await db().query(
    `INSERT INTO lineups.event_artists
       (event_id, artist_id, is_headliner, set_starts_at, set_duration_minutes, stage, order_index)
     VALUES ($1, $2, $3, $4::timestamptz, $5, $6, $7)
     ON CONFLICT (event_id, artist_id) DO UPDATE SET
       is_headliner = EXCLUDED.is_headliner,
       set_starts_at = EXCLUDED.set_starts_at,
       set_duration_minutes = EXCLUDED.set_duration_minutes,
       stage = EXCLUDED.stage,
       order_index = EXCLUDED.order_index`,
    [
      eventId, parsed.data.artistId,
      parsed.data.isHeadliner,
      parsed.data.setStartsAt ?? null,
      parsed.data.setDurationMinutes ?? null,
      parsed.data.stage ?? null,
      parsed.data.orderIndex,
    ],
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const { id: eventId } = await params;
  const artistId = req.nextUrl.searchParams.get('artistId');
  if (!artistId || !/^[0-9a-f-]{36}$/i.test(artistId)) {
    return NextResponse.json({ error: 'INVALID_ARTIST_ID' }, { status: 400 });
  }

  await db().query(
    `DELETE FROM lineups.event_artists
      WHERE event_id = $1 AND artist_id = $2
        AND EXISTS (SELECT 1 FROM catalog.events
                     WHERE id = $1 AND promoter_id = $3)`,
    [eventId, artistId, promoter.promoterId],
  );

  return NextResponse.json({ ok: true });
}
