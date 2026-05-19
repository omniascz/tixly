/**
 * GA4 Measurement Protocol — server-side tracking.
 *
 * Endpoint: https://www.google-analytics.com/mp/collect?measurement_id={id}&api_secret={secret}
 *
 * Required: client_id (UUID per browser; máme ho z fingerprint nebo session cookie)
 * Events: purchase, add_to_cart, view_item, begin_checkout
 */

import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export interface GA4EventInput {
  measurementId: string;
  apiSecret: string;
  clientId: string;
  eventName: 'purchase' | 'add_to_cart' | 'view_item' | 'begin_checkout' | 'sign_up';
  params: {
    transaction_id?: string;
    value?: number;
    currency?: string;
    items?: {
      item_id: string;
      item_name: string;
      price: number;
      quantity: number;
      item_category?: string;
    }[];
    [key: string]: unknown;
  };
  userId?: string;
}

export async function sendGA4Event(
  input: GA4EventInput,
  context: { eventId?: string; orderId?: string },
): Promise<{ ok: boolean; error?: string }> {
  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(input.measurementId)}&api_secret=${encodeURIComponent(input.apiSecret)}`;
  const payload = {
    client_id: input.clientId,
    user_id: input.userId,
    events: [{ name: input.eventName, params: input.params }],
  };

  let logId: string | null = null;
  if (context.eventId) {
    const lr = await db().query<{ id: string }>(
      `INSERT INTO marketing.tracking_events
         (event_id, order_id, provider, event_type, payload, status)
       VALUES ($1, $2, 'ga4', $3, $4::jsonb, 'pending')
       RETURNING id`,
      [context.eventId, context.orderId ?? null, input.eventName, JSON.stringify(payload)],
    );
    logId = lr.rows[0].id;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (logId) {
      await db().query(
        `UPDATE marketing.tracking_events
         SET status = $2, sent_at = NOW(), error = $3
         WHERE id = $1`,
        [logId, res.ok ? 'sent' : 'failed', res.ok ? null : `HTTP ${res.status}`],
      );
    }
    return { ok: res.ok, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err) {
    if (logId) {
      await db().query(
        `UPDATE marketing.tracking_events SET status = 'failed', error = $2 WHERE id = $1`,
        [logId, (err as Error).message],
      );
    }
    return { ok: false, error: (err as Error).message };
  }
}
