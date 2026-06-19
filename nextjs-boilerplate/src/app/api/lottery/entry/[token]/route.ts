import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } },
): Promise<Response> {
  return runWithServiceContext(async () => {
    const r = await db().query<{
      id: string;
      status: string;
      email: string;
      name: string | null;
      payment_deadline: string | null;
      campaign_id: string;
      event_id: string;
      payment_window_hours: number;
      draw_at: string;
      event_title: string;
      event_date: string | null;
    }>(
      `SELECT le.id, le.status, le.email, le.name, le.payment_deadline,
              lc.id AS campaign_id, lc.event_id, lc.payment_window_hours, lc.draw_at,
              e.title AS event_title,
              e.date_start AS event_date
       FROM orders.lottery_entries le
       JOIN orders.lottery_campaigns lc ON lc.id = le.campaign_id
       JOIN catalog.events e ON e.id = lc.event_id
       WHERE le.entry_token = $1`,
      [params.token],
    );

    if (r.rows.length === 0) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 404 });
    }

    const entry = r.rows[0];

    return NextResponse.json({
      entry: {
        id: entry.id,
        status: entry.status,
        email: entry.email,
        paymentDeadline: entry.payment_deadline,
      },
      event: {
        id: entry.event_id,
        title: entry.event_title,
        date: entry.event_date,
      },
      campaignId: entry.campaign_id,
      campaignDrawAt: entry.draw_at,
    });
  });
}
