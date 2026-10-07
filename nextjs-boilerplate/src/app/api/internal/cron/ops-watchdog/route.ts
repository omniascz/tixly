/**
 * POST /api/internal/cron/ops-watchdog — kolo 14 / krok 3: kontrolní job provozu (dispatcher, každých 15 min).
 *
 *   1. heartbeat cronů — cron, který neproběhl úspěšně déle než 2× svůj interval (lib/ops/cron-schedule), → e-mail;
 *      cron bez záznamu se počítá od první kontroly (registered_at), nehlásí se hned po nasazení;
 *   2. zaplaceno u brány, ale bez vystavených vstupenek po 10 minutách → e-mail (seznam objednávek);
 *   3. refundy ve stavu refund_failed → e-mail (seznam objednávek).
 * Upozornění jdou přes alertOps (nejvýš 1 e-mail za 30 min na stejný problém). Auth: x-internal-token.
 */
import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { alertOps } from '@/lib/ops/alerts';
import { cronRegistry } from '@/lib/ops/cron-schedule';

export const dynamic = 'force-dynamic';

/** Online platební brány — objednávka zaplacená u nich musí mít do 10 min vystavené vstupenky (webhook). */
const GATEWAYS = ['gopay', 'comgate', 'stripe', 'mollie', 'paypal', 'przelewy24', 'triplea'];

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8'); const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const fmt = (d: Date | string | null) => (d ? new Date(d).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' }) : 'nikdy');

export async function POST(req: NextRequest): Promise<Response> {
  const token = req.headers.get('x-internal-token') ?? '';
  const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  if (!expected || !safeEqual(token, expected)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  return runWithServiceContext(async () => {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
    // 1) heartbeat cronů
    const reg = cronRegistry();
    for (const c of reg) {
      await db().query(
        `INSERT INTO monitoring.cron_heartbeats (job, interval_minutes) VALUES ($1, $2)
         ON CONFLICT (job) DO UPDATE SET interval_minutes = EXCLUDED.interval_minutes`,
        [c.job, c.intervalMinutes],
      );
    }
    const overdue = (await db().query<{ job: string; interval_minutes: number; last_success_at: string | null; last_status: number | null; last_error: string | null; registered_at: string }>(
      `SELECT job, interval_minutes, last_success_at, last_status, last_error, registered_at
         FROM monitoring.cron_heartbeats
        WHERE job = ANY($1::text[])
          AND now() - COALESCE(last_success_at, registered_at) > make_interval(mins => 2 * interval_minutes)
        ORDER BY job`,
      [reg.map((c) => c.job)],
    )).rows;
    for (const o of overdue) {
      await alertOps({
        kind: 'cron_overdue', key: `cron_overdue:${o.job}`,
        subject: `Cron ${o.job} neproběhl`,
        text: `Cron „${o.job}" neproběhl úspěšně déle než dvojnásobek svého intervalu (${o.interval_minutes} min).\n`
          + `Poslední úspěšný běh: ${fmt(o.last_success_at)}\nPoslední stav: ${o.last_status ?? '—'}${o.last_error ? `\nPoslední chyba: ${o.last_error}` : ''}\n\n`
          + `Zkontrolujte Vercel → Cron Jobs a logy funkce /api/cron/dispatch?job=${o.job}.`,
      });
    }

    // 2) zaplaceno u brány, bez vstupenek po 10 min
    const noTickets = (await db().query<{ id: string; paid_at: string; payment_provider: string; title: string | null }>(
      `SELECT o.id, o.paid_at, o.payment_provider, e.title
         FROM orders.orders o
         LEFT JOIN catalog.events e ON e.id = o.event_id
        WHERE o.status = 'paid'
          AND o.payment_provider = ANY($1::text[])
          AND o.paid_at < now() - interval '10 minutes'
          AND o.paid_at > now() - interval '7 days'
          AND EXISTS (SELECT 1 FROM orders.order_items oi WHERE oi.order_id = o.id)
          AND NOT EXISTS (SELECT 1 FROM tickets.tickets t WHERE t.order_id = o.id)
        ORDER BY o.paid_at
        LIMIT 50`,
      [GATEWAYS],
    )).rows;
    if (noTickets.length) {
      await alertOps({
        kind: 'paid_without_tickets', key: 'paid_without_tickets',
        subject: `Zaplacené objednávky bez vstupenek (${noTickets.length})`,
        text: `Tyto objednávky jsou zaplacené u brány déle než 10 minut, ale nemají vystavené vstupenky:\n\n`
          + noTickets.map((o) => `• ${o.id} — ${o.title ?? '?'} — ${o.payment_provider}, zaplaceno ${fmt(o.paid_at)}\n  ${appUrl}/admin/orders/${o.id}`).join('\n')
          + `\n\nVstupenky vystaví znovu odeslání potvrzení (detail objednávky → Poslat znovu) nebo opakovaný webhook brány.`,
      });
    }

    // 3) refund_failed
    const refunds = (await db().query<{ id: string; refund_error: string | null; updated_at: string; title: string | null }>(
      `SELECT o.id, o.refund_error, o.updated_at, e.title
         FROM orders.orders o LEFT JOIN catalog.events e ON e.id = o.event_id
        WHERE o.status = 'refund_failed'
        ORDER BY o.updated_at
        LIMIT 50`,
    )).rows;
    if (refunds.length) {
      await alertOps({
        kind: 'refund_failed', key: 'refund_failed',
        subject: `Refund ve stavu refund_failed (${refunds.length})`,
        text: `Vrácení peněz se nepodařilo dokončit u těchto objednávek (stav refund_failed):\n\n`
          + refunds.map((o) => `• ${o.id} — ${o.title ?? '?'}${o.refund_error ? ` — ${o.refund_error.slice(0, 200)}` : ''}\n  ${appUrl}/admin/orders/${o.id}`).join('\n')
          + `\n\nDořešte ručně (brána / převod) a stav objednávky upravte.`,
      });
    }

    return NextResponse.json({ ok: true, overdue: overdue.map((o) => o.job), paidWithoutTickets: noTickets.length, refundFailed: refunds.length });
  });
}
