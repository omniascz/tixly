/**
 * POST /api/webhooks/mailgun
 *
 * Receives Mailgun event webhooks and feeds them into the engagement model.
 *
 * Security:
 *  1. HMAC-SHA256 signature verification (Mailgun webhook signing key)
 *  2. Replay-attack guard: timestamp must be < 15 minutes old
 *  3. Idempotency: token deduplication via Redis (30-minute window)
 *
 * We always return HTTP 200 — Mailgun interprets non-2xx as a delivery failure
 * and will retry, which would create duplicate records.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyMailgunSignature, isTimestampFresh } from '../../../../lib/mailgun-verify';
import { recordEngagementEvent } from '../../../../services/send-time.service';
import type {
  MailgunWebhookPayload,
  EmailEngagementEvent,
  EngagementEventType,
  DbAdapter,
  RedisAdapter,
} from '../../../../types/send-time.types';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const MAILGUN_WEBHOOK_KEY = process.env.MAILGUN_WEBHOOK_KEY ?? '';
const MAX_TIMESTAMP_AGE   = 15 * 60;       // 15 minutes in seconds
const DEDUP_TTL           = 30 * 60;       // 30-minute deduplication window

// ---------------------------------------------------------------------------
// Infrastructure adapters
//
// In production these would be injected via a service-locator or DI container
// shared across the Next.js API routes.  The lazy imports below keep the
// module independently testable.
// ---------------------------------------------------------------------------

async function getAdapters(): Promise<{ db: DbAdapter; redis: RedisAdapter }> {
  const [{ createDbAdapter }, { createRedisAdapter }] = await Promise.all([
    import('../../../../../../shared/db') as Promise<{ createDbAdapter: () => DbAdapter }>,
    import('../../../../../../shared/redis') as Promise<{ createRedisAdapter: () => RedisAdapter }>,
  ]);
  return { db: createDbAdapter(), redis: createRedisAdapter() };
}

// ---------------------------------------------------------------------------
// Mailgun event → internal event type mapping
// ---------------------------------------------------------------------------

const MAILGUN_TO_EVENT: Record<string, EngagementEventType | null> = {
  delivered:    'delivered',
  opened:       'opened',
  clicked:      'clicked',
  unsubscribed: 'unsubscribed',
  complained:   'complained',
};

/** Events we record into the engagement model (positive or negative signal) */
const RECORDABLE_EVENTS = new Set<EngagementEventType>(['delivered', 'opened', 'clicked']);

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  let payload: MailgunWebhookPayload;

  // ------------------------------------------------------------------
  // 1. Parse body
  // ------------------------------------------------------------------
  try {
    payload = (await req.json()) as MailgunWebhookPayload;
  } catch {
    // Malformed JSON — log and acknowledge (never retry)
    console.error('[mailgun-webhook] Failed to parse request body');
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const { signature, 'event-data': eventData } = payload ?? {};

  if (!signature || !eventData) {
    console.error('[mailgun-webhook] Missing signature or event-data');
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // ------------------------------------------------------------------
  // 2. Signature verification
  // ------------------------------------------------------------------
  if (!MAILGUN_WEBHOOK_KEY) {
    console.error('[mailgun-webhook] MAILGUN_WEBHOOK_KEY env var is not set');
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const signatureValid = verifyMailgunSignature(
    signature.timestamp,
    signature.token,
    signature.signature,
    MAILGUN_WEBHOOK_KEY
  );

  if (!signatureValid) {
    console.warn('[mailgun-webhook] Invalid signature — rejecting event', {
      messageId: eventData.message?.headers?.['message-id'],
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // ------------------------------------------------------------------
  // 3. Timestamp freshness (replay-attack guard)
  // ------------------------------------------------------------------
  if (!isTimestampFresh(signature.timestamp, MAX_TIMESTAMP_AGE)) {
    console.warn('[mailgun-webhook] Stale timestamp — rejecting event', {
      timestamp: signature.timestamp,
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // ------------------------------------------------------------------
  // 4. Token deduplication (Redis)
  // ------------------------------------------------------------------
  let redis: RedisAdapter;
  let db:    DbAdapter;

  try {
    ({ db, redis } = await getAdapters());
  } catch (err) {
    console.error('[mailgun-webhook] Failed to initialise adapters:', err);
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const dedupKey = `mailgun-token:${signature.token}`;
  const alreadySeen = await redis.get(dedupKey);

  if (alreadySeen) {
    // Silently acknowledge duplicate
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // Mark token as seen for 30 minutes
  await redis.set(dedupKey, '1', DEDUP_TTL);

  // ------------------------------------------------------------------
  // 5. Extract user context
  // ------------------------------------------------------------------
  const userVariables = eventData['user-variables'] ?? {};
  const userId  = userVariables['X-Tixly-User-Id'] ?? null;
  const messageId = eventData.message?.headers?.['message-id'] ?? eventData.id;
  const campaignId = (eventData.campaigns?.[0]?.id ?? eventData.tags?.[0]) ?? undefined;
  const subjectLine = eventData.message?.headers?.subject ?? undefined;

  if (!userId) {
    console.warn('[mailgun-webhook] No user-id in message variables — event skipped', {
      eventType: eventData.event,
      messageId,
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // ------------------------------------------------------------------
  // 6. Map Mailgun event type
  // ------------------------------------------------------------------
  const eventType: EngagementEventType | null = MAILGUN_TO_EVENT[eventData.event] ?? null;

  if (!eventType) {
    // Unknown event type — acknowledge and ignore
    console.info('[mailgun-webhook] Unknown event type ignored:', eventData.event);
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // ------------------------------------------------------------------
  // 7. Compute time fields
  // ------------------------------------------------------------------
  const occurredAt = new Date(eventData.timestamp * 1000);
  const hourOfDay  = occurredAt.getUTCHours();
  // getUTCDay: 0=Sunday … 6=Saturday → convert to 0=Monday … 6=Sunday
  const utcDay     = occurredAt.getUTCDay();
  const dayOfWeek  = utcDay === 0 ? 6 : utcDay - 1;

  // ------------------------------------------------------------------
  // 8. Log unsubscribe / complaint (do NOT feed into the model)
  // ------------------------------------------------------------------
  if (!RECORDABLE_EVENTS.has(eventType)) {
    console.info('[mailgun-webhook] Non-engagement event logged:', {
      eventType,
      userId,
      messageId,
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // ------------------------------------------------------------------
  // 9. Record engagement event
  // ------------------------------------------------------------------
  const engagementEvent: EmailEngagementEvent = {
    userId,
    messageId,
    eventType,
    occurredAt: occurredAt.toISOString(),
    hourOfDay,
    dayOfWeek,
    campaignId,
    subjectLine,
  };

  try {
    await recordEngagementEvent(engagementEvent, db, redis);
  } catch (err) {
    console.error('[mailgun-webhook] Failed to record engagement event:', err, {
      userId,
      eventType,
      messageId,
    });
    // Return 200 anyway — we never want Mailgun to retry
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
