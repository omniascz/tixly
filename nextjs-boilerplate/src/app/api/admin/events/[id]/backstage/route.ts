import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';

const postSchema = z.object({
  videoUrl: z.string().url(),
  thumbnailUrl: z.string().url().optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  notifyMinutesBefore: z.number().int().min(1).max(1440).optional(),
});

const patchSchema = z.object({
  isActive: z.boolean(),
});

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    const owns = await db().query(
      `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
      [params.id, promoter.promoterId],
    );
    if (owns.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const r = await db().query(
      `SELECT * FROM catalog.backstage_moments WHERE event_id = $1`,
      [params.id],
    );

    return NextResponse.json({ moment: r.rows[0] ?? null });
  });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    const owns = await db().query<{ id: string }>(
      `SELECT id FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
      [params.id, promoter.promoterId],
    );
    if (owns.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    }

    const d = parsed.data;
    const r = await db().query(
      `INSERT INTO catalog.backstage_moments
         (event_id, video_url, thumbnail_url, title, description, notify_minutes_before, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, false)
       ON CONFLICT (event_id) DO UPDATE SET
         video_url = EXCLUDED.video_url,
         thumbnail_url = EXCLUDED.thumbnail_url,
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         notify_minutes_before = EXCLUDED.notify_minutes_before
       RETURNING *`,
      [
        params.id,
        d.videoUrl,
        d.thumbnailUrl ?? null,
        d.title ?? 'Zákulisí dnešního večera',
        d.description ?? null,
        d.notifyMinutesBefore ?? 10,
      ],
    );

    return NextResponse.json({ moment: r.rows[0] }, { status: 201 });
  });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    const r = await db().query(
      `DELETE FROM catalog.backstage_moments bm
        USING catalog.events e
        WHERE bm.event_id = e.id
          AND bm.event_id = $1
          AND e.promoter_id = $2
        RETURNING bm.event_id`,
      [params.id, promoter.promoterId],
    );

    if (r.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ deleted: true });
  });
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
    }

    const r = await db().query(
      `UPDATE catalog.backstage_moments bm
          SET is_active = $3
         FROM catalog.events e
        WHERE bm.event_id = e.id
          AND bm.event_id = $1
          AND e.promoter_id = $2
        RETURNING bm.*`,
      [params.id, promoter.promoterId, parsed.data.isActive],
    );

    if (r.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ moment: r.rows[0] });
  });
}
