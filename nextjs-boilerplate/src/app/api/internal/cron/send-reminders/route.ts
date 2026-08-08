/**
 * POST /api/internal/cron/send-reminders
 *
 * Najde event_reminders s status='pending' a scheduled_at <= NOW(), pošle email,
 * mark jako sent. Failed reminders → retry up to 3x.
 * Email se posílá v jazyce kupce (identity.users.locale: cs/sk/en).
 */

import { timingSafeEqual } from 'crypto';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { NextRequest, NextResponse } from 'next/server';
import { escapeHtml } from '@/lib/html-escape/escape';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

type ReminderLocale = 'cs' | 'sk' | 'en';

const STRINGS: Record<ReminderLocale, {
  subjects: Record<string, (e: string) => string>;
  headlines: Record<string, string>;
  greeting: (name: string | null) => string;
  eventLine: (event: string, type: string) => string;
  ctaLabel: string;
  walletTip: string;
}> = {
  cs: {
    subjects: {
      week_before: (e) => `📅 ${e} — týden do akce`,
      day_before:  (e) => `🎉 ${e} — zítra!`,
      hour_before: (e) => `🚀 ${e} — za hodinu začínáme`,
    },
    headlines: { week_before: 'Týden do akce!', day_before: 'Zítra to vypukne 🎉', hour_before: 'Vyrážíme! 🚀' },
    greeting: (n) => n ? `Ahoj ${escapeHtml(n)},` : 'Ahoj,',
    eventLine: (e, t) => `Tvoje akce <strong>${escapeHtml(e)}</strong> (${escapeHtml(t)})`,
    ctaLabel: 'Otevři lístek →',
    walletTip: 'Tip: Stáhni si lístek do Apple/Google Wallet nebo do kalendáře, abys ho měl vždy po ruce.',
  },
  sk: {
    subjects: {
      week_before: (e) => `📅 ${e} — týždeň do akcie`,
      day_before:  (e) => `🎉 ${e} — zajtra!`,
      hour_before: (e) => `🚀 ${e} — za hodinu začíname`,
    },
    headlines: { week_before: 'Týždeň do akcie!', day_before: 'Zajtra to vypukne 🎉', hour_before: 'Vyrádzame! 🚀' },
    greeting: (n) => n ? `Ahoj ${escapeHtml(n)},` : 'Ahoj,',
    eventLine: (e, t) => `Tvoja akcia <strong>${escapeHtml(e)}</strong> (${escapeHtml(t)})`,
    ctaLabel: 'Otvor lístok →',
    walletTip: 'Tip: Stiahni si lístok do Apple/Google Wallet alebo do kalendára, aby si ho mal vždy po ruke.',
  },
  en: {
    subjects: {
      week_before: (e) => `📅 ${e} — one week to go`,
      day_before:  (e) => `🎉 ${e} — tomorrow!`,
      hour_before: (e) => `🚀 ${e} — starting in one hour`,
    },
    headlines: { week_before: 'One week to go!', day_before: 'Tomorrow is the day 🎉', hour_before: "Let's go! 🚀" },
    greeting: (n) => n ? `Hey ${escapeHtml(n)},` : 'Hey,',
    eventLine: (e, t) => `Your event <strong>${escapeHtml(e)}</strong> (${escapeHtml(t)})`,
    ctaLabel: 'View ticket →',
    walletTip: 'Tip: Add your ticket to Apple/Google Wallet or your calendar so it\'s always at hand.',
  },
};

const DATE_LOCALE: Record<ReminderLocale, string> = {
  cs: 'cs-CZ', sk: 'sk-SK', en: 'en-GB',
};

function pickLocale(raw: string | null): ReminderLocale {
  if (raw === 'sk') return 'sk';
  if (raw === 'en') return 'en';
  return 'cs';
}

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {

  const token = req.headers.get('x-internal-token') ?? '';
  const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  if (!expected || !safeEqual(token, expected)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const due = await db().query<{
    id: string;
    reminder_type: string;
    ticket_id: string;
    buyer_email: string;
    buyer_name: string | null;
    buyer_locale: string | null;
    event_title: string;
    event_date_start: string;
    venue_name: string | null;
    ticket_type_name: string;
    ticket_status: string;
  }>(
    `SELECT r.id, r.reminder_type, r.ticket_id,
            u.email AS buyer_email, u.name AS buyer_name, u.locale AS buyer_locale,
            e.title AS event_title, e.date_start AS event_date_start,
            v.name AS venue_name,
            tt.name AS ticket_type_name,
            t.status AS ticket_status
     FROM marketing.event_reminders r
     JOIN tickets.tickets t ON t.id = r.ticket_id
     JOIN orders.orders o ON o.id = t.order_id
     JOIN catalog.events e ON e.id = o.event_id
     LEFT JOIN catalog.venues v ON v.id = e.venue_id
     JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
     JOIN identity.users u ON u.id = t.owner_id
     WHERE r.status = 'pending' AND r.scheduled_at <= NOW()
       AND u.anonymized_at IS NULL
       AND COALESCE(
         (SELECT pre_event_reminders AND email_enabled FROM identity.notification_preferences
          WHERE user_id = u.id),
         true
       ) = true
     ORDER BY r.scheduled_at ASC
     LIMIT 200`,
  );

  if (due.rows.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  const { sendMail } = await import('@/lib/email/mailer');
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  let sent = 0;
  let failed = 0;
  let cancelled = 0;

  for (const r of due.rows) {
    if (r.ticket_status !== 'valid') {
      await db().query(
        `UPDATE marketing.event_reminders SET status = 'cancelled' WHERE id = $1`,
        [r.id],
      );
      cancelled += 1;
      continue;
    }

    const loc = pickLocale(r.buyer_locale);
    const s = STRINGS[loc];
    const subject = (s.subjects[r.reminder_type] ?? ((e: string) => e))(r.event_title);
    const headline = s.headlines[r.reminder_type] ?? '';
    const myTicketsUrl = `${APP_URL}/${loc}/my-tickets`;
    const dateStr = new Date(r.event_date_start).toLocaleString(DATE_LOCALE[loc], {
      dateStyle: 'long',
      timeStyle: 'short',
    });

    const html = `
      <h2>${escapeHtml(headline)}</h2>
      <p>${s.greeting(r.buyer_name)}</p>
      <p>${s.eventLine(r.event_title, r.ticket_type_name)}</p>
      <p>📅 ${dateStr}${r.venue_name ? `<br>📍 ${escapeHtml(r.venue_name)}` : ''}</p>
      <p><a href="${myTicketsUrl}">${s.ctaLabel}</a></p>
      <p style="font-size:12px;color:#666">${s.walletTip}</p>
    `;

    try {
      await sendMail({
        from: process.env.MAIL_FROM ?? 'noreply@tixly.cz',
        to: r.buyer_email,
        subject,
        html,
      });
      await db().query(
        `UPDATE marketing.event_reminders SET status = 'sent', sent_at = NOW() WHERE id = $1`,
        [r.id],
      );
      sent += 1;
    } catch (err) {
      console.error('[send-reminders]', r.id, err);
      await db().query(
        `UPDATE marketing.event_reminders SET status = 'failed' WHERE id = $1`,
        [r.id],
      );
      failed += 1;
    }
  }

  return NextResponse.json({      // R-46: driv `ok: true` natvrdo, i kdyz `failed > 0`. Audit C2 sel po
      // jmennem seznamu devíti rout, takze tahle proklouzla (FINDINGS 174).
 ok: failed === 0, processed: due.rows.length, sent, failed, cancelled });

  });
}
