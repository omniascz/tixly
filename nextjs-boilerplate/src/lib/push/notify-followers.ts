/**
 * notifyFollowers — pošle push notifikaci všem followerům promotéra
 * když promotér publikuje nový event.
 *
 * Follower = řádek v marketing.newsletter_subscribers s confirmed_at != null
 * a s odpovídajícím identity.users entry (jen registrované buyery, ne anonymní).
 *
 * Fire-and-forget. Volá `sendPushToUser` pro každého followera. Nemá UI return,
 * jen vrací summary pro logging.
 */
import { sendPushToUser } from './web-push';
import { db } from '@/lib/db/rls-pool';


interface NotifyParams {
  promoterId: string;
  eventId: string;
  eventTitle: string;
}

export async function notifyFollowers(params: NotifyParams): Promise<{
  followers: number;
  sent: number;
  failed: number;
  mock: number;
}> {
  const r = await db().query<{
    user_id: string;
    promoter_name: string;
  }>(
    `SELECT u.id AS user_id, p.name AS promoter_name
       FROM marketing.newsletter_subscribers ns
       JOIN platform.promoters p ON p.id = ns.promoter_id
       JOIN identity.users u ON LOWER(u.email) = LOWER(ns.email)
      WHERE ns.promoter_id = $1
        AND ns.status = 'confirmed'
        AND ns.confirmed_at IS NOT NULL`,
    [params.promoterId],
  );

  let totalSent = 0;
  let totalFailed = 0;
  let totalMock = 0;
  const promoterName = r.rows[0]?.promoter_name ?? 'Promotér';

  for (const row of r.rows) {
    const out = await sendPushToUser(row.user_id, {
      title: `${promoterName}: nová akce`,
      body: params.eventTitle,
      url: `/cs/events/${params.eventId}`,
      tag: `event-${params.eventId}`,
      data: { eventId: params.eventId, promoterId: params.promoterId },
    });
    totalSent += out.sent;
    totalFailed += out.failed;
    totalMock += out.mock;
  }

  return {
    followers: r.rows.length,
    sent: totalSent,
    failed: totalFailed,
    mock: totalMock,
  };
}
