/**
 * POST /api/internal/cron/send-reminders
 *
 * Najde event_reminders s status='pending' a scheduled_at <= NOW(), pošle email,
 * mark jako sent. Failed reminders → retry up to 3x.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { timingSafeEqual } from 'crypto';
import { escapeHtml } from '@/lib/html-escape/escape';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

const SUBJECTS: Record<string, (eventTitle: string) => string> = {
  week_before: (e) => `📅 ${e} — týden do akce`,
  day_before: (e) => `🎉 ${e} — zítra!`,
  hour_before: (e) => `🚀 ${e} — za hodinu začínáme`,
};

const HEADLINES: Record<string, string> = {
  week_before: 'Týden do akce!',
  day_before: 'Zítra to vypukne 🎉',
  hour_before: 'Vyrážíme! 🚀',
};

export async function POST(req: NextRequest): Promise<Response> {
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
    event_title: string;
    event_date_start: string;
    venue_name: string | null;
    ticket_type_name: string;
    ticket_status: string;
  }>(
    `SELECT r.id, r.reminder_type, r.ticket_id,
            u.email AS buyer_email, u.name AS buyer_name,
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

  let sent = 0;
  let failed = 0;
  let cancelled = 0;
  for (const r of due.rows) {
    // Skip pokud ticket už není valid (revoked/used)
    if (r.ticket_status !== 'valid') {
      await db().query(
        `UPDATE marketing.event_reminders SET status = 'cancelled' WHERE id = $1`,
        [r.id],
      );
      cancelled += 1;
      continue;
    }
    const subject = (SUBJECTS[r.reminder_type] ?? ((e: string) => e))(r.event_title);
    const headline = HEADLINES[r.reminder_type] ?? '';
    const myTicketsUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/cs/my-tickets`;
    const html = `
      <h2>${escapeHtml(headline)}</h2>
      <p>${r.buyer_name ? `Ahoj ${escapeHtml(r.buyer_name)},` : 'Ahoj,'}</p>
      <p>Tvoje akce <strong>${escapeHtml(r.event_title)}</strong> (${escapeHtml(r.ticket_type_name)})</p>
      <p>📅 ${new Date(r.event_date_start).toLocaleString('cs-CZ', { dateStyle: 'long', timeStyle: 'short' })}${r.venue_name ? `<br>📍 ${escapeHtml(r.venue_name)}` : ''}</p>
      <p><a href="${myTicketsUrl}">Otevři lístek →</a></p>
      <p style="font-size:12px;color:#666">Tip: Stáhni si lístek do Apple/Google Wallet nebo do kalendáře, abys ho měl vždy po ruce.</p>
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

  return NextResponse.json({ ok: true, processed: due.rows.length, sent, failed, cancelled });
}
