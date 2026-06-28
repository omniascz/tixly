/**
 * Publish API — sold notification delivery.
 *
 * When Tixly sells a ticket for a published (external) event, we notify
 * the source system via webhook POST to source_callback_url.
 *
 * Payload:
 * {
 *   event:         'tickets.sold'
 *   eventId:       uuid
 *   externalEventId: string   — the source system's own event ID
 *   orderId:       uuid
 *   soldAt:        ISO8601
 *   tickets: [{
 *     ticketTypeId: uuid
 *     name:         string
 *     quantity:     number
 *     unitPrice:    number
 *     currency:     string
 *   }]
 *   buyer: {
 *     email: string
 *     name:  string | null
 *   }
 * }
 *
 * Retry policy: 1 min, 5 min, 30 min (max 3 attempts). After 3 failures → status='failed'.
 */

import { db, runWithServiceContext } from '@/lib/db/rls-pool';

interface SoldNotificationPayload {
  event: 'tickets.sold';
  eventId: string;
  externalEventId: string;
  orderId: string;
  soldAt: string;
  tickets: Array<{
    ticketTypeId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    currency: string;
  }>;
  buyer: {
    email: string;
    name: string | null;
  };
}

const MAX_ATTEMPTS = 3;

export async function enqueueSoldNotification(
  eventId: string,
  orderId: string,
  sourceSystem: string,
  sourceEventId: string,
  callbackUrl: string,
  payload: Omit<SoldNotificationPayload, 'event'>,
): Promise<void> {
  const fullPayload: SoldNotificationPayload = { event: 'tickets.sold', ...payload };
  await runWithServiceContext(() =>
    db().query(
      `INSERT INTO platform.publish_sold_notifications
         (event_id, order_id, source_system, source_event_id, callback_url, payload)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [eventId, orderId, sourceSystem, sourceEventId, callbackUrl, JSON.stringify(fullPayload)],
    ),
  );
}

/** Send a single notification. Returns true on success. */
async function deliverNotification(
  id: string,
  callbackUrl: string,
  payload: object,
): Promise<boolean> {
  try {
    const res = await fetch(callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tixly-Event': 'tickets.sold',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok;
  } catch (err) {
    console.warn(`[publish-notify] delivery failed id=${id}:`, err);
    return false;
  }
}

/**
 * Process pending notifications. Called from cron route.
 * Returns counts: { sent, failed, skipped }.
 */
export async function processPendingNotifications(limit = 50): Promise<{
  sent: number;
  failed: number;
  skipped: number;
}> {
  return runWithServiceContext(async () => {
    const res = await db().query<{
      id: string;
      callback_url: string;
      payload: object;
      attempt_count: number;
    }>(
      `SELECT id, callback_url, payload, attempt_count
       FROM platform.publish_sold_notifications
       WHERE status IN ('pending', 'failed')
         AND attempt_count < $1
       ORDER BY created_at ASC
       LIMIT $2`,
      [MAX_ATTEMPTS, limit],
    );

    let sent = 0, failed = 0, skipped = 0;

    for (const row of res.rows) {
      const success = await deliverNotification(row.id, row.callback_url, row.payload);
      const newAttempt = row.attempt_count + 1;

      if (success) {
        await db().query(
          `UPDATE platform.publish_sold_notifications
           SET status = 'sent', sent_at = NOW(), attempt_count = $2
           WHERE id = $1`,
          [row.id, newAttempt],
        );
        sent++;
      } else {
        const newStatus = newAttempt >= MAX_ATTEMPTS ? 'failed' : 'pending';
        await db().query(
          `UPDATE platform.publish_sold_notifications
           SET status = $2, attempt_count = $3, last_error = $4
           WHERE id = $1`,
          [row.id, newStatus, newAttempt, 'HTTP delivery failed'],
        );
        newStatus === 'failed' ? failed++ : skipped++;
      }
    }

    return { sent, failed, skipped };
  });
}
