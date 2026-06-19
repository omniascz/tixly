import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';

interface CastRow {
  id: string;
  event_id: string;
  artist_id: string | null;
  artist_name: string;
  role_name: string;
  photo_url: string | null;
  bio_short: string | null;
  is_understudy: boolean;
  is_visible: boolean;
  order_index: number;
  created_at: string;
}

async function ownsEvent(eventId: string, promoterId: string): Promise<boolean> {
  const r = await db().query(
    `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
    [eventId, promoterId],
  );
  return r.rows.length > 0;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const { id: eventId } = await params;

    if (!(await ownsEvent(eventId, promoter.promoterId))) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const r = await db().query<CastRow>(
      `SELECT id, event_id, artist_id, artist_name, role_name, photo_url, bio_short,
              is_understudy, is_visible, order_index, created_at
         FROM lineups.performance_cast
        WHERE event_id = $1
        ORDER BY order_index ASC, created_at ASC`,
      [eventId],
    );

    return NextResponse.json({ cast: r.rows });
  });
}

const postSchema = z.object({
  artistName: z.string().min(1).max(200),
  roleName: z.string().min(1).max(200),
  artistId: z.string().uuid().optional(),
  photoUrl: z.string().url().optional(),
  bioShort: z.string().max(500).optional(),
  isUnderstudy: z.boolean().default(false),
  isVisible: z.boolean().default(true),
  orderIndex: z.number().int().min(0).default(0),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const { id: eventId } = await params;

    if (!(await ownsEvent(eventId, promoter.promoterId))) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
    }
    const d = parsed.data;

    const r = await db().query<CastRow>(
      `INSERT INTO lineups.performance_cast
         (event_id, artist_id, artist_name, role_name, photo_url, bio_short,
          is_understudy, is_visible, order_index)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, event_id, artist_id, artist_name, role_name, photo_url, bio_short,
                 is_understudy, is_visible, order_index, created_at`,
      [
        eventId,
        d.artistId ?? null,
        d.artistName,
        d.roleName,
        d.photoUrl ?? null,
        d.bioShort ?? null,
        d.isUnderstudy,
        d.isVisible,
        d.orderIndex,
      ],
    );

    return NextResponse.json(r.rows[0], { status: 201 });
  });
}

const patchSchema = z.object({
  id: z.string().uuid(),
  roleName: z.string().min(1).max(200).optional(),
  isVisible: z.boolean().optional(),
  isUnderstudy: z.boolean().optional(),
  orderIndex: z.number().int().min(0).optional(),
  photoUrl: z.string().url().nullable().optional(),
  bioShort: z.string().max(500).nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const { id: eventId } = await params;

    if (!(await ownsEvent(eventId, promoter.promoterId))) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
    }
    const d = parsed.data;

    const sets: string[] = [];
    const values: unknown[] = [d.id, eventId];
    let idx = 3;

    if (d.roleName !== undefined) { sets.push(`role_name = $${idx++}`); values.push(d.roleName); }
    if (d.isVisible !== undefined) { sets.push(`is_visible = $${idx++}`); values.push(d.isVisible); }
    if (d.isUnderstudy !== undefined) { sets.push(`is_understudy = $${idx++}`); values.push(d.isUnderstudy); }
    if (d.orderIndex !== undefined) { sets.push(`order_index = $${idx++}`); values.push(d.orderIndex); }
    if (d.photoUrl !== undefined) { sets.push(`photo_url = $${idx++}`); values.push(d.photoUrl); }
    if (d.bioShort !== undefined) { sets.push(`bio_short = $${idx++}`); values.push(d.bioShort); }

    if (sets.length === 0) {
      return NextResponse.json({ error: 'NO_FIELDS' }, { status: 422 });
    }

    const r = await db().query<CastRow>(
      `UPDATE lineups.performance_cast
          SET ${sets.join(', ')}
        WHERE id = $1 AND event_id = $2
        RETURNING id, event_id, artist_id, artist_name, role_name, photo_url, bio_short,
                  is_understudy, is_visible, order_index, created_at`,
      values,
    );

    if (r.rowCount === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    return NextResponse.json(r.rows[0]);
  });
}

const deleteSchema = z.object({
  id: z.string().uuid(),
});

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const { id: eventId } = await params;

    if (!(await ownsEvent(eventId, promoter.promoterId))) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
    }

    const r = await db().query(
      `DELETE FROM lineups.performance_cast
        WHERE id = $1 AND event_id = $2
        RETURNING id`,
      [parsed.data.id, eventId],
    );

    if (r.rowCount === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  });
}
