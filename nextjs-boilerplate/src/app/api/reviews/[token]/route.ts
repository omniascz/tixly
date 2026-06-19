import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runWithServiceContext } from '@/lib/db/rls-pool';

interface ReviewRow {
  id: string;
  rating: number | null;
  event_title: string;
  event_date: string | null;
  reviewer_name: string | null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  if (!token || token.length < 20) {
    return NextResponse.json({ error: 'INVALID_TOKEN' }, { status: 400 });
  }

  const r = await runWithServiceContext(() =>
    db().query<ReviewRow>(
      `SELECT er.id, er.rating, e.title AS event_title,
              e.starts_at::text AS event_date,
              er.reviewer_name
       FROM marketing.event_reviews er
       JOIN catalog.events e ON e.id = er.event_id
       WHERE er.review_token = $1`,
      [token],
    ),
  );

  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const row = r.rows[0];
  if (row.rating !== null) {
    return NextResponse.json({ alreadyReviewed: true });
  }

  return NextResponse.json({
    alreadyReviewed: false,
    eventTitle: row.event_title,
    eventDate: row.event_date,
    reviewerName: row.reviewer_name,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  if (!token || token.length < 20) {
    return NextResponse.json({ error: 'INVALID_TOKEN' }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { rating?: unknown; comment?: unknown };
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'INVALID_RATING' }, { status: 422 });
  }
  const comment = typeof body.comment === 'string' ? body.comment.slice(0, 2000) || null : null;

  const r = await runWithServiceContext(() =>
    db().query<{ event_title: string }>(
      `UPDATE marketing.event_reviews er
       SET rating = $1, comment = $2, updated_at = NOW()
       FROM catalog.events e
       WHERE er.event_id = e.id
         AND er.review_token = $3
         AND er.rating IS NULL
       RETURNING e.title AS event_title`,
      [rating, comment, token],
    ),
  );

  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND_OR_ALREADY_REVIEWED' }, { status: 409 });
  }

  return NextResponse.json({ ok: true, eventTitle: r.rows[0].event_title });
}
