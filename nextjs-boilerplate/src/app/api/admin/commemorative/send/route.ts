import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

const schema = z.object({ eventId: z.string().uuid() });

interface TicketRow {
  id: string;
  seat_label: string | null;
  buyer_email: string;
  buyer_name: string | null;
  event_title: string;
  event_date_start: string | null;
  venue_name: string | null;
}

interface TemplateRow {
  quote: string | null;
  theme_color: string;
  accent_color: string;
  custom_message: string | null;
  is_active: boolean;
}

async function executeSend(eventId: string): Promise<Response> {
  return runWithServiceContext(async () => {
    const eventCheck = await db().query<{
      id: string;
      title: string;
      date_start: string | null;
      venue_name: string | null;
      promoter_id: string;
    }>(
      `SELECT e.id, e.title, e.date_start,
              v.name AS venue_name,
              e.promoter_id
         FROM catalog.events e
         LEFT JOIN catalog.venues v ON v.id = e.venue_id
        WHERE e.id = $1`,
      [eventId],
    );

    if (eventCheck.rows.length === 0) {
      return NextResponse.json({ error: 'EVENT_NOT_FOUND' }, { status: 404 });
    }

    const templateRes = await db().query<TemplateRow>(
      `SELECT quote, theme_color, accent_color, custom_message, is_active
         FROM catalog.commemorative_templates
        WHERE event_id = $1`,
      [eventId],
    );

    const tickets = await db().query<TicketRow>(
      `SELECT t.id,
              CASE WHEN es.id IS NOT NULL
                   THEN concat_ws(' ', es.sector, es.row_label, es.seat_number::text)
                   ELSE NULL END AS seat_label,
              u.email AS buyer_email,
              u.name  AS buyer_name,
              e.title AS event_title,
              e.date_start AS event_date_start,
              v.name AS venue_name
         FROM tickets.tickets t
         JOIN orders.orders o ON o.id = t.order_id
         JOIN catalog.events e ON e.id = o.event_id
         LEFT JOIN catalog.venues v ON v.id = e.venue_id
         JOIN identity.users u ON u.id = t.owner_id
         LEFT JOIN catalog.event_seats es ON es.id = t.event_seat_id
        WHERE o.event_id = $1
          AND t.status = 'used'
          AND t.commemorative_sent_at IS NULL`,
      [eventId],
    );

    if (tickets.rows.length === 0) {
      return NextResponse.json({ sent: 0, message: 'Žádné nové vstupenky k odeslání.' });
    }

    const template = templateRes.rows[0] ?? null;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

    for (const ticket of tickets.rows) {
      await db().query(
        `UPDATE tickets.tickets SET commemorative_sent_at = NOW() WHERE id = $1`,
        [ticket.id],
      );

      const memoryUrl = `${appUrl}/cs/my-tickets/${ticket.id}/memory`;
      const eventDateStr = ticket.event_date_start
        ? new Date(ticket.event_date_start).toLocaleDateString('cs-CZ', {
            day: 'numeric', month: 'long', year: 'numeric',
          })
        : '';

      const seatInfo = ticket.seat_label ? ` · Místo: ${ticket.seat_label}` : '';
      const subjectLine = `Vzpomínka na ${ticket.event_title}`;

      console.log(
        `Commemorative → ${ticket.buyer_email}: event=${ticket.event_title}, seat=${ticket.seat_label ?? '—'}`,
      );

      try {
        const { sendMail } = await import('@/lib/email/mailer');
        const themeColor = template?.theme_color ?? '#1a1a2e';
        const accentColor = template?.accent_color ?? '#e2b96f';
        const quoteHtml = template?.quote
          ? `<p style="font-style:italic;color:${accentColor};margin:16px 0;">"${template.quote}"</p>`
          : '';
        const customMsgHtml = template?.custom_message
          ? `<p style="margin:12px 0;">${template.custom_message}</p>`
          : '';

        await sendMail({
          to: ticket.buyer_email,
          subject: subjectLine,
          html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Georgia,serif;">
<div style="max-width:600px;margin:32px auto;background:${themeColor};border-radius:12px;overflow:hidden;">
  <div style="padding:40px 36px;color:#fff;">
    <p style="margin:0 0 4px;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:${accentColor};">
      Vzpomínka na večer
    </p>
    <h1 style="margin:0 0 8px;font-size:28px;font-weight:700;line-height:1.2;">${ticket.event_title}</h1>
    <p style="margin:0 0 4px;font-size:15px;color:rgba(255,255,255,0.8);">${eventDateStr}${seatInfo}</p>
    ${ticket.venue_name ? `<p style="margin:0;font-size:14px;color:rgba(255,255,255,0.6);">${ticket.venue_name}</p>` : ''}
    ${quoteHtml}
    ${customMsgHtml}
    <div style="margin-top:28px;padding-top:20px;border-top:1px solid rgba(${accentColor},0.3);">
      <a href="${memoryUrl}"
         style="display:inline-block;padding:12px 28px;background:${accentColor};color:#1a1a1a;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;">
        Otevřít vzpomínku
      </a>
    </div>
    <p style="margin-top:28px;font-size:12px;color:rgba(255,255,255,0.4);">Tixly · digitální vstupenky</p>
  </div>
</div>
</body>
</html>`,
        });
      } catch {
        // mail failure is non-fatal — row already marked sent
      }
    }

    return NextResponse.json({ sent: tickets.rows.length });
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  const internalToken = req.headers.get('x-internal-token') ?? '';
  const expectedToken = process.env.INTERNAL_SERVICE_TOKEN ?? '';

  if (expectedToken && safeEqual(internalToken, expectedToken)) {
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
    }
    return executeSend(parsed.data.eventId);
  }

  return runAsActivePromoter(req, async (promoter) => {
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
    }

    const eventCheck = await db().query(
      `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
      [parsed.data.eventId, promoter.promoterId],
    );
    if (eventCheck.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    return executeSend(parsed.data.eventId);
  });
}
