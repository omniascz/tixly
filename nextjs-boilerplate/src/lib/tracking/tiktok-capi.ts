/**
 * TikTok Events API (CAPI) — server-side tracking.
 *
 * Endpoint: https://business-api.tiktok.com/open_api/v1.3/event/track/
 * Docs: https://ads.tiktok.com/marketing_api/docs?id=1741601162187777
 *
 * Hashing: email, phone, external_id → SHA-256 lowercase trimmed.
 * Dedup: event_id matches client-side ttq.track() call_id for deduplication.
 */

import { createHash } from 'crypto';
import { db } from '@/lib/db/rls-pool';
import { randomUUID } from 'crypto';

const TIKTOK_EVENTS_API = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';

export type TikTokEventName =
  | 'Purchase'
  | 'AddToCart'
  | 'ViewContent'
  | 'InitiateCheckout'
  | 'CompleteRegistration'
  | 'Search';

export interface TikTokEventInput {
  eventName: TikTokEventName;
  pixelId: string;
  accessToken: string;
  eventId?: string;      // dedup key — match client ttq call_id
  eventTime?: number;    // unix seconds, defaults to now
  // User data (SHA-256 hashed before sending)
  email?: string;
  phone?: string;
  externalId?: string;   // Tixly userId
  ipAddress?: string;
  userAgent?: string;
  ttclid?: string;       // TikTok Click ID from URL ?ttclid=
  // Content / value
  value?: number;        // major currency units
  currency?: string;     // ISO 4217
  contentId?: string;    // ticket type ID
  contentName?: string;  // event title
  quantity?: number;
  // Attribution
  pageUrl?: string;
  // Context
  catalogEventId?: string;
  catalogOrderId?: string;
}

function sha256(s: string): string {
  return createHash('sha256').update(s.trim().toLowerCase()).digest('hex');
}

export async function sendTikTokEvent(
  input: TikTokEventInput,
): Promise<{ ok: boolean; error?: string }> {
  const eventTime = input.eventTime ?? Math.floor(Date.now() / 1000);
  const eventId = input.eventId ?? randomUUID();

  const properties: Record<string, unknown> = {};
  if (input.value !== undefined) properties.value = input.value;
  if (input.currency) properties.currency = input.currency;
  if (input.contentId) properties.content_id = input.contentId;
  if (input.contentName) properties.content_name = input.contentName;
  if (input.quantity) properties.quantity = input.quantity;

  const context: Record<string, unknown> = {};
  if (input.pageUrl) context.page = { url: input.pageUrl };
  if (input.ttclid) context.ad = { callback: input.ttclid };
  if (input.ipAddress) context.ip = input.ipAddress;
  if (input.userAgent) context.user_agent = input.userAgent;

  const userFields: Record<string, string> = {};
  if (input.email) userFields.email = sha256(input.email);
  if (input.phone) userFields.phone_number = sha256(input.phone.replace(/\D/g, ''));
  if (input.externalId) userFields.external_id = sha256(input.externalId);

  const payload = {
    pixel_code: input.pixelId,
    event: input.eventName,
    event_id: eventId,
    timestamp: new Date(eventTime * 1000).toISOString(),
    context: { ...context, user: userFields },
    properties,
    partner_name: 'Tixly',
  };

  try {
    const res = await fetch(TIKTOK_EVENTS_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Access-Token': input.accessToken,
      },
      body: JSON.stringify({ data: [payload] }),
    });

    const responseBody = await res.json().catch(() => null);
    const ok = res.ok && responseBody?.code === 0;

    // Log to tracking_events for audit
    if (input.catalogEventId) {
      void db()
        .query(
          `INSERT INTO marketing.tracking_events
             (event_name, platform, status, promoter_event_id, order_id, payload, created_at)
           VALUES ($1, 'tiktok', $2, $3, $4, $5::jsonb, NOW())`,
          [
            input.eventName,
            ok ? 'sent' : 'failed',
            input.catalogEventId,
            input.catalogOrderId ?? null,
            JSON.stringify({ eventId, pixelId: input.pixelId, response: responseBody }),
          ],
        )
        .catch(() => {});
    }

    return { ok, error: ok ? undefined : JSON.stringify(responseBody) };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
