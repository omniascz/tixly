import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';

interface OrderRow {
  order_id: string;
  buyer_email: string;
  buyer_name: string | null;
  event_title: string;
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const body = (await req.json().catch(() => ({}))) as { eventId?: unknown };
    const eventId = typeof body.eventId === 'string' ? body.eventId : null;
    if (!eventId || !/^[0-9a-f-]{36}$/i.test(eventId)) {
      return NextResponse.json({ error: 'INVALID_EVENT_ID' }, { status: 422 });
    }

    const owned = await db().query<{ id: string }>(
      `SELECT id FROM catalog.events
       WHERE id = $1 AND promoter_id = $2`,
      [eventId, promoter.promoterId],
    );
    if (owned.rows.length === 0) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    const orders = await db().query<OrderRow>(
      `SELECT o.id AS order_id,
              u.email AS buyer_email,
              u.name  AS buyer_name,
              e.title AS event_title
       FROM orders.orders o
       JOIN identity.users u ON u.id = o.user_id
       JOIN catalog.events e ON e.id = o.event_id
       WHERE o.event_id = $1
         AND o.status IN ('paid', 'paid_partial')
         AND e.starts_at < NOW() - INTERVAL '20 hours'
         AND NOT EXISTS (
           SELECT 1 FROM marketing.event_reviews er
           WHERE er.order_id = o.id
         )`,
      [eventId],
    );

    if (orders.rows.length === 0) {
      return NextResponse.json({ sent: 0 });
    }

    const emails = orders.rows.map((r) => r.buyer_email);
    console.log(`Odesílám hodnocení na ${emails.length} emailů: ${emails.join(', ')}`);

    let sent = 0;
    for (const row of orders.rows) {
      await runWithServiceContext(() =>
        db().query(
          `INSERT INTO marketing.event_reviews
             (event_id, order_id, reviewer_email, reviewer_name)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (event_id, order_id) DO NOTHING`,
          [eventId, row.order_id, row.buyer_email, row.buyer_name ?? null],
        ),
      );
      sent++;
    }

    return NextResponse.json({ sent });
  });
}
