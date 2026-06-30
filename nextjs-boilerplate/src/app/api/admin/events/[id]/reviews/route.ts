import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';

async function ownsEvent(eventId: string, promoterId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return false;
  const r = await db().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
    [eventId, promoterId],
  );
  return Number(r.rows[0]?.count ?? 0) > 0;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const { id: eventId } = await params;
    if (!(await ownsEvent(eventId, promoter.promoterId))) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    const rows = await db().query<{
      id: string;
      rating: number;
      comment: string | null;
      reviewer_name: string | null;
      is_public: boolean;
      created_at: string;
    }>(
      `SELECT id, rating, body AS comment, NULL::text AS reviewer_name, is_public, created_at
       FROM marketing.event_reviews
       WHERE event_id = $1 AND rating IS NOT NULL
       ORDER BY created_at DESC`,
      [eventId],
    );

    const stats = await db().query<{
      avg_rating: string | null;
      total: string;
      d1: string;
      d2: string;
      d3: string;
      d4: string;
      d5: string;
    }>(
      `SELECT
         AVG(rating)::text AS avg_rating,
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE rating = 1)::text AS d1,
         COUNT(*) FILTER (WHERE rating = 2)::text AS d2,
         COUNT(*) FILTER (WHERE rating = 3)::text AS d3,
         COUNT(*) FILTER (WHERE rating = 4)::text AS d4,
         COUNT(*) FILTER (WHERE rating = 5)::text AS d5
       FROM marketing.event_reviews
       WHERE event_id = $1 AND rating IS NOT NULL`,
      [eventId],
    );

    const s = stats.rows[0];
    return NextResponse.json({
      reviews: rows.rows,
      stats: {
        avg: s.avg_rating ? Math.round(Number(s.avg_rating) * 10) / 10 : null,
        count: Number(s.total),
        distribution: {
          1: Number(s.d1),
          2: Number(s.d2),
          3: Number(s.d3),
          4: Number(s.d4),
          5: Number(s.d5),
        },
      },
    });
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const { id: eventId } = await params;
    if (!(await ownsEvent(eventId, promoter.promoterId))) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as { reviewId?: unknown; isPublic?: unknown };
    if (typeof body.reviewId !== 'string' || typeof body.isPublic !== 'boolean') {
      return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
    }

    const r = await db().query<{ id: string }>(
      `UPDATE marketing.event_reviews
       SET is_public = $1, updated_at = NOW()
       WHERE id = $2 AND event_id = $3
       RETURNING id`,
      [body.isPublic, body.reviewId, eventId],
    );

    if (r.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  });
}
