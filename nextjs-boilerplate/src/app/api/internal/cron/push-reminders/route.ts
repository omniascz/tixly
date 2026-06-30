/**
 * POST /api/internal/cron/push-reminders
 *
 * Sends web push notifications for:
 *  1. PRE-EVENT 24h — "Zítra máte akci 🎟" (day-before reminder)
 *  2. PRE-EVENT 4h  — "Za 4 hodiny začíná …" (day-of reminder with venue info)
 *  3. ON-SALE ALERT — when ticket_types.sale_start fires (waitlist users)
 *  4. ABANDONED CART — pending orders older than 60 min (payment started, not completed)
 *
 * Only sends if identity.notification_preferences.pre_event_reminders = true.
 * Cron schedule: every 15 min ("*\/15 * * * *")
 * Auth: x-internal-token
 */

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { sendPushToUser, type PushPayload } from '@/lib/push/web-push';

export const dynamic = 'force-dynamic';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

interface EventReminderRow {
  user_id:     string;
  event_title: string;
  venue_name:  string | null;
  date_start:  string;
  event_id:    string;
  slug:        string;
}

interface OnsaleRow {
  user_id:     string;
  event_title: string;
  slug:        string;
  tt_name:     string;
  price:       string;
  currency:    string;
}

interface AbandonedRow {
  user_id:  string;
  order_id: string;
  event_title: string;
  slug:        string;
}

export async function POST(req: NextRequest): Promise<Response> {
  const token    = req.headers.get('x-internal-token') ?? '';
  const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  if (!expected || !safeEqual(token, expected)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.tixly.cz';

  let sent24h = 0;
  let sent4h  = 0;
  let sentOnsale = 0;
  let sentCart = 0;

  await runWithServiceContext(async () => {
    // ── 1. 24h reminder ───────────────────────────────────────────────────────
    const remind24 = await db().query<EventReminderRow>(
      `SELECT DISTINCT o.user_id, pr.title AS event_title,
              v.name AS venue_name, e.date_start, e.id AS event_id, e.slug
       FROM orders.orders o
       JOIN orders.order_items oi ON oi.order_id = o.id
       JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
       JOIN catalog.events e ON e.id = tt.event_id
       JOIN catalog.productions pr ON pr.id = e.production_id
       LEFT JOIN catalog.venues v ON v.id = e.venue_id
       JOIN identity.notification_preferences np ON np.user_id = o.user_id
       WHERE o.status = 'paid'
         AND np.pre_event_reminders = TRUE
         AND np.push_enabled = TRUE
         AND e.date_start BETWEEN NOW() + INTERVAL '23 hours' AND NOW() + INTERVAL '25 hours'
         AND NOT EXISTS (
           SELECT 1 FROM notifications.push_sent_log psl
           WHERE psl.user_id = o.user_id
             AND psl.event_id = e.id
             AND psl.notification_type = 'reminder_24h'
         )`,
    );

    for (const row of remind24.rows) {
      const payload: PushPayload = {
        title: `Zítra: ${row.event_title}`,
        body:  row.venue_name
          ? `Těšíme se na vás v ${row.venue_name}!`
          : 'Nezapomeňte na svou vstupenku!',
        url:   `${appUrl}/cs/moje-vstupenky`,
        tag:   `event-24h-${row.event_id}`,
      };
      const r = await sendPushToUser(row.user_id, payload);
      if (r.sent > 0 || r.mock > 0) {
        sent24h++;
        await db().query(
          `INSERT INTO notifications.push_sent_log (user_id, event_id, notification_type)
           VALUES ($1, $2, 'reminder_24h') ON CONFLICT DO NOTHING`,
          [row.user_id, row.event_id],
        );
      }
    }

    // ── 2. 4h reminder ────────────────────────────────────────────────────────
    const remind4h = await db().query<EventReminderRow>(
      `SELECT DISTINCT o.user_id, pr.title AS event_title,
              v.name AS venue_name, e.date_start, e.id AS event_id, e.slug
       FROM orders.orders o
       JOIN orders.order_items oi ON oi.order_id = o.id
       JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
       JOIN catalog.events e ON e.id = tt.event_id
       JOIN catalog.productions pr ON pr.id = e.production_id
       LEFT JOIN catalog.venues v ON v.id = e.venue_id
       JOIN identity.notification_preferences np ON np.user_id = o.user_id
       WHERE o.status = 'paid'
         AND np.pre_event_reminders = TRUE
         AND np.push_enabled = TRUE
         AND e.date_start BETWEEN NOW() + INTERVAL '3.5 hours' AND NOW() + INTERVAL '4.5 hours'
         AND NOT EXISTS (
           SELECT 1 FROM notifications.push_sent_log psl
           WHERE psl.user_id = o.user_id
             AND psl.event_id = e.id
             AND psl.notification_type = 'reminder_4h'
         )`,
    );

    for (const row of remind4h.rows) {
      const dateStr = new Date(row.date_start).toLocaleTimeString('cs-CZ', {
        hour: '2-digit', minute: '2-digit',
      });
      const payload: PushPayload = {
        title: `Za 4 hodiny: ${row.event_title}`,
        body:  row.venue_name
          ? `Začátek v ${dateStr} | ${row.venue_name}`
          : `Začátek v ${dateStr}`,
        url:   `${appUrl}/cs/moje-vstupenky`,
        tag:   `event-4h-${row.event_id}`,
        data:  { eventId: row.event_id },
      };
      const r = await sendPushToUser(row.user_id, payload);
      if (r.sent > 0 || r.mock > 0) {
        sent4h++;
        await db().query(
          `INSERT INTO notifications.push_sent_log (user_id, event_id, notification_type)
           VALUES ($1, $2, 'reminder_4h') ON CONFLICT DO NOTHING`,
          [row.user_id, row.event_id],
        );
      }
    }

    // ── 3. Onsale alerts (waitlist users) ────────────────────────────────────
    const onsale = await db().query<OnsaleRow>(
      `SELECT DISTINCT wl.user_id, pr.title AS event_title, e.slug,
              tt.name AS tt_name,
              tt.base_price::text AS price,
              COALESCE(e.currency, 'CZK') AS currency
       FROM catalog.ticket_types tt
       JOIN catalog.events e ON e.id = tt.event_id
       JOIN catalog.productions pr ON pr.id = e.production_id
       JOIN orders.waiting_list wl ON wl.event_id = e.id
       JOIN identity.notification_preferences np ON np.user_id = wl.user_id
       WHERE e.sale_start_at BETWEEN NOW() - INTERVAL '15 minutes' AND NOW()
         AND np.push_enabled = TRUE
         AND np.pre_event_reminders = TRUE
         AND NOT EXISTS (
           SELECT 1 FROM notifications.push_sent_log psl
           WHERE psl.user_id = wl.user_id
             AND psl.event_id = e.id
             AND psl.notification_type = 'onsale_alert'
         )`,
    );

    for (const row of onsale.rows) {
      const priceFormatted = row.currency === 'EUR'
        ? `${(parseInt(row.price) / 100).toFixed(0)} €`
        : `${(parseInt(row.price) / 100).toFixed(0)} Kč`;
      const payload: PushPayload = {
        title: `Vstupenky v prodeji: ${row.event_title}`,
        body:  `${row.tt_name} od ${priceFormatted} — kupte hned!`,
        url:   `${appUrl}/cs/akce/${row.slug}`,
        tag:   `onsale-${row.slug}`,
      };
      const r = await sendPushToUser(row.user_id, payload);
      if (r.sent > 0 || r.mock > 0) {
        sentOnsale++;
        await db().query(
          `INSERT INTO notifications.push_sent_log (user_id, event_id, notification_type)
           SELECT $1, e.id, 'onsale_alert' FROM catalog.events e WHERE e.slug = $2
           ON CONFLICT DO NOTHING`,
          [row.user_id, row.slug],
        );
      }
    }

    // ── 3b. Onsale alerts for artist followers ────────────────────────────────
    const onsaleFollow = await db().query<OnsaleRow>(
      `SELECT DISTINCT af.user_id, pr.title AS event_title, e.slug,
              tt.name AS tt_name,
              tt.base_price::text AS price,
              COALESCE(e.currency, 'CZK') AS currency
       FROM catalog.ticket_types tt
       JOIN catalog.events e ON e.id = tt.event_id
       JOIN catalog.productions pr ON pr.id = e.production_id
       JOIN lineups.event_artists ea ON ea.event_id = e.id
       JOIN lineups.artist_follows af ON af.artist_id = ea.artist_id
       JOIN identity.notification_preferences np ON np.user_id = af.user_id
       WHERE e.sale_start_at BETWEEN NOW() - INTERVAL '15 minutes' AND NOW()
         AND np.push_enabled = TRUE
         AND np.pre_event_reminders = TRUE
         AND NOT EXISTS (
           SELECT 1 FROM notifications.push_sent_log psl
           WHERE psl.user_id = af.user_id
             AND psl.event_id = e.id
             AND psl.notification_type = 'onsale_alert'
         )`,
    );

    for (const row of onsaleFollow.rows) {
      const priceFormatted = row.currency === 'EUR'
        ? `${(parseInt(row.price) / 100).toFixed(0)} €`
        : `${(parseInt(row.price) / 100).toFixed(0)} Kč`;
      const payload: PushPayload = {
        title: `🎵 Vstupenky v prodeji: ${row.event_title}`,
        body:  `${row.tt_name} od ${priceFormatted} — jako follower máte přednostní info!`,
        url:   `${appUrl}/cs/akce/${row.slug}`,
        tag:   `onsale-follow-${row.slug}`,
      };
      const r = await sendPushToUser(row.user_id, payload);
      if (r.sent > 0 || r.mock > 0) {
        sentOnsale++;
        await db().query(
          `INSERT INTO notifications.push_sent_log (user_id, event_id, notification_type)
           SELECT $1, e.id, 'onsale_alert' FROM catalog.events e WHERE e.slug = $2
           ON CONFLICT DO NOTHING`,
          [row.user_id, row.slug],
        );
      }
    }

    // ── 4. Abandoned cart ────────────────────────────────────────────────────
    const abandoned = await db().query<AbandonedRow>(
      `SELECT o.user_id, o.id AS order_id,
              pr.title AS event_title, e.slug
       FROM orders.orders o
       JOIN orders.order_items oi ON oi.order_id = o.id
       JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
       JOIN catalog.events e ON e.id = tt.event_id
       JOIN catalog.productions pr ON pr.id = e.production_id
       JOIN identity.notification_preferences np ON np.user_id = o.user_id
       WHERE o.status = 'pending'
         AND o.created_at BETWEEN NOW() - INTERVAL '90 minutes' AND NOW() - INTERVAL '60 minutes'
         AND np.push_enabled = TRUE
         AND np.abandoned_cart = TRUE
         AND NOT EXISTS (
           SELECT 1 FROM notifications.push_sent_log psl
           WHERE psl.user_id = o.user_id
             AND psl.order_id = o.id
             AND psl.notification_type = 'abandoned_cart'
         )
       LIMIT 100`,
    );

    for (const row of abandoned.rows) {
      const payload: PushPayload = {
        title: 'Nedokončená objednávka',
        body:  `Máte v košíku vstupenky na ${row.event_title}. Dokončete platbu!`,
        url:   `${appUrl}/cs/kosik`,
        tag:   `cart-${row.order_id}`,
      };
      const r = await sendPushToUser(row.user_id, payload);
      if (r.sent > 0 || r.mock > 0) {
        sentCart++;
        await db().query(
          `INSERT INTO notifications.push_sent_log (user_id, event_id, order_id, notification_type)
           SELECT $1, e.id, $3, 'abandoned_cart'
           FROM catalog.events e
           WHERE e.slug = $2
           ON CONFLICT DO NOTHING`,
          [row.user_id, row.slug, row.order_id],
        );
      }
    }
  });

  return NextResponse.json({
    ok: true,
    sent: { reminder24h: sent24h, reminder4h: sent4h, onsale: sentOnsale, abandonedCart: sentCart },
  });
}
