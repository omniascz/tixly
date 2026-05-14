/**
 * POST /api/internal/cron/daily-stats
 *
 * Cron endpoint — pro každého aktivního promotéra spočítá včerejší stats
 * (revenue, orders, tickets) a pošle e-mail "owner@<promoter>" do Mailhogu.
 *
 * Auth: x-internal-token header musí odpovídat INTERNAL_SERVICE_TOKEN.
 *
 * Spuštění:
 *   curl -X POST http://localhost:3000/api/internal/cron/daily-stats \
 *        -H "x-internal-token: $INTERNAL_SERVICE_TOKEN"
 *
 * V produkci volat přes systemd timer / Railway cron / k8s CronJob v 7:00 ráno.
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

interface PromoterStats {
  promoter_id: string;
  promoter_name: string;
  owner_email: string;
  orders_count: number;
  revenue: number;
  tickets: number;
}

function fmtCzk(halire: number): string {
  return `${(halire / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} Kč`;
}

function buildHtml(s: PromoterStats, dateLabel: string): string {
  return `<!DOCTYPE html>
<html><body style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111">
  <h1 style="color:#10b981;margin-bottom:4px">Denní přehled · ${escapeHtml(dateLabel)}</h1>
  <p style="color:#666;margin-top:0">${escapeHtml(s.promoter_name)}</p>

  <table style="width:100%;border-collapse:collapse;margin-top:24px">
    <tr>
      <td style="padding:12px;border:1px solid #eee;width:50%">
        <div style="color:#666;font-size:12px">Tržby</div>
        <div style="font-size:24px;font-weight:600">${fmtCzk(s.revenue)}</div>
      </td>
      <td style="padding:12px;border:1px solid #eee">
        <div style="color:#666;font-size:12px">Objednávky</div>
        <div style="font-size:24px;font-weight:600">${s.orders_count}</div>
      </td>
    </tr>
    <tr>
      <td style="padding:12px;border:1px solid #eee">
        <div style="color:#666;font-size:12px">Prodaných lístků</div>
        <div style="font-size:24px;font-weight:600">${s.tickets}</div>
      </td>
      <td style="padding:12px;border:1px solid #eee">
        <div style="color:#666;font-size:12px">Průměrná hodnota</div>
        <div style="font-size:24px;font-weight:600">
          ${s.orders_count > 0 ? fmtCzk(Math.round(s.revenue / s.orders_count)) : '—'}
        </div>
      </td>
    </tr>
  </table>

  ${
    s.orders_count === 0
      ? '<p style="margin-top:24px;color:#666">Včera bez objednávek. Připoj se na <a href="http://localhost:3000/admin">/admin</a> a podívej se na trendy.</p>'
      : `<p style="margin-top:24px"><a href="http://localhost:3000/admin/orders" style="color:#10b981">Otevřít přehled objednávek →</a></p>`
  }

  <p style="margin-top:32px;color:#999;font-size:11px">
    Automatický e-mail · Tixly · vstupenky@tixly.local
  </p>
</body></html>`;
}

interface CronSummary {
  ok: boolean;
  date: string;
  promotersProcessed: number;
  emailsSent: number;
  errors: Array<{ promoterId: string; reason: string }>;
}

export async function POST(req: NextRequest): Promise<Response> {
  const token = req.headers.get('x-internal-token') ?? '';
  const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  if (!expected || !safeEqual(token, expected)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Včerejší den 00:00:00 — 23:59:59 v Europe/Prague
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateLabel = yesterday.toLocaleDateString('cs-CZ');

  // Agregát per promotér za včera (přes events.promoter_id)
  const r = await db().query<PromoterStats>(
    `WITH yesterday AS (
       SELECT DATE_TRUNC('day', NOW() - INTERVAL '1 day') AS d_start,
              DATE_TRUNC('day', NOW())                   AS d_end
     ),
     orders_yesterday AS (
       SELECT e.promoter_id,
              o.id AS order_id,
              o.total_amount,
              (SELECT COALESCE(SUM(quantity), 0) FROM orders.order_items WHERE order_id = o.id) AS ticket_count
       FROM orders.orders o
       JOIN catalog.events e ON e.id = o.event_id
       JOIN yesterday y ON o.created_at >= y.d_start AND o.created_at < y.d_end
       WHERE o.status = 'paid'
     ),
     promoter_stats AS (
       SELECT promoter_id,
              COUNT(order_id)::int AS orders_count,
              COALESCE(SUM(total_amount), 0)::int AS revenue,
              COALESCE(SUM(ticket_count), 0)::int AS tickets
       FROM orders_yesterday
       GROUP BY promoter_id
     )
     SELECT p.id AS promoter_id,
            p.name AS promoter_name,
            COALESCE(u.email, p.contact_email, 'unknown@tixly.local') AS owner_email,
            COALESCE(s.orders_count, 0) AS orders_count,
            COALESCE(s.revenue, 0) AS revenue,
            COALESCE(s.tickets, 0) AS tickets
     FROM platform.promoters p
     LEFT JOIN promoter_stats s ON s.promoter_id = p.id
     LEFT JOIN platform.promoter_members m
       ON m.promoter_id = p.id AND m.role = 'owner' AND m.status = 'active'
     LEFT JOIN identity.users u ON u.id = m.user_id
     WHERE p.status = 'active'
     ORDER BY p.name`,
  );

  const summary: CronSummary = {
    ok: true,
    date: yesterday.toISOString().slice(0, 10),
    promotersProcessed: r.rows.length,
    emailsSent: 0,
    errors: [],
  };

  if (r.rows.length === 0) {
    return NextResponse.json(summary);
  }

  const { sendMail } = await import('@/lib/email/mailer');

  for (const stats of r.rows) {
    try {
      await sendMail({
        to: stats.owner_email,
        subject: `Tixly — denní přehled ${dateLabel}`,
        html: buildHtml(stats, dateLabel),
      });
      summary.emailsSent += 1;
    } catch (err) {
      summary.errors.push({
        promoterId: stats.promoter_id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json(summary);
}
