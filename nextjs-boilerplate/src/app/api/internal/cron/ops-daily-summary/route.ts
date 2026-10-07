/**
 * POST /api/internal/cron/ops-daily-summary — kolo 14 / krok 3: denní souhrn provozu v 7:00 Europe/Prague.
 *
 * Vercel crony běží v UTC → naplánováno na 5:00 i 6:00 UTC (letní / zimní čas); odešle se jen v hodině 7 pražského
 * času a nejvýš jednou za den (monitoring.ops_alerts, klíč daily_summary:<datum>). Na PLATFORM_ADMIN_EMAIL:
 *   prodeje a tržba za včerejšek po termínech · propadlé rezervace · neodeslané e-maily se vstupenkami ·
 *   nevyřízené refundy (refund_failed) · chyby (monitoring.ops_events).
 * Body (volitelné, jen pro interní volání / testy): { at: ISO čas } místo „teď". Auth: x-internal-token.
 */
import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8'); const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
const kc = (minor: number) => `${(minor / 100).toLocaleString('cs-CZ')} Kč`;
/** české skloňování: 1 vstupenka, 2–4 vstupenky, 5+ vstupenek */
const cz = (n: number, one: string, few: string, many: string) => `${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;
const tickets = (n: number) => cz(n, 'vstupenka', 'vstupenky', 'vstupenek');
const fmtDate = (d: string) => new Date(d).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague', dateStyle: 'short', timeStyle: 'short' });

export async function POST(req: NextRequest): Promise<Response> {
  const token = req.headers.get('x-internal-token') ?? '';
  const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  if (!expected || !safeEqual(token, expected)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { at?: string };
  const at = body.at && !Number.isNaN(Date.parse(body.at)) ? new Date(body.at) : new Date();

  const pragueHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', hour: '2-digit', hour12: false }).format(at));
  if (pragueHour !== 7) return NextResponse.json({ ok: true, skipped: `v Praze je ${pragueHour} h, souhrn se posílá v 7 h` });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(at); // YYYY-MM-DD
  const [y, m, d] = today.split('-').map(Number);
  const yesterday = new Date(Date.UTC(y, m - 1, d - 1)).toLocaleDateString('cs-CZ', { timeZone: 'UTC' });

  return runWithServiceContext(async () => {
    const claimed = await db().query(
      `INSERT INTO monitoring.ops_alerts (key, last_sent_at) VALUES ($1, now()) ON CONFLICT (key) DO NOTHING RETURNING key`,
      [`daily_summary:${today}`],
    );
    if (claimed.rowCount === 0) return NextResponse.json({ ok: true, skipped: `souhrn za ${today} už odešel` });

    // včerejšek v pražském čase: [den-1 00:00, den 00:00)
    const range = [`${today}`];
    const FROM = `(($1::date - 1)::timestamp AT TIME ZONE 'Europe/Prague')`;
    const TO = `(($1::date)::timestamp AT TIME ZONE 'Europe/Prague')`;
    const sales = (await db().query<{ title: string; date_start: string | null; city: string | null; tickets: number; orders: number; revenue: number }>(
      `SELECT e.title, e.date_start, v.city,
              COALESCE(SUM(oi.quantity), 0)::int AS tickets, COUNT(DISTINCT o.id)::int AS orders,
              COALESCE(SUM(oi.total_price), 0)::bigint AS revenue
         FROM orders.orders o
         JOIN catalog.events e ON e.id = o.event_id
         LEFT JOIN catalog.venues v ON v.id = e.venue_id
         JOIN orders.order_items oi ON oi.order_id = o.id
        WHERE o.status IN ('paid', 'paid_partial') AND o.paid_at >= ${FROM} AND o.paid_at < ${TO}
        GROUP BY e.id, e.title, e.date_start, v.city
        ORDER BY revenue DESC`,
      range,
    )).rows.map((r) => ({ ...r, revenue: Number(r.revenue) }));
    const expired = (await db().query<{ n: number; seats: number }>(
      `SELECT count(*)::int AS n, COALESCE(sum(seat_count), 0)::int AS seats FROM orders.seat_reservations
        WHERE status = 'expired' AND COALESCE(closed_at, expires_at) >= ${FROM} AND COALESCE(closed_at, expires_at) < ${TO}`,
      range,
    )).rows[0];
    const unsent = (await db().query<{ detail: string; created_at: string }>(
      `SELECT detail, created_at FROM monitoring.ops_events
        WHERE kind = 'ticket_email_failed' AND created_at >= ${FROM} AND created_at < ${TO}
        ORDER BY created_at LIMIT 50`,
      range,
    )).rows;
    const refunds = (await db().query<{ n: number; amount: number }>(
      `SELECT count(*)::int AS n, COALESCE(sum(total_amount), 0)::bigint AS amount FROM orders.orders WHERE status = 'refund_failed'`,
    )).rows[0];
    const errors = (await db().query<{ kind: string; n: number }>(
      `SELECT kind, count(*)::int AS n FROM monitoring.ops_events
        WHERE created_at >= ${FROM} AND created_at < ${TO}
        GROUP BY kind ORDER BY n DESC`,
      range,
    )).rows;

    const totalRevenue = sales.reduce((a, s) => a + s.revenue, 0);
    const totalTickets = sales.reduce((a, s) => a + s.tickets, 0);
    const lines = [
      `Denní souhrn Tixly za ${yesterday} (čas Europe/Prague)`,
      '',
      `Prodeje a tržba po termínech: ${tickets(totalTickets)}, ${kc(totalRevenue)}`,
      ...(sales.length ? sales.map((s) => `• ${s.title}${s.date_start ? ` — ${fmtDate(s.date_start)}` : ''}${s.city ? `, ${s.city}` : ''}: ${tickets(s.tickets)}, ${cz(s.orders, 'objednávka', 'objednávky', 'objednávek')}, ${kc(s.revenue)}`) : ['• žádné prodeje']),
      '',
      `Propadlé rezervace: ${expired.n} (${expired.seats} míst vráceno do prodeje)`,
      '',
      `Neodeslané e-maily se vstupenkami: ${unsent.length}`,
      ...unsent.map((u) => `• ${u.detail.split('\n')[0]}`),
      '',
      `Nevyřízené refundy (refund_failed): ${refunds.n}${refunds.n ? `, celkem ${kc(Number(refunds.amount))}` : ''}`,
      '',
      `Chyby (zaznamenané problémy provozu): ${errors.reduce((a, e) => a + e.n, 0)}`,
      ...errors.map((e) => `• ${e.kind}: ${e.n}×`),
    ];
    const to = process.env.PLATFORM_ADMIN_EMAIL;
    if (!to) return NextResponse.json({ ok: false, error: 'PLATFORM_ADMIN_EMAIL není nastavený' }, { status: 500 });
    const { sendMail } = await import('@/lib/email/mailer');
    await sendMail({
      from: `"Tixly provoz" <${process.env.EMAIL_FROM ?? 'provoz@tixly.local'}>`,
      to,
      subject: `[Tixly provoz] Denní souhrn za ${yesterday}: ${tickets(totalTickets)}, ${kc(totalRevenue)}`,
      text: lines.join('\n'),
    });
    return NextResponse.json({ ok: true, date: today, terms: sales.length, totalTickets, totalRevenue });
  });
}
