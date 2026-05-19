/**
 * Meta Conversions API (CAPI) — server-side tracking.
 *
 * Endpoint: https://graph.facebook.com/v18.0/{pixel_id}/events?access_token={token}
 *
 * Hashing: pro user data (email, phone) MUSÍ být SHA-256 lowercase trimmed.
 * Action source: 'website' (alternativy: app, email, chat, phone_call, physical_store, system_generated, other).
 */

import { createHash } from 'crypto';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const META_API_VERSION = 'v18.0';

export interface MetaEventInput {
  eventName: 'Purchase' | 'AddToCart' | 'ViewContent' | 'InitiateCheckout' | 'Lead' | 'CompleteRegistration';
  eventTime: number; // unix timestamp seconds
  eventId: string; // dedup key
  pixelId: string;
  capiToken: string;
  // User data (will be SHA-256 hashed)
  email?: string;
  phone?: string;
  ipAddress?: string;
  userAgent?: string;
  fbp?: string; // _fbp cookie
  fbc?: string; // _fbc cookie
  // Custom data
  value?: number; // major units
  currency?: string;
  contentIds?: string[]; // ticket type IDs
  contentName?: string;
  contentType?: 'product' | 'product_group';
  numItems?: number;
  // Source
  sourceUrl: string;
}

function sha256Lower(s: string): string {
  return createHash('sha256').update(s.trim().toLowerCase()).digest('hex');
}

export async function sendMetaEvent(
  input: MetaEventInput,
  context: { eventId?: string; orderId?: string },
): Promise<{ ok: boolean; response?: unknown; error?: string }> {
  const userData: Record<string, unknown> = {};
  if (input.email) userData.em = [sha256Lower(input.email)];
  if (input.phone) userData.ph = [sha256Lower(input.phone.replace(/\D/g, ''))];
  if (input.ipAddress) userData.client_ip_address = input.ipAddress;
  if (input.userAgent) userData.client_user_agent = input.userAgent;
  if (input.fbp) userData.fbp = input.fbp;
  if (input.fbc) userData.fbc = input.fbc;

  const customData: Record<string, unknown> = {};
  if (input.value !== undefined) customData.value = input.value;
  if (input.currency) customData.currency = input.currency;
  if (input.contentIds) customData.content_ids = input.contentIds;
  if (input.contentName) customData.content_name = input.contentName;
  if (input.contentType) customData.content_type = input.contentType;
  if (input.numItems !== undefined) customData.num_items = input.numItems;

  const payload = {
    data: [
      {
        event_name: input.eventName,
        event_time: input.eventTime,
        event_id: input.eventId,
        event_source_url: input.sourceUrl,
        action_source: 'website',
        user_data: userData,
        custom_data: customData,
      },
    ],
  };

  // Log pending
  let logId: string | null = null;
  if (context.eventId) {
    const lr = await db().query<{ id: string }>(
      `INSERT INTO marketing.tracking_events
         (event_id, order_id, provider, event_type, payload, status)
       VALUES ($1, $2, 'meta_capi', $3, $4::jsonb, 'pending')
       RETURNING id`,
      [context.eventId, context.orderId ?? null, input.eventName, JSON.stringify(payload)],
    );
    logId = lr.rows[0].id;
  }

  try {
    const url = `https://graph.facebook.com/${META_API_VERSION}/${input.pixelId}/events?access_token=${encodeURIComponent(input.capiToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body: unknown = await res.json().catch(() => ({}));
    if (logId) {
      await db().query(
        `UPDATE marketing.tracking_events
         SET status = $2, response_body = $3::jsonb, sent_at = NOW(),
             error = $4
         WHERE id = $1`,
        [logId, res.ok ? 'sent' : 'failed', JSON.stringify(body), res.ok ? null : `HTTP ${res.status}`],
      );
    }
    return { ok: res.ok, response: body, error: res.ok ? undefined : `HTTP ${res.status}` };
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
