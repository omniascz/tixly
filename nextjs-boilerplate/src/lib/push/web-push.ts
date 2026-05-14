/**
 * Web Push helper — graceful integration.
 *
 * Pro reálné posílání push zpráv je třeba:
 *   1. `npm install web-push` (knihovna pro VAPID + Aes128Gcm payload encryption)
 *   2. Vygenerovat VAPID key pair: `npx web-push generate-vapid-keys`
 *   3. Nastavit env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...)
 *   4. Klient registruje service worker `/sw.js` a získá PushSubscription
 *   5. POST do /api/buyer/push/subscribe → uloží subscription
 *   6. Server volá sendPush() pro broadcast
 *
 * Tento helper funguje i bez web-push npm package — vrátí mock=true a loguje.
 * V produkci import web-push package při startu app.
 *
 * Web Push spec: RFC 8030 (HTTP Push), RFC 8291 (Encrypted Payload), RFC 8292 (VAPID).
 */

import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dhKey: string;
  authKey: string;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Akce: URL kam po kliku přesměrovat. Service worker použije focus/openWindow. */
  url?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, unknown>;
}

export interface PushResult {
  ok: boolean;
  mock?: boolean;
  statusCode?: number;
  reason?: string;
}

interface WebPushLib {
  setVapidDetails: (subject: string, publicKey: string, privateKey: string) => void;
  sendNotification: (
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options?: { TTL?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high' },
  ) => Promise<{ statusCode: number; body: string }>;
}

let webPushModule: WebPushLib | null | undefined = undefined;

async function getWebPush(): Promise<WebPushLib | null> {
  if (webPushModule !== undefined) return webPushModule;
  try {
    // Dynamic import — pokud package není installed, vrátíme null a fallback na mock.
    const mod = (await import('web-push' as string)) as unknown as
      | WebPushLib
      | { default: WebPushLib };
    webPushModule = 'sendNotification' in mod ? mod : mod.default;
    const subject = process.env.VAPID_SUBJECT;
    const pub = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    if (subject && pub && priv) {
      webPushModule.setVapidDetails(subject, pub, priv);
    }
    return webPushModule;
  } catch {
    webPushModule = null;
    return null;
  }
}

/**
 * Pošle push zprávu na jednu subscription. Pokud web-push package chybí
 * NEBO VAPID keys nejsou nastaveny, vrátí { ok: true, mock: true } a loguje.
 */
export async function sendPush(
  subscription: PushSubscriptionRow,
  payload: PushPayload,
): Promise<PushResult> {
  const lib = await getWebPush();
  const subject = process.env.VAPID_SUBJECT;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;

  if (!lib || !subject || !pub || !priv) {
    if (process.env.NODE_ENV !== 'test') {
      console.log(`[push:mock] → ${subscription.endpoint.slice(0, 60)}…`, payload.title);
    }
    return { ok: true, mock: true };
  }

  try {
    const res = await lib.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dhKey, auth: subscription.authKey },
      },
      JSON.stringify(payload),
      { TTL: 86400, urgency: 'normal' },
    );
    await db().query(
      `UPDATE notifications.push_subscriptions
       SET last_used_at = NOW(), failure_count = 0, updated_at = NOW()
       WHERE id = $1`,
      [subscription.id],
    );
    return { ok: true, statusCode: res.statusCode };
  } catch (err) {
    const e = err as { statusCode?: number; message?: string };
    const isGone = e.statusCode === 404 || e.statusCode === 410;
    await db().query(
      `UPDATE notifications.push_subscriptions
       SET failure_count = failure_count + 1, updated_at = NOW()
       WHERE id = $1`,
      [subscription.id],
    );
    if (isGone) {
      // Subscription expirovala — smaž ji aby neblokovala další pokusy.
      await db().query(
        `DELETE FROM notifications.push_subscriptions WHERE id = $1`,
        [subscription.id],
      );
    }
    return {
      ok: false,
      statusCode: e.statusCode,
      reason: e.message ?? 'unknown',
    };
  }
}

/**
 * Broadcast push všem aktivním subscriptions daného uživatele.
 * Vrací počet úspěšných doručení.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; failed: number; mock: number }> {
  const r = await db().query<{
    id: string;
    endpoint: string;
    p256dh_key: string;
    auth_key: string;
  }>(
    `SELECT id, endpoint, p256dh_key, auth_key
     FROM notifications.push_subscriptions
     WHERE user_id = $1 AND failure_count < 3`,
    [userId],
  );

  let sent = 0;
  let failed = 0;
  let mock = 0;
  for (const sub of r.rows) {
    const result = await sendPush(
      {
        id: sub.id,
        endpoint: sub.endpoint,
        p256dhKey: sub.p256dh_key,
        authKey: sub.auth_key,
      },
      payload,
    );
    if (result.mock) mock += 1;
    else if (result.ok) sent += 1;
    else failed += 1;
  }
  return { sent, failed, mock };
}
