import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';

async function countRecipients(
  promoterId: string,
  target: string,
  eventId: string | null,
): Promise<number> {
  if (target === 'all') {
    const contactEmails = new Set<string>();
    const buyerEmails = new Set<string>();
    const contactListRes = await db().query<{ email: string }>(
      `SELECT email FROM platform.promoter_contacts WHERE promoter_id = $1 AND opted_out = false`,
      [promoterId],
    );
    const buyerListRes = await db().query<{ email: string }>(
      `SELECT DISTINCT u.email
       FROM orders.orders o
       JOIN identity.users u ON u.id = o.user_id
       JOIN orders.order_items oi ON oi.order_id = o.id
       JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
       JOIN catalog.events e ON e.id = tt.event_id
       WHERE e.promoter_id = $1 AND o.status = 'paid'`,
      [promoterId],
    );
    for (const row of contactListRes.rows) contactEmails.add(row.email);
    for (const row of buyerListRes.rows) buyerEmails.add(row.email);
    const all = new Set([...contactEmails, ...buyerEmails]);
    return all.size;
  }

  if (target === 'buyers_only') {
    const r = await db().query<{ cnt: string }>(
      `SELECT COUNT(DISTINCT u.email)::text AS cnt
       FROM orders.orders o
       JOIN identity.users u ON u.id = o.user_id
       JOIN orders.order_items oi ON oi.order_id = o.id
       JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
       JOIN catalog.events e ON e.id = tt.event_id
       WHERE e.promoter_id = $1 AND o.status = 'paid'`,
      [promoterId],
    );
    return Number(r.rows[0]?.cnt ?? 0);
  }

  if (target === 'contacts_only') {
    const r = await db().query<{ cnt: string }>(
      `SELECT COUNT(DISTINCT email)::text AS cnt
       FROM platform.promoter_contacts
       WHERE promoter_id = $1 AND opted_out = false`,
      [promoterId],
    );
    return Number(r.rows[0]?.cnt ?? 0);
  }

  if (target === 'subscribers') {
    const r = await db().query<{ cnt: string }>(
      `SELECT COUNT(DISTINCT email)::text AS cnt
       FROM marketing.newsletter_subscribers
       WHERE promoter_id = $1 AND status = 'confirmed' AND unsubscribed_at IS NULL`,
      [promoterId],
    );
    return Number(r.rows[0]?.cnt ?? 0);
  }

  if (target === 'event' && eventId) {
    const r = await db().query<{ cnt: string }>(
      `SELECT COUNT(DISTINCT u.email)::text AS cnt
       FROM orders.orders o
       JOIN identity.users u ON u.id = o.user_id
       JOIN orders.order_items oi ON oi.order_id = o.id
       JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
       WHERE tt.event_id = $1 AND o.status = 'paid'`,
      [eventId],
    );
    return Number(r.rows[0]?.cnt ?? 0);
  }

  return 0;
}

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    const bRes = await db().query<{
      target: string;
      event_id: string | null;
    }>(
      `SELECT target, event_id FROM communications.broadcasts WHERE id = $1 AND promoter_id = $2`,
      [params.id, promoter.promoterId],
    );
    const broadcast = bRes.rows[0];
    if (!broadcast) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const recipientCount = await countRecipients(
      promoter.promoterId,
      broadcast.target,
      broadcast.event_id,
    );

    return NextResponse.json({ recipientCount });
  });
}
