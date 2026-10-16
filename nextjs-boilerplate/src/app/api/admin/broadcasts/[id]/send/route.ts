import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';

interface Recipient {
  email: string;
  name: string | null;
  userId: string | null;
}

async function resolveRecipients(
  promoterId: string,
  target: string,
  eventId: string | null,
): Promise<Recipient[]> {
  const emailMap = new Map<string, Recipient>();

  const addRows = (rows: { email: string; name: string | null; user_id: string | null }[]) => {
    for (const r of rows) {
      if (!emailMap.has(r.email)) {
        emailMap.set(r.email, { email: r.email, name: r.name, userId: r.user_id });
      }
    }
  };

  if (target === 'all' || target === 'contacts_only') {
    const r = await db().query<{ email: string; name: string | null; user_id: string | null }>(
      `SELECT pc.email, pc.name, u.id AS user_id
       FROM platform.promoter_contacts pc
       LEFT JOIN identity.users u ON u.email = pc.email
       WHERE pc.promoter_id = $1 AND pc.opted_out = false`,
      [promoterId],
    );
    addRows(r.rows);
  }

  if (target === 'all' || target === 'buyers_only') {
    const r = await db().query<{ email: string; name: string | null; user_id: string | null }>(
      `SELECT DISTINCT u.email, u.name, u.id AS user_id
       FROM orders.orders o
       JOIN identity.users u ON u.id = o.user_id
       JOIN orders.order_items oi ON oi.order_id = o.id
       JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
       JOIN catalog.events e ON e.id = tt.event_id
       WHERE e.promoter_id = $1 AND o.status = 'paid'`,
      [promoterId],
    );
    addRows(r.rows);
  }

  if (target === 'subscribers') {
    const r = await db().query<{ email: string; name: string | null; user_id: string | null }>(
      `SELECT DISTINCT ns.email, ns.name, u.id AS user_id
       FROM marketing.newsletter_subscribers ns
       LEFT JOIN identity.users u ON LOWER(u.email) = LOWER(ns.email)
       WHERE ns.promoter_id = $1 AND ns.status = 'confirmed' AND ns.unsubscribed_at IS NULL`,
      [promoterId],
    );
    addRows(r.rows);
  }

  if (target === 'event' && eventId) {
    const r = await db().query<{ email: string; name: string | null; user_id: string | null }>(
      `SELECT DISTINCT u.email, u.name, u.id AS user_id
       FROM orders.orders o
       JOIN identity.users u ON u.id = o.user_id
       JOIN orders.order_items oi ON oi.order_id = o.id
       JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
       WHERE tt.event_id = $1 AND o.status = 'paid'`,
      [eventId],
    );
    addRows(r.rows);
  }

  return Array.from(emailMap.values());
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    const bRes = await db().query<{
      id: string;
      subject: string;
      body: string;
      target: string;
      event_id: string | null;
      status: string;
    }>(
      `SELECT id, subject, body, target, event_id, status
       FROM communications.broadcasts
       WHERE id = $1 AND promoter_id = $2`,
      [params.id, promoter.promoterId],
    );
    const broadcast = bRes.rows[0];
    if (!broadcast) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    if (broadcast.status !== 'draft') {
      return NextResponse.json({ error: 'ALREADY_SENT' }, { status: 409 });
    }

    const recipients = await resolveRecipients(
      promoter.promoterId,
      broadcast.target,
      broadcast.event_id,
    );

    await db().query(
      `UPDATE communications.broadcasts
       SET status = 'sending', recipient_count = $2
       WHERE id = $1`,
      [broadcast.id, recipients.length],
    );

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const internalToken = process.env.INTERNAL_SERVICE_TOKEN ?? '';

    for (const r of recipients) {
      console.log(`[broadcast] ${broadcast.subject} → ${r.email}`);
    }

    void fetch(`${baseUrl}/api/internal/broadcast-send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-token': internalToken,
      },
      body: JSON.stringify({
        broadcastId: broadcast.id,
        subject: broadcast.subject,
        body: broadcast.body,
        recipients: recipients.map((r) => ({
          email: r.email,
          name: r.name,
          userId: r.userId ?? undefined,
        })),
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          await db().query(
            `UPDATE communications.broadcasts SET status = 'failed' WHERE id = $1`,
            [broadcast.id],
          );
        } else {
          await db().query(
            `UPDATE communications.broadcasts SET status = 'sent', sent_at = NOW() WHERE id = $1`,
            [broadcast.id],
          );
        }
      })
      .catch(async (err) => {
        console.error('[broadcasts send]', err);
        await db().query(
          `UPDATE communications.broadcasts SET status = 'failed' WHERE id = $1`,
          [broadcast.id],
        );
      });

    return NextResponse.json({ sent: recipients.length });
  });
}
