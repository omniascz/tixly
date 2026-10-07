/**
 * GET /api/events/[id]/reviews
 *
 * Public list všech reviews + aggregate stats.
 * Query: ?sort=newest|helpful|top, ?limit=20
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';


export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ error: 'BAD_EVENT' }, { status: 422 });
  }
  const sort = req.nextUrl.searchParams.get('sort') ?? 'newest';
  const limit = Math.min(50, Math.max(5, Number(req.nextUrl.searchParams.get('limit') ?? '20')));

  let orderBy = 'r.created_at DESC';
  if (sort === 'helpful') orderBy = 'r.helpful_count DESC, r.created_at DESC';
  else if (sort === 'top') orderBy = 'r.rating DESC, r.helpful_count DESC';

  const stats = await db().query<{
    avg_rating: string | null;
    count: string;
    one: string;
    two: string;
    three: string;
    four: string;
    five: string;
    verified: string;
  }>(
    `SELECT
       AVG(rating)::text AS avg_rating,
       COUNT(*)::text AS count,
       COUNT(*) FILTER (WHERE rating = 1)::text AS one,
       COUNT(*) FILTER (WHERE rating = 2)::text AS two,
       COUNT(*) FILTER (WHERE rating = 3)::text AS three,
       COUNT(*) FILTER (WHERE rating = 4)::text AS four,
       COUNT(*) FILTER (WHERE rating = 5)::text AS five,
       COUNT(*) FILTER (WHERE is_verified = TRUE)::text AS verified
     FROM marketing.event_reviews
     WHERE event_id = $1 AND is_public = TRUE AND hidden_by_admin = FALSE`,
    [params.id],
  );

  const reviews = await db().query(
    `SELECT r.id, r.rating, r.title, r.body, r.is_verified, r.helpful_count,
            r.promoter_reply, r.promoter_reply_at, r.created_at,
            u.name AS user_name
     FROM marketing.event_reviews r
     JOIN identity.users u ON u.id = r.user_id
     WHERE r.event_id = $1 AND r.is_public = TRUE AND r.hidden_by_admin = FALSE
     ORDER BY ${orderBy}
     LIMIT $2`,
    [params.id, limit],
  );

  const s = stats.rows[0];
  return NextResponse.json({
    stats: {
      avgRating: s.avg_rating ? Math.round(Number(s.avg_rating) * 10) / 10 : null,
      count: Number(s.count),
      verified: Number(s.verified),
      distribution: {
        1: Number(s.one),
        2: Number(s.two),
        3: Number(s.three),
        4: Number(s.four),
        5: Number(s.five),
      },
    },
    reviews: reviews.rows,
  });
}
