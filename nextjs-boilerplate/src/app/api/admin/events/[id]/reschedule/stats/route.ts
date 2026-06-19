import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';

interface StatsRow {
  total: string;
  accepted: string;
  refunds: string;
  pending: string;
}

interface ResponseDetailRow {
  id: string;
  order_id: string;
  user_id: string;
  email: string;
  name: string | null;
  response: string | null;
  responded_at: string | null;
  created_at: string;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const { id: eventId } = await params;

    const owns = await db().query(
      `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
      [eventId, promoter.promoterId],
    );
    if (owns.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const latestResult = await db().query<{ id: string }>(
      `SELECT id FROM catalog.event_reschedules
       WHERE original_event_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [eventId],
    );

    if (latestResult.rows.length === 0) {
      return NextResponse.json({ error: 'NO_RESCHEDULE' }, { status: 404 });
    }

    const rescheduleId = latestResult.rows[0].id;

    const statsResult = await db().query<StatsRow>(
      `SELECT
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE response = 'accepted')::text AS accepted,
         COUNT(*) FILTER (WHERE response = 'refund_requested')::text AS refunds,
         COUNT(*) FILTER (WHERE response IS NULL)::text AS pending
       FROM orders.reschedule_responses
       WHERE reschedule_id = $1`,
      [rescheduleId],
    );

    const detailsResult = await db().query<ResponseDetailRow>(
      `SELECT rr.id, rr.order_id, rr.user_id, u.email, u.name,
              rr.response, rr.responded_at::text, rr.created_at::text
       FROM orders.reschedule_responses rr
       JOIN identity.users u ON u.id = rr.user_id
       WHERE rr.reschedule_id = $1
       ORDER BY rr.created_at DESC`,
      [rescheduleId],
    );

    const stats = statsResult.rows[0];

    return NextResponse.json({
      rescheduleId,
      stats: {
        total: Number(stats.total),
        accepted: Number(stats.accepted),
        refunds: Number(stats.refunds),
        pending: Number(stats.pending),
      },
      responses: detailsResult.rows,
    });
  });
}
