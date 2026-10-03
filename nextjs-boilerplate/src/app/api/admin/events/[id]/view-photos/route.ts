/**
 * GET  /api/admin/events/[id]/view-photos       — list všech seat photos + bez-foto seatů
 * POST /api/admin/events/[id]/view-photos       — bulk upsert pole { eventSeatId, photoUrl, caption?, thumbnailUrl? }
 *
 * DACH P2-6 (Reservix Click&View pattern). Mock režim: URL paste (Blob upload
 * je out-of-scope pro MVP, viz /api/admin/uploads/cover-image template).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';
import type { Pool } from 'pg';
import { z } from 'zod';


const upsertSchema = z.object({
  photos: z
    .array(
      z.object({
        eventSeatId: z.string().uuid(),
        photoUrl: z.string().url().max(1024),
        thumbnailUrl: z.string().url().max(1024).optional(),
        caption: z.string().max(300).optional(),
      }),
    )
    .min(1)
    .max(500),
});

async function verifyEventOwnership(
  client: { query: Pool['query'] },
  eventId: string,
  promoterId: string,
): Promise<boolean> {
  const r = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM catalog.events
      WHERE id = $1 AND promoter_id = $2`,
    [eventId, promoterId],
  );
  return Number(r.rows[0]?.count ?? 0) > 0;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    // Kolo 3: kontext pořadatele (runAsPromoter) — RLS scopuje na jeho akce; admin eskalace odstraněna.

    if (!(await verifyEventOwnership(client, params.id, promoter.promoterId))) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'NOT_FOUND_OR_FORBIDDEN' }, { status: 404 });
    }

    const seats = await client.query<{
      id: string;
      sector: string;
      row: string;
      seat_number: string;
      photo_url: string | null;
      thumbnail_url: string | null;
      caption: string | null;
      captured_at: string | null;
    }>(
      `SELECT es.id, es.sector, es.row, es.seat_number,
              p.photo_url, p.thumbnail_url, p.caption, p.captured_at::text
         FROM catalog.event_seats es
         LEFT JOIN catalog.event_seat_view_photos p ON p.event_seat_id = es.id
        WHERE es.event_id = $1
        ORDER BY es.sector, es.row, LPAD(es.seat_number, 4, '0')
        LIMIT 2000`,
      [params.id],
    );

    await client.query('COMMIT');

    const withPhoto = seats.rows.filter((s) => s.photo_url !== null).length;
    return NextResponse.json({
      eventId: params.id,
      total: seats.rows.length,
      withPhoto,
      withoutPhoto: seats.rows.length - withPhoto,
      seats: seats.rows.map((s) => ({
        eventSeatId: s.id,
        sector: s.sector,
        row: s.row,
        seatNumber: s.seat_number,
        photoUrl: s.photo_url,
        thumbnailUrl: s.thumbnail_url,
        caption: s.caption,
        capturedAt: s.captured_at,
      })),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[GET view-photos]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_BODY', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    // Kolo 3: kontext pořadatele (runAsPromoter) — RLS scopuje na jeho akce; admin eskalace odstraněna.

    if (!(await verifyEventOwnership(client, params.id, promoter.promoterId))) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'NOT_FOUND_OR_FORBIDDEN' }, { status: 404 });
    }

    // Validate všechny event_seat_ids patří tomuto eventu
    const seatIds = parsed.data.photos.map((p) => p.eventSeatId);
    const check = await client.query<{ id: string }>(
      `SELECT id FROM catalog.event_seats
        WHERE id = ANY($1::uuid[]) AND event_id = $2`,
      [seatIds, params.id],
    );
    if (check.rows.length !== seatIds.length) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        {
          error: 'SEAT_NOT_IN_EVENT',
          message: 'Některá sedadla nepatří k tomuto eventu.',
        },
        { status: 422 },
      );
    }

    let upserted = 0;
    for (const p of parsed.data.photos) {
      await client.query(
        `INSERT INTO catalog.event_seat_view_photos
           (event_seat_id, photo_url, thumbnail_url, caption, captured_by_user_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (event_seat_id) DO UPDATE
           SET photo_url = EXCLUDED.photo_url,
               thumbnail_url = EXCLUDED.thumbnail_url,
               caption = EXCLUDED.caption,
               captured_by_user_id = EXCLUDED.captured_by_user_id,
               updated_at = NOW()`,
        [
          p.eventSeatId,
          p.photoUrl,
          p.thumbnailUrl ?? null,
          p.caption ?? null,
          promoter.userId,
        ],
      );
      upserted += 1;
    }

    await client.query('COMMIT');
    return NextResponse.json({ ok: true, upserted });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[POST view-photos]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
