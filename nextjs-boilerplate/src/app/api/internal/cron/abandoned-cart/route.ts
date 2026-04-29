/**
 * POST /api/internal/cron/abandoned-cart
 *
 * Najde pending orders staré 30+ minut, které nebyly zaplacené, ještě nemají
 * abandoned_email_sent_at, a pošle reminder email s reservation link.
 *
 * Auth: x-internal-token.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { timingSafeEqual } from 'crypto';
import nodemailer from 'nodemailer';
import { escapeHtml } from '@/lib/html-escape/escape';
import { formatMoney, isCurrency } from '@/lib/format';

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

export async function POST(req: NextRequest): Promise<Response> {
  const token = req.headers.get('x-internal-token') ?? '';
  const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  if (!expected || !safeEqual(token, expected)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const r = await db().query<{
    id: string;
    total_amount: number;
    currency: string;
    buyer_email: string;
    buyer_name: string | null;
    event_id: string;
    event_title: string;
    event_date_start: string;
  }>(
    `SELECT o.id, o.total_amount, o.currency,
            u.email AS buyer_email, u.name AS buyer_name,
            e.id AS event_id, e.title AS event_title, e.date_start AS event_date_start
     FROM orders.orders o
     JOIN identity.users u ON u.id = o.user_id
     JOIN catalog.events e ON e.id = o.event_id
     WHERE o.status = 'pending'
       AND o.created_at < NOW() - INTERVAL '30 minutes'
       AND o.abandoned_email_sent_at IS NULL
       AND u.anonymized_at IS NULL
       AND e.date_start > NOW()
       AND COALESCE(
         (SELECT abandoned_cart AND email_enabled FROM identity.notification_preferences
          WHERE user_id = u.id),
         true
       ) = true
     ORDER BY o.created_at ASC
     LIMIT 200`,
  );

  if (r.rows.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'localhost',
    port: Number(process.env.SMTP_PORT ?? 1025),
    secure: false,
    ignoreTLS: true,
  });

  let sent = 0;
  let failed = 0;
  for (const o of r.rows) {
    const ccy = isCurrency(o.currency) ? o.currency : 'CZK';
    const resumeUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/cs/events/${o.event_id}`;
    const html = `
      <h2>${escapeHtml(o.event_title)} — máš lístky čekající</h2>
      <p>${o.buyer_name ? `Ahoj ${escapeHtml(o.buyer_name)},` : 'Ahoj,'}</p>
      <p>Před chvílí jsi začal/a kupovat lístky na <strong>${escapeHtml(o.event_title)}</strong>
         (${new Date(o.event_date_start).toLocaleDateString('cs-CZ')}), ale objednávka
         za <strong>${formatMoney(o.total_amount, ccy)}</strong> nebyla dokončená.</p>
      <p>Lístky drží jen omezenou dobu. <a href="${escapeHtml(resumeUrl)}">Pokračovat na pokladnu →</a></p>
      <p style="font-size:12px;color:#666">Pokud sis to rozmyslel/a, ignoruj prosím tento e-mail.</p>
    `;
    try {
      await transporter.sendMail({
        from: process.env.MAIL_FROM ?? 'noreply@tixly.cz',
        to: o.buyer_email,
        subject: `Tixly: lístky na ${o.event_title} čekají`,
        html,
        text: `Lístky na ${o.event_title} čekají. Pokračuj: ${resumeUrl}`,
      });
      await db().query(
        `UPDATE orders.orders SET abandoned_email_sent_at = NOW() WHERE id = $1`,
        [o.id],
      );
      sent += 1;
    } catch (err) {
      console.error('[abandoned-cart]', o.id, err);
      failed += 1;
    }
  }

  return NextResponse.json({ ok: true, processed: r.rows.length, sent, failed });
}
